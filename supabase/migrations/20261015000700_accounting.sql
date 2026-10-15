-- =============================================================================
-- Accounting: everything the restaurant's accountant needs, ready to import
-- * Accounting entries (écritures) for a period, following the Moroccan chart of accounts (PCGE):
--     VE  sales, one entry per day: sales excl. VAT per rate, VAT collected, money received per method
--     HA  supplier invoices: purchases excl. VAT, VAT recoverable, supplier
--     CA  cash: supplier paid in cash, money taken out of the till, cash taken to the bank
--     BQ  bank: supplier paid by transfer, cheque or card
--   Every entry balances; a gap (rounding, overpayment) goes to a suspense account.
--   The account numbers are defaults the accountant can change once (restaurants.accounting).
-- * A summary (sales and VAT per rate, payments, purchases, VAT estimate), the invoices issued and the
--   supplier invoices of the period.
-- * A private link for the accountant (no login): a long random key the owner can renew or switch off.
-- * Supplier invoices can carry their VAT (vat_cents) and their number.
-- =============================================================================

alter table public.restaurants add column if not exists accounting jsonb not null default '{}'
  check (jsonb_typeof(accounting) = 'object' and length(accounting::text) <= 4000);
alter table public.restaurants add column if not exists accounting_token text unique;
grant update (accounting) on public.restaurants to authenticated;

alter table public.supplier_documents add column if not exists vat_cents bigint;
alter table public.supplier_documents add column if not exists doc_number text check (length(doc_number) <= 40);
alter table public.supplier_documents drop constraint if exists supplier_documents_vat_check;
alter table public.supplier_documents add constraint supplier_documents_vat_check
  check (vat_cents is null or (vat_cents >= 0 and (amount_cents is null or vat_cents <= amount_cents)));

