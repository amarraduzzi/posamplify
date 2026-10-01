-- =============================================================================
-- 0027 CUSTOMERS AND LOYALTY POINTS
-- =============================================================================
-- A customer is known by phone number (one per restaurant). Orders with a
-- phone (take-away, delivery, QR, or a customer attached at the till) fill the
-- file by themselves. Paid orders earn points; points buy a reward (a discount
-- on a later order). Customer data is personal: managers and owners see it,
-- the till only finds one customer by phone through a function (law 09-08).
-- =============================================================================

alter table public.restaurants
  -- OFF unless the owner switches it on:
  -- {"customers": true, "enabled": true, "per_dh": 10, "reward_points": 100, "reward_cents": 5000}
  -- customers = keep a customer file; enabled = loyalty points (1 point per 10 DH; 100 points = 50 DH off)
  add column if not exists loyalty jsonb not null default '{}'::jsonb check (jsonb_typeof(loyalty) = 'object');
grant update (loyalty) on public.restaurants to authenticated;

create or replace function app.norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d ~ '^00212[0-9]{9}$' then '0' || substr(d, 6)
    when d ~ '^212[0-9]{9}$' then '0' || substr(d, 4)
    when d ~ '^[5-7][0-9]{8}$' then '0' || d
    else nullif(d, '') end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') d) x
$$;

create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  phone          text not null check (phone ~ '^[0-9]{6,15}$'),
  name           text check (length(name) <= 60),
  birthday       date,
  note           text check (length(note) <= 300),
  -- agreed to receive WhatsApp messages from the restaurant (offers, birthday)
  marketing_ok   boolean not null default false,
  points         integer not null default 0 check (points >= 0),
  visits         integer not null default 0,
  spent_cents    bigint not null default 0,
  first_visit_at timestamptz,
  last_visit_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, phone)
);
create trigger customers_same_tenant before update on public.customers
  for each row execute function app.forbid_restaurant_change();

create table public.loyalty_ledger (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id   uuid not null,
  order_id      uuid,
  points        integer not null,
  reason        text not null check (reason in ('earn', 'redeem', 'adjust')),
  created_at    timestamptz not null default now(),
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete cascade
);
create index loyalty_ledger_idx on public.loyalty_ledger (restaurant_id, customer_id, created_at desc);

alter table public.orders
  add column if not exists customer_id uuid,
  add column if not exists discount_kind text check (discount_kind in ('loyalty'));
-- no foreign key on purpose: paid orders are frozen (fiscal), so deleting a customer
-- (right to be forgotten) leaves an id that points to nothing instead of rewriting tickets
alter table public.orders drop constraint if exists orders_customer_fk;
create index if not exists orders_customer_idx on public.orders (restaurant_id, customer_id) where customer_id is not null;

alter table public.customers      enable row level security;
alter table public.loyalty_ledger enable row level security;
grant select, insert, update, delete on public.customers to authenticated;
grant select on public.loyalty_ledger to authenticated;
create policy customers_select on public.customers for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy customers_insert on public.customers for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy customers_update on public.customers for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy customers_delete on public.customers for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy loyalty_ledger_select on public.loyalty_ledger for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create trigger audit_customers after update or delete on public.customers
  for each row execute function app.audit();

