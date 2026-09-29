-- =============================================================================
-- 0004 FISCAL DOCUMENTS + AUDIT LOG
-- =============================================================================
-- Prepares for DGI e-invoicing without building the XML/clearance part yet:
--   * gapless numbering per restaurant, per series, per fiscal year
--   * every document is a full, self-contained snapshot (seller ICE/IF/RC,
--     lines, VAT per rate, payments), so the UBL 2.1 XML can be generated from
--     this table alone, years later, whatever happened to the menu
--   * immutable: UPDATE and DELETE are blocked for everyone, corrections are
--     credit notes that reference the original
--   * hash chain: each document stores the hash of the previous one, so any
--     after-the-fact change or removal is detectable (verify_fiscal_chain)
-- DGI transmission status lives in a separate table so documents stay immutable.
-- =============================================================================

create table public.fiscal_documents (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,
  doc_type             text not null check (doc_type in ('ticket', 'invoice', 'credit_note')),
  series               text not null check (series in ('T', 'F', 'A')),  -- ticket, facture, avoir
  fiscal_year          integer not null,
  number               integer not null,
  doc_number           text not null,        -- human readable, e.g. T-2026-000042
  chain_index          bigint not null,      -- 1, 2, 3 ... across all series of the restaurant
  order_id             uuid,
  original_document_id uuid,                 -- set on credit notes
  business_date        date not null,
  issued_at            timestamptz not null default now(),
  currency             text not null,
  seller               jsonb not null,       -- legal name, ICE, IF, RC, address at issue time
  buyer                jsonb,                -- optional, e.g. {"name": "...", "ice": "..."}
  lines                jsonb not null,       -- [{name, qty, unit_ttc, total_ttc, vat_bp, ht, vat}]
  vat_breakdown        jsonb not null,       -- [{vat_bp, ht, vat, ttc}]
  payments             jsonb not null,       -- [{method, amount, tip}]
  discount_cents       bigint not null default 0,
  total_ht_cents       bigint not null,
  total_vat_cents      bigint not null,
  total_ttc_cents      bigint not null,
  reason               text,
  staff_id             uuid,
  prev_hash            text,
  hash                 text not null,
  created_at           timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, series, fiscal_year, number),
  unique (restaurant_id, chain_index),
  foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id) on delete no action,
  foreign key (restaurant_id, original_document_id)
    references public.fiscal_documents (restaurant_id, id) on delete no action
);
create unique index fiscal_documents_one_credit_note
  on public.fiscal_documents (restaurant_id, original_document_id)
  where doc_type = 'credit_note';
create index fiscal_documents_day_idx on public.fiscal_documents (restaurant_id, business_date);

alter table public.orders
  add foreign key (restaurant_id, fiscal_document_id)
  references public.fiscal_documents (restaurant_id, id) on delete no action;

create or replace function app.fiscal_documents_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.purge', true) = 'on' then
    return old;
  end if;
  raise exception 'fiscal documents are immutable, issue a credit note instead' using errcode = '42501';
end $$;
create trigger fiscal_documents_immutable before update or delete on public.fiscal_documents
  for each row execute function app.fiscal_documents_immutable();

-- The part of a document covered by the hash. jsonb::text is deterministic in
-- Postgres (keys are normalised), so the same content always gives the same hash.
create or replace function app.fiscal_payload(d public.fiscal_documents)
returns text
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.id, 'restaurant_id', d.restaurant_id, 'doc_type', d.doc_type,
    'series', d.series, 'fiscal_year', d.fiscal_year, 'number', d.number,
    'chain_index', d.chain_index, 'order_id', d.order_id,
    'original_document_id', d.original_document_id, 'business_date', d.business_date,
    'issued_at', to_char(d.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'currency', d.currency, 'seller', d.seller, 'buyer', d.buyer, 'lines', d.lines,
    'vat_breakdown', d.vat_breakdown, 'payments', d.payments,
    'discount_cents', d.discount_cents, 'total_ht_cents', d.total_ht_cents,
    'total_vat_cents', d.total_vat_cents, 'total_ttc_cents', d.total_ttc_cents,
    'reason', d.reason, 'staff_id', d.staff_id
  )::text
$$;

create or replace function app.fiscal_hash(prev_hash text, payload text)
returns text
language sql immutable
set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(prev_hash, 'GENESIS') || '|' || payload, 'UTF8')), 'hex') $$;

-- Future DGI clearance: one row per transmission attempt state.
create table public.fiscal_submissions (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  fiscal_document_id uuid not null,
  status             text not null default 'pending' check (status in ('pending', 'sent', 'accepted', 'rejected')),
  attempts           integer not null default 0,
  dgi_reference      text,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, fiscal_document_id),
  foreign key (restaurant_id, fiscal_document_id)
    references public.fiscal_documents (restaurant_id, id) on delete cascade
);
create trigger fiscal_submissions_touch before update on public.fiscal_submissions
  for each row execute function app.touch_updated_at();

-- =============================================================================
-- Audit log: who changed what, when. Written by triggers only, never by clients.
-- =============================================================================
create table public.audit_log (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_name    text not null,
  row_id        text,
  action        text not null check (action in ('insert', 'update', 'delete')),
  actor_user_id uuid,
  changes       jsonb not null,
  created_at    timestamptz not null default now()
);
create index audit_log_restaurant_idx on public.audit_log (restaurant_id, created_at desc);

create or replace function app.audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hidden constant text[] := '{updated_at,subtotal_cents,total_cents}';
  o jsonb; n jsonb; diff jsonb; k text; rid uuid; rowid text;
begin
  if current_setting('app.purge', true) = 'on' then
    return null;
  end if;
  o := case when tg_op <> 'INSERT' then to_jsonb(old) - hidden end;
  n := case when tg_op <> 'DELETE' then to_jsonb(new) - hidden end;

  if tg_op = 'UPDATE' then
    diff := '{}'::jsonb;
    for k in select jsonb_object_keys(n) loop
      if (n -> k) is distinct from (o -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('old', o -> k, 'new', n -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return null;
    end if;
  else
    diff := coalesce(n, o);
  end if;

  rid := coalesce((n ->> 'restaurant_id')::uuid, (o ->> 'restaurant_id')::uuid, (n ->> 'id')::uuid, (o ->> 'id')::uuid);
  rowid := coalesce(n ->> 'id', o ->> 'id');
  insert into public.audit_log (restaurant_id, table_name, row_id, action, actor_user_id, changes)
  values (rid, tg_table_name, rowid, lower(tg_op), auth.uid(), diff);
  return null;
end $$;

create trigger audit_restaurants   after update on public.restaurants
  for each row execute function app.audit();
create trigger audit_categories    after insert or update or delete on public.categories
  for each row execute function app.audit();
create trigger audit_menu_items    after insert or update or delete on public.menu_items
  for each row execute function app.audit();
create trigger audit_item_variants after insert or update or delete on public.item_variants
  for each row execute function app.audit();
create trigger audit_staff         after insert or update or delete on public.staff
  for each row execute function app.audit();
create trigger audit_dining_tables after insert or update or delete on public.dining_tables
  for each row execute function app.audit();
create trigger audit_memberships   after insert or update or delete on public.memberships
  for each row execute function app.audit();
-- orders: only real changes (status, table, discount, cancel...), not total recalculations
create trigger audit_orders        after update or delete on public.orders
  for each row execute function app.audit();
create trigger audit_order_lines   after update or delete on public.order_lines
  for each row execute function app.audit();
create trigger audit_payments      after insert or delete on public.payments
  for each row execute function app.audit();