-- the accounts (PCGE), with the restaurant's own numbers on top
create or replace function app.accounts(r public.restaurants)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'sales', '7121', 'vat_out', '4455', 'customers', '3421',
    'cash', '5161', 'card', '5141', 'transfer', '5141', 'other', '5141', 'bank', '5141',
    'purchases', '6121', 'vat_in', '34552', 'suppliers', '4411',
    'suspense', '3500'
  ) || coalesce((select jsonb_object_agg(k, v) from jsonb_each(r.accounting) e(k, v)
                  where jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9A-Za-z]{1,15}$'), '{}');
$$;

create or replace function app.accounting_rows(r public.restaurants, p_from date, p_to date)
returns table (journal text, entry_date date, piece text, account text, label text, debit_cents bigint, credit_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
declare a jsonb := app.accounts(r);
begin
  -- VE: one entry per business day
  return query
  with docs as (
    select * from public.fiscal_documents d where d.restaurant_id = r.id and d.business_date between p_from and p_to
  ), vat as (
    select d.business_date, (v ->> 'vat_bp')::int bp, sum((v ->> 'ht')::bigint) ht, sum((v ->> 'vat')::bigint) vat
      from docs d, jsonb_array_elements(d.vat_breakdown) v group by 1, 2
  ), pay as (
    select d.business_date, p ->> 'method' m, sum((p ->> 'amount')::bigint) amt
      from docs d, jsonb_array_elements(d.payments) p group by 1, 2
  ), lines as (
    select business_date d, 2 o, a ->> 'sales' acc, 'Ventes ' || to_char(business_date, 'DD/MM/YYYY') || ' TVA ' || trim(to_char(bp / 100.0, 'FM990.##')) || '%' lbl, -ht amt from vat
    union all
    select business_date, 3, a ->> 'vat_out', 'TVA facturée ' || to_char(business_date, 'DD/MM/YYYY') || ' ' || trim(to_char(bp / 100.0, 'FM990.##')) || '%', -vat from vat
    union all
    select business_date, 1, case m when 'cash' then a ->> 'cash' when 'card' then a ->> 'card' when 'transfer' then a ->> 'transfer' when 'account' then a ->> 'customers' else a ->> 'other' end,
           'Encaissements ' || case m when 'cash' then 'espèces' when 'card' then 'carte' when 'transfer' then 'virement' when 'account' then 'clients en compte' else 'autres' end || ' ' || to_char(business_date, 'DD/MM/YYYY'), amt from pay
  ), bal as (
    select l.*, 4 o2 from lines l where amt <> 0
    union all
    select d, 4, a ->> 'suspense', 'Écart ' || to_char(d, 'DD/MM/YYYY'), -sum(amt), 5 from lines group by d having sum(amt) <> 0
  )
  select 'VE'::text, b.d, 'J' || to_char(b.d, 'YYYYMMDD'), b.acc, b.lbl,
         greatest(b.amt, 0)::bigint, greatest(-b.amt, 0)::bigint
    from bal b order by b.d, b.o, b.acc;

  -- HA: supplier invoices (several photos of one invoice are one invoice)
  return query
  with inv as (
    select min(sd.doc_date) dd, max(sd.amount_cents) ttc, max(sd.vat_cents) vat, max(sd.doc_number) num,
           coalesce(max(s.name), max(sd.supplier_name), 'Fournisseur') sup, min(sd.id::text) id
      from public.supplier_documents sd left join public.suppliers s on s.id = sd.supplier_id
     where sd.restaurant_id = r.id and sd.doc_date between p_from and p_to and coalesce(sd.amount_cents, 0) > 0
     group by coalesce(sd.supplier_id::text, sd.supplier_name, ''), sd.doc_date, sd.amount_cents, coalesce(sd.note, ''), sd.created_by, date_trunc('minute', sd.created_at)
  )
  select 'HA'::text, i.dd, coalesce(i.num, 'FA' || upper(left(replace(i.id, '-', ''), 8))), x.acc, x.lbl, x.deb, x.cre
    from inv i, lateral (values
      (a ->> 'purchases', 'Achat ' || i.sup || case when i.vat is null then ' (TVA non renseignée)' else '' end, i.ttc - coalesce(i.vat, 0), 0::bigint, 1),
      (a ->> 'vat_in', 'TVA récupérable ' || i.sup, coalesce(i.vat, 0), 0::bigint, 2),
      (a ->> 'suppliers', 'Facture ' || i.sup, 0::bigint, i.ttc, 3)
    ) x(acc, lbl, deb, cre, o)
   where x.deb + x.cre > 0
   order by i.dd, i.sup, x.o;

  -- CA / BQ: suppliers paid
  return query
  select case when e.method = 'cash' then 'CA' else 'BQ' end, e.entry_on, coalesce(nullif(e.reference, ''), 'RF' || upper(left(replace(e.id::text, '-', ''), 8))), x.acc, x.lbl, x.deb, x.cre
    from public.supplier_entries e join public.suppliers s on s.id = e.supplier_id,
         lateral (values
           (a ->> 'suppliers', 'Règlement ' || s.name, e.amount_cents, 0::bigint, 1),
           (case when e.method = 'cash' then a ->> 'cash' else a ->> 'bank' end, 'Règlement ' || s.name, 0::bigint, e.amount_cents, 2)
         ) x(acc, lbl, deb, cre, o)
   where e.restaurant_id = r.id and e.kind = 'payment' and e.entry_on between p_from and p_to
   order by e.entry_on, s.name, x.o;

  -- CA: money out of the till (to be allocated by the accountant) and cash taken to the bank
  return query
  select 'CA'::text, m.business_date, 'CM' || upper(left(replace(m.id::text, '-', ''), 8)), x.acc, x.lbl, x.deb, x.cre
    from public.cash_movements m,
         lateral (values
           (case when m.kind = 'deposit' then a ->> 'bank' else a ->> 'suspense' end,
            case when m.kind = 'deposit' then 'Versement en banque' else 'Sortie de caisse : ' || m.reason end, m.amount_cents, 0::bigint, 1),
           (a ->> 'cash', case when m.kind = 'deposit' then 'Versement en banque' else 'Sortie de caisse : ' || m.reason end, 0::bigint, m.amount_cents, 2)
         ) x(acc, lbl, deb, cre, o)
   where m.restaurant_id = r.id and m.kind in ('payout', 'deposit') and m.business_date between p_from and p_to
   order by m.business_date, x.o;
end $$;

create or replace function app.accounting_pack(r public.restaurants, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then perform app.fail('invalid_request', 'period'); end if;
  with docs as (
    select * from public.fiscal_documents d where d.restaurant_id = r.id and d.business_date between p_from and p_to
  )
  select jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'legal_name', r.legal_name, 'ice', r.ice, 'tax_id', r.tax_id, 'rc', r.rc, 'address', r.address, 'city', r.city),
    'from', p_from, 'to', p_to,
    'accounts', app.accounts(r),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('journal', e.journal, 'date', e.entry_date, 'piece', e.piece, 'account', e.account,
                  'label', e.label, 'debit', e.debit_cents, 'credit', e.credit_cents)), '[]') from app.accounting_rows(r, p_from, p_to) e),
    'days', (select coalesce(jsonb_agg(x order by x ->> 'date'), '[]') from (
               select jsonb_build_object('date', d.business_date, 'tickets', count(*) filter (where d.doc_type <> 'credit_note'),
                 'ht', sum(d.total_ht_cents), 'vat', sum(d.total_vat_cents), 'ttc', sum(d.total_ttc_cents)) x
                 from docs d group by d.business_date) s),
    'vat', (select coalesce(jsonb_agg(x order by (x ->> 'rate')::int), '[]') from (
              select jsonb_build_object('rate', (v ->> 'vat_bp')::int, 'ht', sum((v ->> 'ht')::bigint), 'vat', sum((v ->> 'vat')::bigint), 'ttc', sum((v ->> 'ttc')::bigint)) x
                from docs d, jsonb_array_elements(d.vat_breakdown) v group by (v ->> 'vat_bp')::int) s),
    'payments', (select coalesce(jsonb_object_agg(m, amt), '{}') from (
                   select p ->> 'method' m, sum((p ->> 'amount')::bigint) amt from docs d, jsonb_array_elements(d.payments) p group by 1) s),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('number', d.doc_number, 'type', d.doc_type, 'date', d.business_date,
                   'buyer', d.buyer ->> 'name', 'ice', d.buyer ->> 'ice', 'ht', d.total_ht_cents, 'vat', d.total_vat_cents, 'ttc', d.total_ttc_cents) order by d.issued_at), '[]')
                   from docs d where d.doc_type = 'invoice' or d.series = 'F' or (d.doc_type = 'credit_note' and d.buyer is not null)),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object('date', g.dd, 'supplier', g.sup, 'number', g.num, 'ttc', g.ttc, 'vat', g.vat, 'pages', g.pages) order by g.dd), '[]') from (
                   select min(sd.doc_date) dd, max(sd.amount_cents) ttc, max(sd.vat_cents) vat, max(sd.doc_number) num, count(*) pages,
                          coalesce(max(s.name), max(sd.supplier_name), 'Fournisseur') sup
                     from public.supplier_documents sd left join public.suppliers s on s.id = sd.supplier_id
                    where sd.restaurant_id = r.id and sd.doc_date between p_from and p_to
                    group by coalesce(sd.supplier_id::text, sd.supplier_name, ''), sd.doc_date, sd.amount_cents, coalesce(sd.note, ''), sd.created_by, date_trunc('minute', sd.created_at)) g),
    'cash', (select jsonb_build_object(
               'payouts', coalesce(sum(m.amount_cents) filter (where m.kind = 'payout'), 0),
               'deposits', coalesce(sum(m.amount_cents) filter (where m.kind = 'deposit'), 0))
               from public.cash_movements m where m.restaurant_id = r.id and m.business_date between p_from and p_to),
    'stock_purchases_cents', (select coalesce(sum(sp.total_cents), 0) from public.stock_purchases sp where sp.restaurant_id = r.id and sp.purchased_on between p_from and p_to)
  ) into res;
  return res;
