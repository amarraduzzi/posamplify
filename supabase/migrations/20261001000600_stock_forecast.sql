-- =============================================================================
-- 0019 AMPLIFY PROFIT: stock right now and what to buy
-- =============================================================================
-- Per ingredient, starting from the last count that has it:
--   estimated stock = counted + purchases since - used since
--   used since:  with Amplify POS  -> recipe cards x dishes sold since the count
--                without POS       -> average use per day (from the last two counts) x days
--   use per day: POS sales of the last 28 days, otherwise the last two counts
--   to buy     : enough for the next "order_days" days (profit_settings, default 7)
-- An estimate drifts (waste, free food): every new count puts it right again.
-- =============================================================================

-- A purchase dated the day of a count: before the count (the default, a count
-- is the stock at the end of the day) or received after it (after_count).
alter table public.stock_purchases add column after_count boolean not null default false;

create or replace function public.stock_forecast(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r          public.restaurants;
  today      date;
  uses_pos   boolean;
  order_days int;
  sales_days int;
  items      jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  uses_pos := 'pos' = any (r.products);
  order_days := least(60, greatest(1, coalesce((r.profit_settings ->> 'order_days')::int, 7)));

  -- how many days of till history to average over (a new restaurant has less than 28)
  select least(28, today - min(o.business_date) + 1) into sales_days
    from public.orders o
   where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled'
     and o.business_date > today - 28 and o.business_date <= today;
  if not uses_pos then sales_days := null; end if;

  with
  -- what each dish sold per day uses, for every sale day we need
  sold as (
    select od.business_date d, l.menu_item_id, l.variant_id, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where uses_pos and l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and l.menu_item_id is not null and od.business_date > today - 400 and od.business_date <= today
     group by 1, 2, 3),
  use_by_day as (
    select s.d, rl.ingredient_id, sum(s.qty * rl.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
      join public.ingredients g on g.restaurant_id = r.id and g.id = rl.ingredient_id
     group by 1, 2),
  -- the last closed count of each ingredient
  last_count as (
    select distinct on (l.ingredient_id) l.ingredient_id, c.counted_on, l.qty
      from public.stock_count_lines l
      join public.stock_counts c on c.restaurant_id = l.restaurant_id and c.id = l.count_id
     where l.restaurant_id = r.id and c.status = 'closed' and c.counted_on <= today
     order by l.ingredient_id, c.counted_on desc, c.created_at desc),
  -- the count before that, for the use per day without a till
  prev_count as (
    select distinct on (l.ingredient_id) l.ingredient_id, c.counted_on, l.qty
      from public.stock_count_lines l
      join public.stock_counts c on c.restaurant_id = l.restaurant_id and c.id = l.count_id
      join last_count lc on lc.ingredient_id = l.ingredient_id and c.counted_on < lc.counted_on
     where l.restaurant_id = r.id and c.status = 'closed'
     order by l.ingredient_id, c.counted_on desc, c.created_at desc),
  base as (
    select g.id, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty, g.purchase_price_cents, g.supplier,
           lc.counted_on, lc.qty counted,
           (select coalesce(sum(p.qty), 0) from public.stock_purchases p
             where p.restaurant_id = r.id and p.ingredient_id = g.id and lc.counted_on is not null
               and (p.purchased_on > lc.counted_on or (p.purchased_on = lc.counted_on and p.after_count))) bought_since,
           (select sum(u.qty) from use_by_day u where u.ingredient_id = g.id and lc.counted_on is not null and u.d > lc.counted_on) sold_since,
           case when sales_days > 0 then
             (select sum(u.qty) from use_by_day u where u.ingredient_id = g.id and u.d > today - sales_days) / sales_days end sales_daily,
           case when pc.counted_on is not null then
             greatest(0, pc.qty
               + (select coalesce(sum(p.qty), 0) from public.stock_purchases p
                   where p.restaurant_id = r.id and p.ingredient_id = g.id
                     and (p.purchased_on > pc.counted_on or (p.purchased_on = pc.counted_on and p.after_count))
                     and (p.purchased_on < lc.counted_on or (p.purchased_on = lc.counted_on and not p.after_count)))
               - lc.qty) / (lc.counted_on - pc.counted_on) end count_daily
      from public.ingredients g
      left join last_count lc on lc.ingredient_id = g.id
      left join prev_count pc on pc.ingredient_id = g.id
     where g.restaurant_id = r.id and g.active),
  est as (
    select *,
           case when sales_daily > 0 then 'sales' when count_daily is not null then 'counts' end daily_source,
           coalesce(nullif(sales_daily, 0), count_daily) daily,
           case when counted is null then null
                -- with the till: what the sales used since the count (sales-based use exists)
                when sales_daily > 0 then counted + bought_since - coalesce(sold_since, 0)
                when count_daily is not null then counted + bought_since - count_daily * (today - counted_on)
                else counted + bought_since end raw_estimate
      from base),
  fin as (
    select *, greatest(raw_estimate, 0) estimate,
           case when daily > 0 and raw_estimate is not null then greatest(raw_estimate, 0) / daily end days_left,
           case when daily > 0 then greatest(0, daily * order_days - greatest(coalesce(raw_estimate, 0), 0)) end to_buy
      from est)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', id, 'name', name, 'name_ar', name_ar, 'category', category, 'base_unit', base_unit,
      'purchase_unit', purchase_unit, 'purchase_qty', purchase_qty, 'purchase_price_cents', purchase_price_cents, 'supplier', supplier,
      'counted_on', counted_on, 'counted', counted, 'bought_since', bought_since,
      'estimate', round(estimate, 3), 'below_zero', coalesce(raw_estimate < 0, false),
      'daily', round(daily, 3), 'daily_source', daily_source,
      'days_left', round(days_left, 1),
      'to_buy', round(to_buy, 3),
      'to_buy_cents', case when to_buy > 0 and purchase_price_cents is not null then round(to_buy * purchase_price_cents / purchase_qty)::bigint end,
      'status', case when counted is null then 'not_counted'
                     when daily is null or daily = 0 then 'no_use'
                     when days_left < 2 then 'urgent'
                     when days_left < order_days then 'order'
                     else 'ok' end
    ) order by (counted is null), days_left nulls last, name), '[]'::jsonb)
    into items
    from fin;

  return jsonb_build_object('today', today, 'uses_pos', uses_pos, 'order_days', order_days, 'sales_days', sales_days, 'items', items);
