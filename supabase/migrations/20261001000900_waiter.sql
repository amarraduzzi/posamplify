-- =============================================================================
-- 0022 TAKING ORDERS ON A PHONE (waiter mode)
-- =============================================================================
-- A waiter's phone has no ticket printer. When it sends lines to the kitchen it
-- asks for them to be printed (print_requested_at); every till that has a
-- printer picks them up and prints the bons. claim_kitchen_lines hands each
-- line to exactly one till (no double bons with two printing tills).
-- =============================================================================

alter table public.order_lines add column if not exists print_requested_at timestamptz;
create index if not exists order_lines_print_idx on public.order_lines (restaurant_id)
  where print_requested_at is not null and kitchen_sent_at is null;

-- Takes the lines waiting for a printer and marks them sent, atomically.
-- Returns them, so the calling till prints exactly those.
create or replace function public.claim_kitchen_lines(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.restaurants; res jsonb;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  with pick as (
    select l.id from public.order_lines l
      join public.orders o on o.restaurant_id = l.restaurant_id and o.id = l.order_id
     where l.restaurant_id = r.id and l.print_requested_at is not null and l.kitchen_sent_at is null
       and o.closed_at is null and o.status <> 'cancelled'
     for update of l skip locked),
  upd as (
    update public.order_lines l set kitchen_sent_at = now()
      from pick where l.id = pick.id
    returning l.id, l.order_id, l.station, l.quantity, l.name, l.note, l.staff_id, l.created_at)
  select coalesce(jsonb_agg(to_jsonb(upd) order by upd.created_at), '[]'::jsonb) into res from upd;
  return res;
end $$;
revoke all on function public.claim_kitchen_lines(uuid) from public, anon;
grant execute on function public.claim_kitchen_lines(uuid) to authenticated;

-- a line sent from a phone counts as sent to the kitchen in the team report
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