end $$;

-- in the back office (owner and managers)
create or replace function public.accounting_export(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  return app.accounting_pack(r, p_from, p_to);
end $$;
revoke all on function public.accounting_export(uuid, date, date) from public, anon;
grant execute on function public.accounting_export(uuid, date, date) to authenticated;

-- the accountant's private link (no login)
create or replace function public.accounting_export_by_key(p_key text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  if p_key is null or length(p_key) < 24 then perform app.fail('not_found'); end if;
  select * into r from public.restaurants where accounting_token = p_key and status <> 'cancelled';
  if r.id is null then perform app.fail('not_found'); end if;
  return app.accounting_pack(r, p_from, p_to);
end $$;
revoke all on function public.accounting_export_by_key(text, date, date) from public;
grant execute on function public.accounting_export_by_key(text, date, date) to anon, authenticated;

-- create, renew (a new key: the old link stops working) or switch off the accountant's link
create or replace function public.accounting_link(p_restaurant_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; k text;
begin
  r := app.require_role(p_restaurant_id, 'owner', false);
  k := case when p_on then replace(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '/', 'x'), '+', 'z'), '=', '') end;
  update public.restaurants set accounting_token = k where id = r.id;
  return jsonb_build_object('key', k);
end $$;
revoke all on function public.accounting_link(uuid, boolean) from public, anon;
grant execute on function public.accounting_link(uuid, boolean) to authenticated;

-- the accountant sets his own account numbers once, from his link
create or replace function public.accounting_set_accounts_by_key(p_key text, p_accounts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; clean jsonb;
begin
  if p_key is null or length(p_key) < 24 then perform app.fail('not_found'); end if;
  select * into r from public.restaurants where accounting_token = p_key and status <> 'cancelled';
  if r.id is null then perform app.fail('not_found'); end if;
  select coalesce(jsonb_object_agg(k, v), '{}') into clean from jsonb_each(coalesce(p_accounts, '{}')) e(k, v)
   where k in ('sales', 'vat_out', 'customers', 'cash', 'card', 'transfer', 'other', 'bank', 'purchases', 'vat_in', 'suppliers', 'suspense')
     and jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9A-Za-z]{1,15}$';
  update public.restaurants set accounting = clean where id = r.id;
  return jsonb_build_object('ok', true, 'accounts', app.accounts((select x from public.restaurants x where x.id = r.id)));
end $$;
revoke all on function public.accounting_set_accounts_by_key(text, jsonb) from public;
grant execute on function public.accounting_set_accounts_by_key(text, jsonb) to anon, authenticated;
