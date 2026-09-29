-- =============================================================================
-- 0003 SALES: orders, order lines, payments, cash movements, day closures
-- =============================================================================
-- Order lifecycle
--   status (kitchen flow): new -> preparing -> ready -> served, or cancelled
--   closed_at + fiscal_document_id: set ONLY by close_order() once fully paid.
--   After closing, lines, payments, totals and discount are frozen forever.
--   Corrections after closing go through a credit note, never an edit.
-- =============================================================================

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  -- generated on the device that creates the order. Makes retries (double tap,
  -- flaky wifi, later: offline sync) idempotent: same client_id = same order.
  client_id          uuid not null,
  business_date      date not null,
  ticket_number      integer not null,          -- #1, #2, ... per business day
  source             text not null check (source in ('qr', 'pos', 'phone', 'glovo')),
  order_type         text not null check (order_type in ('dine_in', 'takeaway', 'delivery')),
  table_id           uuid,
  status             text not null default 'new'
                     check (status in ('new', 'preparing', 'ready', 'served', 'cancelled')),
  customer_name      text check (length(customer_name) <= 60),
  customer_phone     text check (length(customer_phone) <= 30),
  delivery_address   text check (length(delivery_address) <= 300),
  external_ref       text check (length(external_ref) <= 60),     -- Glovo order ref, ...
  note               text check (length(note) <= 300),
  staff_id           uuid,                                        -- who took the order at the till

  subtotal_cents     bigint not null default 0,  -- maintained by trigger from lines
  discount_cents     bigint not null default 0 check (discount_cents >= 0),
  total_cents        bigint not null default 0,  -- subtotal - discount, maintained by trigger
  discount_by_staff_id uuid,

  cancelled_at       timestamptz,
  cancelled_by_staff_id uuid,
  cancel_reason      text check (length(cancel_reason) <= 200),

  closed_at          timestamptz,
  fiscal_document_id uuid,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (restaurant_id, id),
  unique (restaurant_id, client_id),
  unique (restaurant_id, business_date, ticket_number),
  check (discount_cents <= subtotal_cents),
  foreign key (restaurant_id, table_id)
    references public.dining_tables (restaurant_id, id) on delete set null (table_id),
  foreign key (restaurant_id, staff_id)
    references public.staff (restaurant_id, id) on delete set null (staff_id),
  foreign key (restaurant_id, discount_by_staff_id)
    references public.staff (restaurant_id, id) on delete set null (discount_by_staff_id),
  foreign key (restaurant_id, cancelled_by_staff_id)
    references public.staff (restaurant_id, id) on delete set null (cancelled_by_staff_id)
);
create index orders_day_idx  on public.orders (restaurant_id, business_date);
create index orders_open_idx on public.orders (restaurant_id, status) where closed_at is null;
create index orders_table_idx on public.orders (restaurant_id, table_id) where closed_at is null;

create table public.order_lines (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  order_id         uuid not null,
  menu_item_id     uuid,       -- null = free line typed at the till ("divers")
  variant_id       uuid,
  -- snapshot at the moment of ordering: later menu edits never change history
  name             text not null check (length(name) between 1 and 120),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 100000000),
  quantity         integer not null check (quantity between 1 and 999),
  line_total_cents bigint generated always as (unit_price_cents * quantity) stored,
  vat_bp           integer not null check (vat_bp between 0 and 10000),
  station          text not null default 'kitchen',
  note             text check (length(note) <= 200),
  kitchen_sent_at  timestamptz,      -- printed / shown in kitchen
  staff_id         uuid,
  created_at       timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, menu_item_id)
    references public.menu_items (restaurant_id, id) on delete set null (menu_item_id),
  foreign key (restaurant_id, variant_id)
    references public.item_variants (restaurant_id, id) on delete set null (variant_id),
  foreign key (restaurant_id, staff_id)
    references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index order_lines_order_idx on public.order_lines (restaurant_id, order_id);

-- Several payments per order: cash + card, split bill per person, tips per staff.
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id      uuid not null,
  method        text not null check (method in ('cash', 'card', 'transfer', 'other')),
  amount_cents  bigint not null check (amount_cents > 0),
  tip_cents     bigint not null default 0 check (tip_cents >= 0),
  staff_id      uuid,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, order_id)
    references public.orders (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, staff_id)
    references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index payments_order_idx on public.payments (restaurant_id, order_id);

-- Cash in/out of the drawer that is not a sale: paying a supplier from the
-- till, the morning float, a bank deposit. Never counts as revenue.
create table public.cash_movements (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  business_date date not null,
  kind          text not null check (kind in ('float', 'payout', 'deposit')),
  amount_cents  bigint not null check (amount_cents > 0),
  reason        text not null check (length(reason) between 2 and 200),
  staff_id      uuid,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, staff_id)
    references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index cash_movements_day_idx on public.cash_movements (restaurant_id, business_date);