-- find or create the customer of a phone number
create or replace function app.customer_for(p_restaurant_id uuid, p_phone text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ph text := app.norm_phone(p_phone); cid uuid;
begin
  if ph is null or ph !~ '^[0-9]{6,15}$' then return null; end if;
  insert into public.customers (restaurant_id, phone, name)
  values (p_restaurant_id, ph, nullif(left(btrim(coalesce(p_name, '')), 60), ''))
  on conflict (restaurant_id, phone) do update
    set name = coalesce(public.customers.name, excluded.name)
  returning id into cid;
  return cid;
end $$;

-- an order with a phone number (take-away, delivery, QR) joins the customer file
create or replace function app.orders_customer()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- only the server links a customer (pos_attach_customer or by phone below)
  if tg_op = 'UPDATE' and new.customer_id is distinct from old.customer_id and app.is_client() then
    raise exception 'customer can only be set by the till' using errcode = '42501';
  end if;
  if (tg_op = 'INSERT' or old.closed_at is null) and new.customer_id is null and new.customer_phone is not null
     and coalesce((select (loyalty ->> 'customers')::boolean from public.restaurants where id = new.restaurant_id), false) then
    new.customer_id := app.customer_for(new.restaurant_id, new.customer_phone, new.customer_name);
  end if;
  -- a manager discount replaces a loyalty reward
  if tg_op = 'UPDATE' and new.discount_by_staff_id is not null and new.discount_by_staff_id is distinct from old.discount_by_staff_id then
    new.discount_kind := null;
  end if;
  return new;
end $$;
create trigger orders_customer before insert or update on public.orders
  for each row execute function app.orders_customer();

-- paid: a visit, the amount, and the points
create or replace function app.orders_loyalty()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; pts int; per int;
begin
  if new.customer_id is null or old.closed_at is not null or new.closed_at is null or new.status = 'cancelled' then
    return null;
  end if;
  select * into r from public.restaurants where id = new.restaurant_id;
  per := greatest(1, coalesce((r.loyalty ->> 'per_dh')::int, 10));
  pts := case when coalesce((r.loyalty ->> 'enabled')::boolean, false) and coalesce((r.loyalty ->> 'customers')::boolean, false) then floor(new.total_cents / 100.0 / per)::int else 0 end;
  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers
     set visits = visits + 1, spent_cents = spent_cents + new.total_cents, points = points + pts,
         first_visit_at = coalesce(first_visit_at, new.closed_at), last_visit_at = new.closed_at
   where restaurant_id = new.restaurant_id and id = new.customer_id;
  if pts > 0 then
    insert into public.loyalty_ledger (restaurant_id, customer_id, order_id, points, reason)
    values (new.restaurant_id, new.customer_id, new.id, pts, 'earn');
  end if;
  return null;
end $$;
create trigger orders_loyalty after update on public.orders
  for each row execute function app.orders_loyalty();

-- ------------------------------------------------------------ the till
-- Look up a customer by phone (no list of customers on the till).
create or replace function public.pos_find_customer(p_restaurant_id uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c public.customers;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  select * into c from public.customers where restaurant_id = r.id and phone = app.norm_phone(p_phone);
  if c.id is null then return null; end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'visits', c.visits);
end $$;

-- Attach a customer (found or created) to an open order.
create or replace function public.pos_attach_customer(p_order_id uuid, p_phone text, p_name text default null, p_marketing_ok boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; cid uuid; c public.customers;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if not coalesce((select (loyalty ->> 'customers')::boolean from public.restaurants where id = o.restaurant_id), false) then
    perform app.fail('customers_off');
  end if;
  cid := app.customer_for(o.restaurant_id, p_phone, p_name);
  if cid is null then perform app.fail('invalid_phone'); end if;
  update public.customers set name = coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''), name),
         marketing_ok = coalesce(p_marketing_ok, marketing_ok)
   where id = cid returning * into c;
  update public.orders set customer_id = cid where id = o.id;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'visits', c.visits);
end $$;

