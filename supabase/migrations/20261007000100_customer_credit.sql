-- =============================================================================
-- 0030 CUSTOMER CREDIT ("L'ARDOISE")
-- =============================================================================
-- A regular may eat now and pay later. The manager allows it per customer, with
-- a limit. At the till the order is paid with the method 'account': the fiscal
-- ticket is issued as usual (the sale is made), the customer's balance goes up.
-- Later the customer settles in cash, by card or by transfer: the balance goes
-- down and, for cash, the drawer expects the money. A credit note on an ardoise
-- ticket lowers the balance again. Everything is kept in a ledger, from which
-- the monthly statement is built.
--
-- Switch: restaurants.loyalty ->> 'credit' (needs the customer file).
-- =============================================================================

-- ------------------------------------------------------------ data
alter table public.customers
  add column if not exists credit_allowed boolean not null default false,
  add column if not exists credit_limit_cents bigint check (credit_limit_cents between 0 and 100000000),
  -- what the customer owes (negative: the restaurant owes, after a refund)
  add column if not exists balance_cents bigint not null default 0;

create table if not exists public.customer_account_ledger (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id   uuid not null,
  -- sale: put on the ardoise; refund: credit note on such a sale;
  -- payment: the customer settles; adjust: correction by a manager
  kind          text not null check (kind in ('sale', 'refund', 'payment', 'adjust')),
  amount_cents  bigint not null check (amount_cents <> 0),   -- + debt up, - debt down
  method        text check (method in ('cash', 'card', 'transfer')),
  order_id      uuid,
  document_id   uuid,
  doc_number    text,
  note          text check (length(note) <= 200),
  staff_id      uuid,
  business_date date not null,
  balance_after bigint not null,
  created_at    timestamptz not null default now(),
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete cascade
);
create index if not exists customer_account_ledger_idx
  on public.customer_account_ledger (restaurant_id, customer_id, created_at);
create index if not exists customer_account_ledger_day_idx
  on public.customer_account_ledger (restaurant_id, business_date) where kind = 'payment';

alter table public.customer_account_ledger enable row level security;
grant select on public.customer_account_ledger to authenticated;
drop policy if exists customer_account_ledger_select on public.customer_account_ledger;
create policy customer_account_ledger_select on public.customer_account_ledger for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- a new payment method
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'transfer', 'other', 'account'));

-- ------------------------------------------------------------ guards
-- The balance only moves through the server (sales, credit notes, settlements).
create or replace function app.customers_balance_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if app.is_client() then new.balance_cents := 0; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.balance_cents is distinct from old.balance_cents and app.is_client() then
      raise exception 'the balance can only change through the till' using errcode = '42501';
    end if;
    if new.credit_allowed and new.credit_limit_cents is null then
      new.credit_limit_cents := 0;
    end if;
    return new;
  end if;
  -- DELETE: a customer who still owes (or is owed) money cannot be forgotten yet
  if old.balance_cents <> 0 and not app.purging() then
    raise exception 'customer has an open balance' using errcode = 'P0001', hint = 'open_balance';
  end if;
  return old;
end $$;
drop trigger if exists customers_balance_guard on public.customers;
create trigger customers_balance_guard before insert or update or delete on public.customers
  for each row execute function app.customers_balance_guard();

-- move a balance and write the ledger line (the only way the balance changes)
create or replace function app.account_move(
  p_restaurant_id uuid, p_customer_id uuid, p_kind text, p_amount bigint, p_method text,
  p_order_id uuid, p_document_id uuid, p_doc_number text, p_note text, p_staff_id uuid, p_date date)
returns bigint language plpgsql security definer set search_path = '' as $$
declare bal bigint;
begin
  update public.customers set balance_cents = balance_cents + p_amount
   where restaurant_id = p_restaurant_id and id = p_customer_id
  returning balance_cents into bal;
  if bal is null then return null; end if;   -- customer removed: nothing to track
  insert into public.customer_account_ledger
    (restaurant_id, customer_id, kind, amount_cents, method, order_id, document_id, doc_number, note, staff_id, business_date, balance_after)
  values (p_restaurant_id, p_customer_id, p_kind, p_amount, p_method, p_order_id, p_document_id, p_doc_number,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_staff_id, p_date, bal);
  return bal;
end $$;
revoke all on function app.account_move(uuid, uuid, text, bigint, text, uuid, uuid, text, text, uuid, date)
  from public, anon, authenticated;