-- Z report: one row per closed business day, figures frozen at closing time.
create table public.day_closures (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  business_date date not null,
  totals        jsonb not null,
  closed_by_staff_id uuid,
  closed_at     timestamptz not null default now(),
  primary key (restaurant_id, business_date),
  foreign key (restaurant_id, closed_by_staff_id)
    references public.staff (restaurant_id, id) on delete set null (closed_by_staff_id)
);

-- =============================================================================
-- Triggers protecting the order lifecycle
-- =============================================================================
-- These trigger functions deliberately run as the INVOKER (no security
-- definer): app.is_client() looks at current_user, which a security definer
-- trigger would replace by the function owner, silently disabling the column
-- protection. When a server function (security definer) writes, current_user
-- is the owner and the protection is correctly skipped.

-- True only inside admin_purge_demo_restaurant() (demo tenants only).
create or replace function app.purging()
returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(current_setting('app.purge', true), '') = 'on' $$;

-- Orders: on insert by a client, fill server-owned fields.
create or replace function app.orders_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where id = new.restaurant_id;
  if r.id is null then
    -- not visible to the caller: RLS would reject the row anyway, fail clearly
    raise exception 'not allowed' using errcode = '42501';
  end if;
  new.business_date := app.business_date(r);
  new.ticket_number := app.next_counter(new.restaurant_id, 'ticket:' || new.business_date::text);

  if app.is_client() then
    -- QR orders only through place_order(); the till cannot create closed or
    -- discounted orders directly.
    if new.source = 'qr' then
      raise exception 'qr orders must use place_order()' using errcode = '42501';
    end if;
    new.status := 'new';
    new.subtotal_cents := 0;
    new.discount_cents := 0;
    new.total_cents := 0;
    new.discount_by_staff_id := null;
    new.cancelled_at := null;
    new.cancelled_by_staff_id := null;
    new.cancel_reason := null;
    new.closed_at := null;
    new.fiscal_document_id := null;
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger orders_before_insert before insert on public.orders
  for each row execute function app.orders_before_insert();

-- Orders: on update, recompute totals and protect server-owned fields.
create or replace function app.orders_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.restaurant_id <> old.restaurant_id or new.id <> old.id
     or new.client_id <> old.client_id or new.business_date <> old.business_date
     or new.ticket_number <> old.ticket_number or new.source <> old.source
     or new.created_at <> old.created_at then
    raise exception 'order identity fields cannot be changed' using errcode = '42501';
  end if;

  -- a closed order is frozen, except the kitchen can still mark it served
  if old.closed_at is not null then
    if (to_jsonb(new) - '{status,updated_at}'::text[]) <> (to_jsonb(old) - '{status,updated_at}'::text[])
       or new.status = 'cancelled' then
      raise exception 'order is closed, use a credit note to correct it' using errcode = '42501';
    end if;
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled order cannot be reopened' using errcode = '42501';
  end if;

  if app.is_client() then
    -- discount, cancellation and closing only through server functions,
    -- which check the manager PIN and write the audit trail
    if new.discount_cents <> old.discount_cents
       or new.discount_by_staff_id is distinct from old.discount_by_staff_id
       or new.cancelled_at is distinct from old.cancelled_at
       or new.cancelled_by_staff_id is distinct from old.cancelled_by_staff_id
       or new.cancel_reason is distinct from old.cancel_reason
       or (new.status = 'cancelled' and old.status <> 'cancelled')
       or new.closed_at is distinct from old.closed_at
       or new.fiscal_document_id is distinct from old.fiscal_document_id then
      raise exception 'use the dedicated function for discounts, cancellation and payment'
        using errcode = '42501';
    end if;
  end if;

  if old.closed_at is null then
    new.subtotal_cents := (
      select coalesce(sum(l.line_total_cents), 0)
      from public.order_lines l
      where l.restaurant_id = new.restaurant_id and l.order_id = new.id
    );
    if new.discount_cents > new.subtotal_cents then
      new.discount_cents := new.subtotal_cents;
    end if;
    new.total_cents := new.subtotal_cents - new.discount_cents;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger orders_before_update before update on public.orders
  for each row execute function app.orders_before_update();

create or replace function app.orders_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.closed_at is not null and not app.purging() then
    raise exception 'closed orders cannot be deleted' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger orders_before_delete before delete on public.orders
  for each row execute function app.orders_before_delete();

