-- =============================================================================
-- 0020 AMPLIFY PROFIT: the team (clock-in, labour cost, who does what)
-- =============================================================================
-- * Clock-in / clock-out with the staff PIN on the till (pos_clock), or hours
--   typed by the manager (restaurants without Amplify POS, corrections).
-- * Cost per hour per person, in its own table: the till reads the staff list,
--   it must never see what people earn.
-- * staff_report: hours, labour cost and % of revenue; with Amplify POS also
--   per person: sales, discounts, cancellations, lines removed after being sent
--   to the kitchen, credit notes, tips, cash taken out, and a "to watch" flag.
-- Moroccan law 09-08: the owner informs the team (the screen reminds him).
-- =============================================================================

create table public.staff_shifts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  staff_id      uuid not null,
  clock_in      timestamptz not null,
  clock_out     timestamptz,
  source        text not null default 'manual' check (source in ('pos', 'manual')),
  note          text check (length(note) <= 200),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  check (clock_out is null or (clock_out > clock_in and clock_out - clock_in <= interval '20 hours')),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);
create index staff_shifts_idx on public.staff_shifts (restaurant_id, clock_in desc);
create unique index staff_shifts_one_open on public.staff_shifts (staff_id) where clock_out is null;
create trigger staff_shifts_touch before update on public.staff_shifts
  for each row execute function app.touch_updated_at();
create trigger staff_shifts_same_tenant before update on public.staff_shifts
  for each row execute function app.forbid_restaurant_change();

create table public.staff_rates (
  staff_id          uuid primary key,
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  -- what one hour of this person costs the restaurant (salary + CNSS/AMO), in centimes
  hourly_cost_cents bigint not null check (hourly_cost_cents between 0 and 1000000),
  updated_at        timestamptz not null default now(),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);
create trigger staff_rates_touch before update on public.staff_rates
  for each row execute function app.touch_updated_at();
create trigger staff_rates_same_tenant before update on public.staff_rates
  for each row execute function app.forbid_restaurant_change();

alter table public.staff_shifts enable row level security;
alter table public.staff_rates  enable row level security;
grant select, insert, update, delete on public.staff_shifts to authenticated;
grant select, insert, update, delete on public.staff_rates  to authenticated;
do $$
declare t text;
begin
  foreach t in array array['staff_shifts', 'staff_rates'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
    $f$, t);
  end loop;
end $$;
-- corrections of hours are visible in the audit log
create trigger audit_staff_shifts after insert or update or delete on public.staff_shifts
  for each row execute function app.audit();
create trigger audit_staff_rates after insert or update or delete on public.staff_rates
  for each row execute function app.audit();

-- ------------------------------------------------------------ clock in / out on the till
-- Same PIN as the till. Toggles: in when not in, out when in. A shift left open
-- for more than 16 hours was a forgotten clock-out: it stays open for the
-- manager to fix, and this press starts a new shift.
create or replace function public.pos_clock(p_restaurant_id uuid, p_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.restaurants; res text; sh public.staff_shifts; s public.staff; forgot boolean := false;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;
  select * into s from public.staff where restaurant_id = r.id and id = p_staff_id;
  select * into sh from public.staff_shifts where restaurant_id = r.id and staff_id = s.id and clock_out is null for update;

  if sh.id is not null and now() - sh.clock_in <= interval '16 hours' then
    update public.staff_shifts set clock_out = greatest(now(), clock_in + interval '1 minute') where id = sh.id returning * into sh;
    return jsonb_build_object('ok', true, 'action', 'out', 'name', s.name, 'clock_in', sh.clock_in, 'clock_out', sh.clock_out,
                              'minutes', round(extract(epoch from sh.clock_out - sh.clock_in) / 60));
  end if;
  if sh.id is not null then
    -- forgotten: close it at the start + 1 minute and flag it, so the manager sees it
    update public.staff_shifts set clock_out = clock_in + interval '1 minute', note = 'départ oublié' where id = sh.id;
    forgot := true;
  end if;
  insert into public.staff_shifts (restaurant_id, staff_id, clock_in, source) values (r.id, s.id, now(), 'pos') returning * into sh;
  return jsonb_build_object('ok', true, 'action', 'in', 'name', s.name, 'clock_in', sh.clock_in, 'forgot', forgot);
end $$;
revoke all on function public.pos_clock(uuid, uuid, text) from public, anon;
grant execute on function public.pos_clock(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------ the report
-- Business days p_from .. p_to (inclusive). Hours count on the day the shift started.
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
           count(*) filter (where discount_cents > 0) disc_n, sum(discount_cents) disc
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
       and a.changes ->> 'kitchen_sent_at' is not null and a.changes ->> 'staff_id' is not null
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
           coalesce(tp.amt, 0) tips, coalesce(po.n, 0) payout_n, coalesce(po.amt, 0) payout
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
      'leak_cents', s.leaks,
      'leak_bp', case when s.sales + s.canc > 0 then round(s.leaks * 10000.0 / (s.sales + s.canc))::int end,
      -- clearly above the team (2x its rate, at least 3 %) and at least 50 DH
      'watch', s.leaks >= 5000 and s.sales + s.canc > 0
               and s.leaks::numeric / (s.sales + s.canc) > greatest(0.03, 2 * coalesce(t.leaks::numeric / nullif(t.base, 0), 0))
    ) order by s.active desc, s.hours desc, s.sales desc, s.name)
      filter (where s.active or s.hours > 0 or s.orders > 0 or s.canc_n > 0), '[]'::jsonb),
    jsonb_build_object(
      'hours', round(coalesce(sum(s.hours), 0)::numeric, 2),
      'labour_cents', coalesce(sum(s.labour), 0),
      'unpriced_hours', round(coalesce(sum(s.hours) filter (where s.rate is null), 0)::numeric, 2),
      'sales_cents', coalesce(sum(s.sales), 0),
      'leak_cents', coalesce(sum(s.leaks), 0),
      'open_now', count(*) filter (where s.open_now > 0),
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