-- A ticket (or its credit note) with ardoise payments moves the customer's balance.
create or replace function app.fiscal_documents_account()
returns trigger language plpgsql security definer set search_path = '' as $$
declare amt bigint; cid uuid;
begin
  select coalesce(sum((p ->> 'amount')::bigint), 0) into amt
    from jsonb_array_elements(new.payments) p where p ->> 'method' = 'account';
  if amt = 0 then return null; end if;
  select customer_id into cid from public.orders where restaurant_id = new.restaurant_id and id = new.order_id;
  if cid is null then return null; end if;
  perform app.account_move(new.restaurant_id, cid, case when amt > 0 then 'sale' else 'refund' end, amt, null,
                           new.order_id, new.id, new.doc_number, new.reason, new.staff_id, new.business_date);
  return null;
end $$;
drop trigger if exists fiscal_documents_account on public.fiscal_documents;
create trigger fiscal_documents_account after insert on public.fiscal_documents
  for each row execute function app.fiscal_documents_account();

-- ------------------------------------------------------------ paying
create or replace function public.pos_pay_order(
  p_order_id uuid, p_payments jsonb, p_staff_id uuid default null, p_buyer jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  r public.restaurants;
  c public.customers;
  p jsonb;
  on_account bigint := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_already_closed'); end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 20 then
    perform app.fail('invalid_request', 'payments');
  end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff where restaurant_id = o.restaurant_id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  for p in select * from jsonb_array_elements(p_payments) loop
    if (p ->> 'method') not in ('cash', 'card', 'transfer', 'other', 'account')
       or (p ->> 'amount_cents') !~ '^[0-9]{1,12}$' or (p ->> 'amount_cents')::bigint <= 0
       or coalesce(p ->> 'tip_cents', '0') !~ '^[0-9]{1,12}$' then
      perform app.fail('invalid_request', 'payment');
    end if;
    if p ->> 'method' = 'account' then
      -- no tip on credit: a tip is money handed to the staff now
      if coalesce((p ->> 'tip_cents')::bigint, 0) <> 0 then perform app.fail('invalid_request', 'tip_on_account'); end if;
      on_account := on_account + (p ->> 'amount_cents')::bigint;
    end if;
  end loop;

  if on_account > 0 then
    if not coalesce((r.loyalty ->> 'customers')::boolean, false) or not coalesce((r.loyalty ->> 'credit')::boolean, false) then
      perform app.fail('credit_off');
    end if;
    if o.customer_id is null then perform app.fail('no_customer'); end if;
    select * into c from public.customers where restaurant_id = r.id and id = o.customer_id for update;
    if c.id is null then perform app.fail('no_customer'); end if;
    if not c.credit_allowed then perform app.fail('credit_not_allowed'); end if;
    if c.balance_cents + on_account > coalesce(c.credit_limit_cents, 0) then
      perform app.fail('credit_limit', format('balance=%s limit=%s', c.balance_cents, coalesce(c.credit_limit_cents, 0)));
    end if;
  end if;

  for p in select * from jsonb_array_elements(p_payments) loop
    insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents, staff_id)
    values (o.restaurant_id, o.id, p ->> 'method', (p ->> 'amount_cents')::bigint,
            coalesce((p ->> 'tip_cents')::bigint, 0), coalesce(p_staff_id, o.staff_id));
  end loop;
  return public.close_order(o.id, p_staff_id, p_buyer);
end $$;
revoke all on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ the till
create or replace function app.customer_card(c public.customers, r public.restaurants)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'visits', c.visits)
      || case when coalesce((r.loyalty ->> 'credit')::boolean, false) then
           jsonb_build_object('credit_allowed', c.credit_allowed, 'credit_limit_cents', c.credit_limit_cents,
                              'balance_cents', c.balance_cents)
         else '{}'::jsonb end
$$;
revoke all on function app.customer_card(public.customers, public.restaurants) from public, anon, authenticated;

create or replace function public.pos_find_customer(p_restaurant_id uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c public.customers;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  select * into c from public.customers where restaurant_id = r.id and phone = app.norm_phone(p_phone);
  if c.id is null then return null; end if;
  return app.customer_card(c, r);
end $$;

create or replace function public.pos_attach_customer(p_order_id uuid, p_phone text, p_name text default null, p_marketing_ok boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; cid uuid; c public.customers;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  cid := app.customer_for(o.restaurant_id, p_phone, p_name);
  if cid is null then perform app.fail('invalid_phone'); end if;
  update public.customers set name = coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''), name),
         marketing_ok = coalesce(p_marketing_ok, marketing_ok)
   where id = cid returning * into c;
  update public.orders set customer_id = cid where id = o.id;
  return app.customer_card(c, r);
end $$;