-- Helper: raise if the order is closed or cancelled.
create or replace function app.assert_order_open(p_restaurant_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o record;
begin
  select closed_at, status into o from public.orders
  where restaurant_id = p_restaurant_id and id = p_order_id;
  if not found then
    return; -- parent being deleted (cascade), nothing to protect
  end if;
  if o.closed_at is not null then
    raise exception 'order is closed' using errcode = '42501';
  end if;
  if o.status = 'cancelled' then
    raise exception 'order is cancelled' using errcode = '42501';
  end if;
end $$;

-- Order lines: prices always come from the menu (server truth), never from
-- the browser. Only free lines (no menu item) carry a typed price.
create or replace function app.order_lines_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  it public.menu_items;
  v  public.item_variants;
  c  public.categories;
  r  public.restaurants;
  lang text;
begin
  if tg_op = 'DELETE' then
    if app.purging() then
      return old;
    end if;
    if app.is_client() then
      perform app.assert_order_open(old.restaurant_id, old.order_id);
    else
      -- server functions and cascades: only block when the order still exists and is closed
      perform 1 from public.orders o
       where o.restaurant_id = old.restaurant_id and o.id = old.order_id and o.closed_at is not null;
      if found then
        raise exception 'order is closed' using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  perform app.assert_order_open(new.restaurant_id, new.order_id);

  if tg_op = 'UPDATE' then
    if new.order_id <> old.order_id or new.restaurant_id <> old.restaurant_id
       or new.menu_item_id is distinct from old.menu_item_id
       or new.variant_id is distinct from old.variant_id
       or new.unit_price_cents <> old.unit_price_cents
       or new.name <> old.name or new.vat_bp <> old.vat_bp
       or new.created_at <> old.created_at then
      raise exception 'only quantity, note, station and kitchen status can change on a line'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT
  select * into r from public.restaurants where id = new.restaurant_id;
  lang := r.languages[1];
  if new.menu_item_id is not null then
    select * into it from public.menu_items
     where restaurant_id = new.restaurant_id and id = new.menu_item_id;
    select * into c from public.categories
     where restaurant_id = new.restaurant_id and id = it.category_id;
    new.name := coalesce(it.name ->> lang, it.name ->> 'fr', (select value #>> '{}' from jsonb_each(it.name) limit 1), 'Article');
    new.unit_price_cents := it.price_cents;
    new.vat_bp := coalesce(it.vat_bp, r.default_vat_bp);
    new.station := coalesce(it.station, c.station, 'kitchen');
    if new.variant_id is not null then
      select * into v from public.item_variants
       where restaurant_id = new.restaurant_id and id = new.variant_id and menu_item_id = it.id;
      if v.id is null then
        raise exception 'variant does not belong to item' using errcode = '23503';
      end if;
      new.name := new.name || ' (' || coalesce(v.name ->> lang, v.name ->> 'fr', '') || ')';
      new.unit_price_cents := v.price_cents;
    end if;
  else
    if new.variant_id is not null then
      raise exception 'variant without item' using errcode = '23503';
    end if;
    if new.vat_bp is null then
      new.vat_bp := r.default_vat_bp;
    end if;
  end if;
  if app.is_client() then
    new.created_at := now();
    new.kitchen_sent_at := null;
  end if;
  return new;
end $$;
create trigger order_lines_before_write before insert or update or delete on public.order_lines
  for each row execute function app.order_lines_before_write();

-- After any line change, touch the order so its totals are recomputed.
create or replace function app.order_lines_after_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare rid uuid; oid uuid;
begin
  rid := coalesce(new.restaurant_id, old.restaurant_id);
  oid := coalesce(new.order_id, old.order_id);
  update public.orders set updated_at = now()
   where restaurant_id = rid and id = oid and closed_at is null;
  return null;
end $$;
create trigger order_lines_after_write after insert or update or delete on public.order_lines
  for each row execute function app.order_lines_after_write();

-- Payments: only on open orders, immutable once made (delete + re-add while open).
create or replace function app.payments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'payments cannot be edited, delete and add again' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if app.purging() then
      return old;
    end if;
    perform 1 from public.orders o
     where o.restaurant_id = old.restaurant_id and o.id = old.order_id and o.closed_at is not null;
    if found then
      raise exception 'order is closed' using errcode = '42501';
    end if;
    return old;
  end if;
  perform app.assert_order_open(new.restaurant_id, new.order_id);
  if app.is_client() then
    new.created_at := now();
  end if;
  return new;
end $$;
create trigger payments_before_write before insert or update or delete on public.payments
  for each row execute function app.payments_before_write();

-- Cash movements: append only, business date set by the server.
create or replace function app.cash_movements_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r public.restaurants;
begin
  if tg_op = 'DELETE' and app.purging() then
    return old;
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'cash movements are append only' using errcode = '42501';
  end if;
  select * into r from public.restaurants where id = new.restaurant_id;
  if r.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  new.business_date := app.business_date(r);
  new.created_at := now();
  if exists (select 1 from public.day_closures d
             where d.restaurant_id = new.restaurant_id and d.business_date = new.business_date) then
    raise exception 'business day already closed' using errcode = 'P0001', hint = 'day_closed';
  end if;
  return new;
end $$;
create trigger cash_movements_before_write before insert or update or delete on public.cash_movements
  for each row execute function app.cash_movements_before_write();

create or replace function app.day_closures_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- only app.purge_demo_restaurant() may remove rows, for demo tenants
  if tg_op = 'DELETE' and app.purging() then
    return old;
  end if;
  raise exception 'day closures cannot be changed' using errcode = '42501';
end $$;
create trigger day_closures_immutable before update or delete on public.day_closures
  for each row execute function app.day_closures_immutable();