-- Use the reward on an open order: the discount is applied and the points are spent.
create or replace function public.pos_redeem_points(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; c public.customers; need int; val bigint;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if not coalesce((r.loyalty ->> 'enabled')::boolean, false) or not coalesce((r.loyalty ->> 'customers')::boolean, false) then
    perform app.fail('loyalty_off');
  end if;
  if o.customer_id is null then perform app.fail('no_customer'); end if;
  if o.discount_cents > 0 then perform app.fail('remove_discount_first'); end if;
  -- the reward is for an order worth more than the reward (a 0 DH ticket cannot be paid)
  if o.subtotal_cents <= coalesce((r.loyalty ->> 'reward_cents')::bigint, 5000) then perform app.fail('order_too_small'); end if;
  need := greatest(1, coalesce((r.loyalty ->> 'reward_points')::int, 100));
  val := greatest(0, coalesce((r.loyalty ->> 'reward_cents')::bigint, 5000));
  select * into c from public.customers where restaurant_id = o.restaurant_id and id = o.customer_id for update;
  if c.points < need then perform app.fail('not_enough_points'); end if;
  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = points - need where id = c.id;
  insert into public.loyalty_ledger (restaurant_id, customer_id, order_id, points, reason) values (o.restaurant_id, c.id, o.id, -need, 'redeem');
  update public.orders set discount_cents = val, discount_kind = 'loyalty', discount_by_staff_id = null where id = o.id
  returning * into o;
  return jsonb_build_object('ok', true, 'discount_cents', o.discount_cents, 'total_cents', o.total_cents, 'points', c.points - need);
end $$;

revoke all on function public.pos_find_customer(uuid, text) from public, anon;
revoke all on function public.pos_attach_customer(uuid, text, text, boolean) from public, anon;
revoke all on function public.pos_redeem_points(uuid) from public, anon;
grant execute on function public.pos_find_customer(uuid, text) to authenticated;
grant execute on function public.pos_attach_customer(uuid, text, text, boolean) to authenticated;
grant execute on function public.pos_redeem_points(uuid) to authenticated;

-- the team report: a loyalty reward is not a staff discount
create or replace function public.staff_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        public.restaurants;
  uses_pos boolean;
  rev_ht   bigint;
  rev_src  text;
  people   jsonb;
  team     jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  uses_pos := 'pos' = any (r.products);

  -- revenue excl. VAT of the period: the till, otherwise the monthly figure typed in Charges (per day)
  select coalesce(sum(total_ht_cents), 0) into rev_ht
    from public.fiscal_documents where restaurant_id = r.id and business_date between p_from and p_to;
  if uses_pos and rev_ht <> 0 then
    rev_src := 'pos';
  else
    select round(sum(f.revenue_ttc_cents * 10000.0 / (10000 + r.default_vat_bp)
                     / extract(day from (date_trunc('month', d) + interval '1 month' - interval '1 day'))))::bigint
      into rev_ht
      from generate_series(p_from, p_to, interval '1 day') d
      join public.month_figures f on f.restaurant_id = r.id and f.month = date_trunc('month', d)::date
     where f.revenue_ttc_cents is not null;
    rev_src := case when rev_ht is not null then 'manual' end;
    rev_ht := coalesce(rev_ht, 0);
  end if;

  with
  sh as (
    select s.staff_id,
           sum(extract(epoch from (coalesce(s.clock_out, least(now(), s.clock_in + interval '16 hours')) - s.clock_in)) / 3600.0) hours,
           count(*) filter (where s.clock_out is null and now() - s.clock_in <= interval '16 hours') open_now,
           count(*) filter (where s.note = 'départ oublié' or (s.clock_out is null and now() - s.clock_in > interval '16 hours')) forgot
      from public.staff_shifts s
     where s.restaurant_id = r.id
       and (s.clock_in at time zone r.timezone)::date between p_from and p_to
     group by 1),
  od as (
    select o.* from public.orders o
     where uses_pos and o.restaurant_id = r.id and o.business_date between p_from and p_to),
  sales as (
    select staff_id, count(*) n, sum(total_cents) ttc,
           -- loyalty rewards are not money the staff let go
           count(*) filter (where discount_cents > 0 and discount_kind is distinct from 'loyalty') disc_n,
           coalesce(sum(discount_cents) filter (where discount_kind is distinct from 'loyalty'), 0) disc
      from od where closed_at is not null and status <> 'cancelled' and staff_id is not null group by 1),
  disc_ok as (   -- discounts this person approved (manager PIN)
    select discount_by_staff_id staff_id, count(*) n, sum(discount_cents) amt
      from od where discount_by_staff_id is not null and discount_cents > 0 and status <> 'cancelled' group by 1),
  canc as (      -- cancelled orders taken by this person
    select staff_id, count(*) n, sum(subtotal_cents) amt from od where status = 'cancelled' and staff_id is not null group by 1),
  canc_ok as (   -- cancellations this person approved
    select cancelled_by_staff_id staff_id, count(*) n, sum(subtotal_cents) amt
      from od where status = 'cancelled' and cancelled_by_staff_id is not null group by 1),
  removed as (   -- lines deleted after they went to the kitchen: served but not on the bill?
    select (a.changes ->> 'staff_id')::uuid staff_id, count(*) n, sum((a.changes ->> 'line_total_cents')::bigint) amt
      from public.audit_log a
     where uses_pos and a.restaurant_id = r.id and a.table_name = 'order_lines' and a.action = 'delete'
       and (a.changes ->> 'kitchen_sent_at' is not null or a.changes ->> 'print_requested_at' is not null)
       and a.changes ->> 'staff_id' is not null
       and (a.created_at at time zone r.timezone)::date between p_from and p_to
     group by 1),
  credits as (
    select staff_id, count(*) n, sum(abs(total_ttc_cents)) amt
      from public.fiscal_documents
     where uses_pos and restaurant_id = r.id and doc_type = 'credit_note' and business_date between p_from and p_to and staff_id is not null
     group by 1),
  tips as (
    select p.staff_id, sum(p.tip_cents) amt
      from public.payments p join od on od.id = p.order_id
     where p.restaurant_id = r.id and p.staff_id is not null and p.tip_cents > 0 group by 1),
  closings as ( -- Z closings done by this person, and what the drawer count said
    select closed_by_staff_id staff_id, count(*) n, count(*) filter (where cash_diff_cents is not null) counted,
           sum(cash_diff_cents) diff, sum(cash_diff_cents) filter (where cash_diff_cents < 0) short
      from public.day_closures
     where uses_pos and restaurant_id = r.id and business_date between p_from and p_to and closed_by_staff_id is not null
     group by 1),
  payouts as (
    select staff_id, count(*) n, sum(amount_cents) amt
      from public.cash_movements
     where uses_pos and restaurant_id = r.id and kind = 'payout' and business_date between p_from and p_to and staff_id is not null
     group by 1),
  rows_ as (
    select st.id, st.name, st.role, st.active, rt.hourly_cost_cents rate,
           coalesce(sh.hours, 0) hours, coalesce(sh.open_now, 0) open_now, coalesce(sh.forgot, 0) forgot,
           case when rt.hourly_cost_cents is not null then round(coalesce(sh.hours, 0) * rt.hourly_cost_cents)::bigint end labour,
           coalesce(sa.n, 0) orders, coalesce(sa.ttc, 0) sales, coalesce(sa.disc_n, 0) disc_n, coalesce(sa.disc, 0) disc,
           coalesce(dk.n, 0) disc_ok_n, coalesce(dk.amt, 0) disc_ok,
           coalesce(ca.n, 0) canc_n, coalesce(ca.amt, 0) canc, coalesce(ck.n, 0) canc_ok_n, coalesce(ck.amt, 0) canc_ok,
           coalesce(rm.n, 0) removed_n, coalesce(rm.amt, 0) removed,
           coalesce(cr.n, 0) credit_n, coalesce(cr.amt, 0) credit,
           coalesce(tp.amt, 0) tips, coalesce(po.n, 0) payout_n, coalesce(po.amt, 0) payout,
           coalesce(cl.n, 0) closings, coalesce(cl.counted, 0) counted, coalesce(cl.diff, 0) cash_diff, coalesce(cl.short, 0) cash_short
      from public.staff st
      left join public.staff_rates rt on rt.staff_id = st.id
      left join sh on sh.staff_id = st.id
      left join sales sa on sa.staff_id = st.id
      left join disc_ok dk on dk.staff_id = st.id
      left join canc ca on ca.staff_id = st.id
      left join canc_ok ck on ck.staff_id = st.id
      left join removed rm on rm.staff_id = st.id
      left join credits cr on cr.staff_id = st.id
      left join tips tp on tp.staff_id = st.id
      left join payouts po on po.staff_id = st.id
      left join closings cl on cl.staff_id = st.id
     where st.restaurant_id = r.id),
  -- money that left the bill on this person's orders: discounts, cancellations, removed lines
  scored as (
    select *, disc + canc + removed leaks from rows_),
  tot as (
    select sum(leaks) leaks, sum(sales) + sum(canc) base from scored)
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', s.id, 'name', s.name, 'role', s.role, 'active', s.active, 'hourly_cost_cents', s.rate,
      'hours', round(s.hours::numeric, 2), 'open_now', s.open_now > 0, 'forgot', s.forgot, 'labour_cents', s.labour,
      'orders', s.orders, 'sales_cents', s.sales, 'avg_ticket_cents', case when s.orders > 0 then round(s.sales::numeric / s.orders)::bigint end,
      'discounts', s.disc_n, 'discount_cents', s.disc, 'discounts_approved', s.disc_ok_n, 'discounts_approved_cents', s.disc_ok,
      'cancellations', s.canc_n, 'cancelled_cents', s.canc, 'cancellations_approved', s.canc_ok_n, 'cancellations_approved_cents', s.canc_ok,
      'removed_lines', s.removed_n, 'removed_cents', s.removed, 'credit_notes', s.credit_n, 'credit_note_cents', s.credit,
      'tips_cents', s.tips, 'payouts', s.payout_n, 'payout_cents', s.payout,
      'closings', s.closings, 'closings_counted', s.counted, 'cash_diff_cents', s.cash_diff, 'cash_short_cents', s.cash_short,
      'leak_cents', s.leaks,
      'leak_bp', case when s.sales + s.canc > 0 then round(s.leaks * 10000.0 / (s.sales + s.canc))::int end,
      -- clearly above the team (2x its rate, at least 3 %) and at least 50 DH
      'watch', s.leaks >= 5000 and s.sales + s.canc > 0
               and s.leaks::numeric / (s.sales + s.canc) > greatest(0.03, 2 * coalesce(t.leaks::numeric / nullif(t.base, 0), 0))
    ) order by s.active desc, s.hours desc, s.sales desc, s.name)
      filter (where s.active or s.hours > 0 or s.orders > 0 or s.canc_n > 0 or s.closings > 0), '[]'::jsonb),
    jsonb_build_object(
      'hours', round(coalesce(sum(s.hours), 0)::numeric, 2),
      'labour_cents', coalesce(sum(s.labour), 0),
      'unpriced_hours', round(coalesce(sum(s.hours) filter (where s.rate is null), 0)::numeric, 2),
      'sales_cents', coalesce(sum(s.sales), 0),
      'leak_cents', coalesce(sum(s.leaks), 0),
      'open_now', count(*) filter (where s.open_now > 0),
      'cash_diff_cents', coalesce(sum(s.cash_diff), 0), 'cash_short_cents', coalesce(sum(s.cash_short), 0),
      'closings_counted', coalesce(sum(s.counted), 0),
      'forgot', coalesce(sum(s.forgot), 0))
    into people, team
    from scored s cross join tot t;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'uses_pos', uses_pos,
    'revenue_ht_cents', rev_ht, 'revenue_source', rev_src,
    'labour_bp', case when rev_ht > 0 then round((team ->> 'labour_cents')::numeric * 10000 / rev_ht)::int end,
    'team', team, 'people', people);
end $$;
revoke all on function public.staff_report(uuid, date, date) from public, anon;
grant execute on function public.staff_report(uuid, date, date) to authenticated;

-- a manager correcting points by hand leaves a trace in the ledger
create or replace function app.customers_points_adjust() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.points is distinct from old.points and coalesce(current_setting('app.loyalty_internal', true), '') <> 'on' then
    insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason)
    values (new.restaurant_id, new.id, new.points - old.points, 'adjust');
  end if;
  return null;
end $$;
drop trigger if exists customers_points_adjust on public.customers;
create trigger customers_points_adjust after update of points on public.customers
  for each row execute function app.customers_points_adjust();