-- the customer of an open order, with the ardoise (for the payment screen)
create or replace function public.pos_order_customer(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; c public.customers;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', false);
  if o.customer_id is null or not coalesce((r.loyalty ->> 'customers')::boolean, false) then return null; end if;
  select * into c from public.customers where restaurant_id = r.id and id = o.customer_id;
  if c.id is null then return null; end if;
  return app.customer_card(c, r);
end $$;

-- The customer settles (part of) the ardoise at the till.
create or replace function public.pos_account_payment(
  p_restaurant_id uuid, p_customer_id uuid, p_amount_cents bigint, p_method text, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; c public.customers; dt date; bal bigint;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) or not coalesce((r.loyalty ->> 'credit')::boolean, false) then
    perform app.fail('credit_off');
  end if;
  if p_method not in ('cash', 'card', 'transfer') then perform app.fail('invalid_request', 'method'); end if;
  if p_amount_cents is null or p_amount_cents <= 0 then perform app.fail('invalid_request', 'amount'); end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where restaurant_id = r.id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  dt := app.business_date(r);
  if exists (select 1 from public.day_closures where restaurant_id = r.id and business_date = dt) then
    perform app.fail('day_closed');
  end if;
  select * into c from public.customers where restaurant_id = r.id and id = p_customer_id for update;
  if c.id is null then perform app.fail('not_found', 'customer'); end if;
  if p_amount_cents > c.balance_cents then perform app.fail('more_than_balance', c.balance_cents::text); end if;
  bal := app.account_move(r.id, c.id, 'payment', -p_amount_cents, p_method, null, null, null, null, p_staff_id, dt);
  return jsonb_build_object('ok', true, 'balance_cents', bal, 'amount_cents', p_amount_cents, 'method', p_method,
                            'name', c.name, 'phone', c.phone, 'business_date', dt, 'at', now());
end $$;

-- ------------------------------------------------------------ the manager
-- A correction by hand (a forgotten payment, a gesture): logged with a reason.
create or replace function public.customer_account_adjust(p_customer_id uuid, p_amount_cents bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.customers; r public.restaurants; bal bigint;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(c.restaurant_id, 'manager', true);
  if p_amount_cents is null or p_amount_cents = 0 or abs(p_amount_cents) > 100000000 then perform app.fail('invalid_request', 'amount'); end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then perform app.fail('reason_required'); end if;
  bal := app.account_move(r.id, c.id, 'adjust', p_amount_cents, null, null, null, null, p_note, null, app.business_date(r));
  return jsonb_build_object('ok', true, 'balance_cents', bal);
end $$;

-- Statement of a period: what was owed before, every line, what is owed after.
create or replace function public.customer_statement(p_customer_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; r public.restaurants; opening bigint; lines jsonb;
begin
  select * into c from public.customers where id = p_customer_id;
  if c.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(c.restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then perform app.fail('invalid_request', 'period'); end if;
  select coalesce(sum(amount_cents), 0) into opening from public.customer_account_ledger
   where restaurant_id = r.id and customer_id = c.id and business_date < p_from;
  select coalesce(jsonb_agg(jsonb_build_object('date', business_date, 'at', created_at, 'kind', kind, 'amount_cents', amount_cents,
                                               'method', method, 'doc_number', doc_number, 'note', note) order by created_at, id), '[]')
    into lines from public.customer_account_ledger
   where restaurant_id = r.id and customer_id = c.id and business_date between p_from and p_to;
  return jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'credit_limit_cents', c.credit_limit_cents),
    'restaurant', jsonb_build_object('name', r.name, 'phone', r.phone),
    'from', p_from, 'to', p_to, 'opening_cents', opening,
    'debits_cents', (select coalesce(sum((x ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(lines) x where (x ->> 'amount_cents')::bigint > 0),
    'credits_cents', (select coalesce(-sum((x ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(lines) x where (x ->> 'amount_cents')::bigint < 0),
    'closing_cents', opening + (select coalesce(sum((x ->> 'amount_cents')::bigint), 0) from jsonb_array_elements(lines) x),
    'balance_cents', c.balance_cents,
    'lines', lines);
end $$;

revoke all on function public.pos_find_customer(uuid, text) from public, anon;
revoke all on function public.pos_attach_customer(uuid, text, text, boolean) from public, anon;
revoke all on function public.pos_order_customer(uuid) from public, anon;
revoke all on function public.pos_account_payment(uuid, uuid, bigint, text, uuid) from public, anon;
revoke all on function public.customer_account_adjust(uuid, bigint, text) from public, anon;
revoke all on function public.customer_statement(uuid, date, date) from public, anon;
grant execute on function public.pos_find_customer(uuid, text) to authenticated;
grant execute on function public.pos_attach_customer(uuid, text, text, boolean) to authenticated;
grant execute on function public.pos_order_customer(uuid) to authenticated;
grant execute on function public.pos_account_payment(uuid, uuid, bigint, text, uuid) to authenticated;
grant execute on function public.customer_account_adjust(uuid, bigint, text) to authenticated;
grant execute on function public.customer_statement(uuid, date, date) to authenticated;

-- ------------------------------------------------------------ day figures
-- Same as before, plus the ardoise: sales put on credit (no money in) and what
-- customers paid back today (cash ones are expected in the drawer).
create or replace function app.day_totals(p_restaurant_id uuid, p_date date)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  with docs as (
    select * from public.fiscal_documents
     where restaurant_id = p_restaurant_id and business_date = p_date
  ),
  pays as (
    select p ->> 'method' method, (p ->> 'amount')::bigint amount, (p ->> 'tip')::bigint tip
      from docs, jsonb_array_elements(docs.payments) p
  ),
  vat as (
    select (v ->> 'vat_bp')::int vat_bp, sum((v ->> 'ht')::bigint) ht,
           sum((v ->> 'vat')::bigint) vat, sum((v ->> 'ttc')::bigint) ttc
      from docs, jsonb_array_elements(docs.vat_breakdown) v group by 1
  ),
  cash as (
    select kind, sum(amount_cents) amount from public.cash_movements
     where restaurant_id = p_restaurant_id and business_date = p_date group by kind
  ),
  settled as (
    select method, -sum(amount_cents) amount from public.customer_account_ledger
     where restaurant_id = p_restaurant_id and business_date = p_date and kind = 'payment' group by method
  )
  select jsonb_build_object(
    'business_date', p_date,
    'tickets', (select count(*) from docs where doc_type <> 'credit_note'),
    'credit_notes', (select count(*) from docs where doc_type = 'credit_note'),
    'credit_notes_cents', (select coalesce(sum(total_ttc_cents), 0) from docs where doc_type = 'credit_note'),
    'revenue_ttc_cents', (select coalesce(sum(total_ttc_cents), 0) from docs),
    'revenue_ht_cents', (select coalesce(sum(total_ht_cents), 0) from docs),
    'vat_cents', (select coalesce(sum(total_vat_cents), 0) from docs),
    'discounts_cents', (select coalesce(sum(discount_cents), 0) from docs),
    'vat_breakdown', (select coalesce(jsonb_agg(to_jsonb(vat) order by vat_bp), '[]') from vat),
    'payments', (select coalesce(jsonb_object_agg(method, amount), '{}')
                   from (select method, sum(amount) amount from pays group by method) s),
    'tips_cents', (select coalesce(sum(tip), 0) from pays),
    'cash_float_cents', (select coalesce(sum(amount), 0) from cash where kind = 'float'),
    'cash_payouts_cents', (select coalesce(sum(amount), 0) from cash where kind = 'payout'),
    'cash_deposits_cents', (select coalesce(sum(amount), 0) from cash where kind = 'deposit'),
    'account_sales_cents', (select coalesce(sum(amount), 0) from pays where method = 'account'),
    'account_received', (select coalesce(jsonb_object_agg(method, amount), '{}') from settled),
    'account_received_cents', (select coalesce(sum(amount), 0) from settled),
    -- what should physically be in the drawer: float + cash sales + cash tips
    -- + ardoises paid back in cash - money taken out
    'expected_cash_cents',
       (select coalesce(sum(amount), 0) from cash where kind = 'float')
     + (select coalesce(sum(amount + tip), 0) from pays where method = 'cash')
     + (select coalesce(sum(amount), 0) from settled where method = 'cash')
     - (select coalesce(sum(amount), 0) from cash where kind in ('payout', 'deposit')),
    'open_orders', (select count(*) from public.orders
                     where restaurant_id = p_restaurant_id and business_date = p_date
                       and closed_at is null and status <> 'cancelled' and total_cents > 0),
    'cancelled_orders', (select count(*) from public.orders
                          where restaurant_id = p_restaurant_id and business_date = p_date
                            and status = 'cancelled'),
    'by_staff', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', name,
                                                              'revenue_ttc_cents', total) order by total desc), '[]')
                   from (select d.staff_id, s.name, sum(d.total_ttc_cents) total
                           from docs d left join public.staff s on s.id = d.staff_id
                          group by d.staff_id, s.name) x)
  )
$$;
revoke all on function app.day_totals(uuid, date) from public, anon, authenticated;