end $$;
revoke all on function public.stock_forecast(uuid) from public, anon;
grant execute on function public.stock_forecast(uuid) to authenticated;

-- same rule for the variance report
create or replace function public.stock_report(p_restaurant_id uuid, p_from uuid, p_to uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        public.restaurants;
  a        public.stock_counts;
  b        public.stock_counts;
  x        public.stock_counts;
  uses_pos boolean;
  rev_ht   bigint;
  items    jsonb;
  totals   jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  select * into a from public.stock_counts where restaurant_id = r.id and id = p_from;
  select * into b from public.stock_counts where restaurant_id = r.id and id = p_to;
  if a.id is null or b.id is null then raise exception 'unknown count' using errcode = '22023'; end if;
  if a.status <> 'closed' or b.status <> 'closed' then raise exception 'count not closed' using errcode = '22023'; end if;
  if a.counted_on > b.counted_on then x := a; a := b; b := x; end if;
  if a.counted_on = b.counted_on then raise exception 'same day' using errcode = '22023'; end if;
  uses_pos := 'pos' = any (r.products);

  select coalesce(sum(total_ht_cents), 0) into rev_ht
    from public.fiscal_documents where restaurant_id = r.id and business_date > a.counted_on and business_date <= b.counted_on;

  with
  o as (select ingredient_id, qty from public.stock_count_lines where restaurant_id = r.id and count_id = a.id),
  c as (select ingredient_id, qty from public.stock_count_lines where restaurant_id = r.id and count_id = b.id),
  buy as (
    select ingredient_id, sum(qty) qty, sum(total_cents) spent
      from public.stock_purchases
     where restaurant_id = r.id
       and (purchased_on > a.counted_on or (purchased_on = a.counted_on and after_count))
       and (purchased_on < b.counted_on or (purchased_on = b.counted_on and not after_count))
     group by 1),
  sold as (
    select l.menu_item_id, l.variant_id, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and od.business_date > a.counted_on and od.business_date <= b.counted_on and l.menu_item_id is not null
     group by 1, 2),
  -- recipe quantities are what ends up on the plate: add the waste back (peel, bones)
  theo as (
    select rl.ingredient_id, sum(s.qty * rl.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
      join public.ingredients g on g.restaurant_id = r.id and g.id = rl.ingredient_id
     group by 1),
  base as (
    select g.id, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty,
           case when g.purchase_price_cents is not null then g.purchase_price_cents::numeric / g.purchase_qty end unit_cost,
           o.qty opening, c.qty closing, coalesce(buy.qty, 0) bought, buy.spent,
           case when uses_pos then coalesce(theo.qty, 0) end theo
      from public.ingredients g
      left join o on o.ingredient_id = g.id
      left join c on c.ingredient_id = g.id
      left join buy on buy.ingredient_id = g.id
      left join theo on theo.ingredient_id = g.id
     where g.restaurant_id = r.id
       and (o.qty is not null or c.qty is not null or buy.qty is not null or theo.qty is not null)),
  calc as (
    select *, (opening is not null and closing is not null) counted,
           case when opening is not null and closing is not null then opening + bought - closing end used
      from base),
  val as (
    select *, case when used is not null and theo is not null then used - theo end gap,
           round(used * unit_cost)::bigint used_cents,
           round(theo * unit_cost)::bigint theo_cents,
           round((used - theo) * unit_cost)::bigint gap_cents
      from calc)
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', id, 'name', name, 'name_ar', name_ar, 'category', category, 'base_unit', base_unit,
      'purchase_unit', purchase_unit, 'purchase_qty', purchase_qty, 'priced', unit_cost is not null,
      'counted', counted, 'opening', opening, 'bought', bought, 'closing', closing, 'used', used,
      'theoretical', theo, 'gap', gap,
      'used_cents', used_cents, 'theoretical_cents', theo_cents, 'gap_cents', gap_cents,
      -- more came out of the counts than went in: a purchase was not noted, or a count is wrong
      'negative', coalesce(used < 0, false)
    ) order by counted desc, coalesce(abs(gap_cents), 0) desc, coalesce(used_cents, 0) desc, name), '[]'::jsonb),
    jsonb_build_object(
      'used_cents', coalesce(sum(used_cents) filter (where counted), 0),
      'theoretical_cents', case when uses_pos then coalesce(sum(theo_cents) filter (where counted), 0) end,
      'gap_cents', case when uses_pos then coalesce(sum(gap_cents) filter (where counted and gap_cents > 0), 0) end,
      'surplus_cents', case when uses_pos then coalesce(-sum(gap_cents) filter (where counted and gap_cents < 0), 0) end,
      'purchases_cents', coalesce(sum(spent), 0),
      'counted', count(*) filter (where counted),
      'not_counted', count(*) filter (where not counted),
      'unpriced', count(*) filter (where counted and unit_cost is null),
      'negative', count(*) filter (where used < 0))
    into items, totals
    from val;

  return jsonb_build_object(
    'from', jsonb_build_object('id', a.id, 'counted_on', a.counted_on),
    'to', jsonb_build_object('id', b.id, 'counted_on', b.counted_on),
    'days', b.counted_on - a.counted_on,
    'uses_pos', uses_pos,
    'revenue_ht_cents', case when uses_pos then rev_ht end,
    -- real food cost of the period: what was really used / what was sold (excl. VAT)
    'real_food_cost_bp', case when uses_pos and rev_ht > 0 then round((totals ->> 'used_cents')::numeric * 10000 / rev_ht)::int end,
    'totals', totals,
    'items', items);
end $$;
revoke all on function public.stock_report(uuid, uuid, uuid) from public, anon;
grant execute on function public.stock_report(uuid, uuid, uuid) to authenticated;
