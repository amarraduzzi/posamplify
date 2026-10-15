-- =============================================================================
-- Cash forecast for the next 30 days
-- * The money available today (cash + bank) is typed by the owner or a manager (cash_position).
-- * Money in: the expected sales per day = the average of the same weekday over the last 8 weeks
--   (till sales; else the imported daily sales; else last month's figure spread over the month).
--   A weekday without opening hours brings nothing.
-- * Money out:
--     purchases  = expected sales x the share of purchases in sales over the last 8 weeks
--                  (else the month figures; else 32 %, and the forecast says it is a default),
--                  paid after the average supplier terms of those purchases (so nothing counts twice
--                  with the supplier debts below);
--     fixed costs on their day of the month when one is set (fixed_costs.due_day), else spread
--                  over every day; weekly and yearly costs are spread;
--     suppliers  = what is still owed to suppliers, on its due date (overdue: today).
-- * The result: the balance day by day, the lowest point, the first day below zero.
-- =============================================================================

alter table public.fixed_costs add column if not exists due_day smallint check (due_day between 1 and 31);
alter table public.restaurants add column if not exists cash_position jsonb;

create or replace function public.set_cash_position(p_restaurant_id uuid, p_amount_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if p_amount_cents is null or p_amount_cents not between -10000000000 and 10000000000 then perform app.fail('invalid_request', 'amount'); end if;
  update public.restaurants set cash_position = jsonb_build_object('amount_cents', p_amount_cents, 'as_of', app.business_date(r)) where id = r.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.set_cash_position(uuid, bigint) from public, anon;
grant execute on function public.set_cash_position(uuid, bigint) to authenticated;

create or replace function public.cash_forecast(p_restaurant_id uuid, p_days integer default 30)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants; today date; days int := least(greatest(coalesce(p_days, 30), 7), 90);
  src text; basis_days int; lag int := 0; ratio numeric; ratio_src text; rev56 numeric; buy56 numeric;
  start_cents bigint; res jsonb; dow_avg numeric[] := array[0,0,0,0,0,0,0]::numeric[]; flat numeric;
  dkeys text[] := array['mon','tue','wed','thu','fri','sat','sun'];
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  start_cents := (r.cash_position ->> 'amount_cents')::bigint;

  -- 1. sales per weekday (ISO: 1 = Monday)
  with d as (
    select business_date d, sum(total_ttc_cents)::numeric v from public.fiscal_documents
     where restaurant_id = r.id and business_date between today - 56 and today - 1 group by 1)
  select count(*) into basis_days from d;
  if basis_days >= 7 then
    src := 'pos';
    select array_agg(coalesce(a.v, 0) order by g.i) into dow_avg
      from generate_series(1, 7) g(i)
      left join (select extract(isodow from business_date)::int i, avg(v) v from (
                   select business_date, sum(total_ttc_cents)::numeric v from public.fiscal_documents
                    where restaurant_id = r.id and business_date between today - 56 and today - 1 group by 1) s group by 1) a on a.i = g.i;
  else
    select count(*) into basis_days from public.sales_history_days where restaurant_id = r.id and day between today - 56 and today - 1 and revenue_cents > 0;
    if basis_days >= 7 then
      src := 'history';
      select array_agg(coalesce(a.v, 0) order by g.i) into dow_avg
        from generate_series(1, 7) g(i)
        left join (select extract(isodow from day)::int i, avg(revenue_cents)::numeric v from public.sales_history_days
                    where restaurant_id = r.id and day between today - 56 and today - 1 and revenue_cents > 0 group by 1) a on a.i = g.i;
    else
      select mf.revenue_ttc_cents::numeric / extract(day from (date_trunc('month', mf.month) + interval '1 month - 1 day'))
        into flat from public.month_figures mf where mf.restaurant_id = r.id and mf.revenue_ttc_cents > 0 order by mf.month desc limit 1;
      if flat is not null then src := 'month'; basis_days := 0; dow_avg := array[flat, flat, flat, flat, flat, flat, flat];
      else src := 'none'; basis_days := 0; end if;
    end if;
  end if;
  -- a day without opening hours brings nothing (when hours are set)
  if r.opening_hours is not null and r.opening_hours <> '{}'::jsonb then
    for i in 1..7 loop
      if coalesce(jsonb_array_length(r.opening_hours -> dkeys[i]), 0) = 0 then dow_avg[i] := 0; end if;
    end loop;
  end if;

  -- 2. the share of purchases in sales (same source as the sales), and how long after buying they are
  --    paid on average (supplier terms; bought without a supplier = paid at once)
  if src = 'pos' then
    select coalesce(sum(total_ttc_cents), 0) into rev56 from public.fiscal_documents where restaurant_id = r.id and business_date between today - 56 and today - 1;
  elsif src = 'history' then
    select coalesce(sum(revenue_cents), 0) into rev56 from public.sales_history_days where restaurant_id = r.id and day between today - 56 and today - 1;
  else rev56 := 0; end if;
  select coalesce(sum(p.total_cents), 0), coalesce(round(sum(p.total_cents * coalesce(s.payment_terms_days, 0))::numeric / nullif(sum(p.total_cents), 0)), 0)
    into buy56, lag
    from public.stock_purchases p left join public.suppliers s on s.id = p.supplier_id
   where p.restaurant_id = r.id and p.purchased_on between today - 56 and today - 1 and p.total_cents > 0;
  lag := least(greatest(lag, 0), 60);
  if rev56 > 0 and buy56 > 0 then ratio := least(greatest(buy56 / rev56, 0.05), 0.8); ratio_src := 'purchases';
  else
    select least(greatest(mf.purchases_cents::numeric / nullif(mf.revenue_ttc_cents, 0), 0.05), 0.8) into ratio
      from public.month_figures mf where mf.restaurant_id = r.id and mf.purchases_cents > 0 and mf.revenue_ttc_cents > 0 order by mf.month desc limit 1;
    if ratio is not null then ratio_src := 'month'; else ratio := 0.32; ratio_src := 'default'; end if;
  end if;

  -- 3. day by day
  create temp table if not exists _cf_out (d date, kind text, name text, amount bigint) on commit drop;
  delete from _cf_out;
  -- fixed costs: on their day of the month, else spread over the days
  insert into _cf_out
  select c.d, case when f.frequency = 'month' and f.due_day is not null then 'fixed_day' else 'fixed' end, f.name,
         case when f.frequency = 'month' and f.due_day is not null then
                case when extract(day from c.d)::int = least(f.due_day, extract(day from (date_trunc('month', c.d) + interval '1 month - 1 day'))::int) then f.amount_cents else 0 end
              when f.frequency = 'month' then round(f.amount_cents::numeric / extract(day from (date_trunc('month', c.d) + interval '1 month - 1 day')))
              when f.frequency = 'week' then round(f.amount_cents::numeric / 7)
              else round(f.amount_cents::numeric / 365) end
    from generate_series(today, today + days - 1, interval '1 day') c(d)
    join public.fixed_costs f on f.restaurant_id = r.id and f.active;
  -- suppliers: what is still owed, on its due date (overdue: today); same rule as supplier_balances
  insert into _cf_out
  select greatest(l.due, today), 'supplier', s.name, l.left_cents
    from public.suppliers s
    cross join lateral (
      select coalesce((select sum(e.amount_cents) from public.supplier_entries e where e.supplier_id = s.id and e.kind in ('payment', 'credit')), 0) paid) b
    cross join lateral (
      select due, greatest(0, least(amount, cum - b.paid)) left_cents
        from (select due, amount, sum(amount) over (order by due, k) cum
                from (select e.entry_on due, e.amount_cents amount, e.id::text k from public.supplier_entries e where e.supplier_id = s.id and e.kind = 'opening'
                      union all
                      select p.purchased_on + s.payment_terms_days, p.total_cents, p.id::text from public.stock_purchases p
                       where p.restaurant_id = r.id and p.supplier_id = s.id and p.total_cents > 0) q) w) l
   where s.restaurant_id = r.id and l.left_cents > 0 and l.due < today + days;

  with cal as (
    select (today + g)::date d from generate_series(0, days - 1) g
  ), rows as (
    select c.d, round(dow_avg[extract(isodow from c.d)::int])::bigint sales,
           -- what is bought from today on is paid `lag` days later; what was bought before is in the supplier debts
           case when c.d - lag >= today then round(dow_avg[extract(isodow from c.d - lag)::int] * ratio) else 0 end::bigint purchases,
           coalesce((select sum(o.amount) from _cf_out o where o.d = c.d and o.kind in ('fixed', 'fixed_day')), 0)::bigint fixed,
           coalesce((select sum(o.amount) from _cf_out o where o.d = c.d and o.kind = 'supplier'), 0)::bigint suppliers
      from cal c
  ), bal as (
    select x.*, coalesce(start_cents, 0) + sum(x.sales - x.purchases - x.fixed - x.suppliers) over (order by x.d) balance from rows x
  )
  select jsonb_build_object(
    'today', today, 'days', days, 'start_cents', start_cents, 'start_as_of', r.cash_position ->> 'as_of',
    'source', src, 'basis_days', basis_days, 'purchase_ratio', round(ratio, 3), 'ratio_source', ratio_src, 'purchase_lag_days', lag,
    'rows', (select jsonb_agg(jsonb_build_object('date', d, 'sales', sales, 'purchases', purchases, 'fixed', fixed, 'suppliers', suppliers, 'balance', balance) order by d) from bal),
    'totals', (select jsonb_build_object('sales', sum(sales), 'purchases', sum(purchases), 'fixed', sum(fixed), 'suppliers', sum(suppliers)) from bal),
    'end_cents', (select balance from bal order by d desc limit 1),
    'low', (select jsonb_build_object('date', d, 'balance', balance) from bal order by balance, d limit 1),
    'first_negative', (select d from bal where balance < 0 order by d limit 1),
    -- the payments that fall on one day (fixed costs with a day, supplier debts), biggest first
    'big_payments', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'kind', case when kind = 'fixed_day' then 'fixed' else kind end, 'name', name, 'amount', amount) order by d, amount desc), '[]'::jsonb) from (
        select d, kind, name, sum(amount) amount from _cf_out o
         where o.amount > 0 and o.kind in ('supplier', 'fixed_day')
         group by 1, 2, 3 order by sum(amount) desc limit 8) t)
  ) into res;
  return res;
end $$;
revoke all on function public.cash_forecast(uuid, integer) from public, anon;
grant execute on function public.cash_forecast(uuid, integer) to authenticated;
