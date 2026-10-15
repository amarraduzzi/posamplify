-- =============================================================================
-- Demand forecast: what will sell on a day, dish by dish, and what that needs
-- * Per dish: the average sold on the same weekday over the last 8 weeks (till sales; with fewer
--   than 2 such days, the average of all days when there are 7 or more; else the imported item
--   history, matched to the menu by name). Catering orders confirmed for that day come on top.
-- * The expected revenue and number of tickets, on the same days.
-- * Per ingredient: what those sales use (recipes, preparations made on the spot, waste), plus the
--   catering orders, against the stock: what is short.
-- * A weekday without opening hours (when hours are set) is a closed day.
-- =============================================================================

create or replace function public.demand_forecast(p_restaurant_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants; today date; dt date; basis text; ndays int; nw int; closed boolean := false;
  days date[]; res jsonb;
  dkeys text[] := array['mon','tue','wed','thu','fri','sat','sun'];
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  dt := coalesce(p_date, today);
  if dt < today or dt > today + 14 then perform app.fail('invalid_request', 'date'); end if;
  if r.opening_hours is not null and r.opening_hours <> '{}'::jsonb
     and coalesce(jsonb_array_length(r.opening_hours -> dkeys[extract(isodow from dt)::int]), 0) = 0 then closed := true; end if;

  -- the days to average over: till days of the last 8 weeks (today is not over yet, so not counted)
  select array_agg(distinct o.business_date) into days from public.orders o
   where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled' and o.source <> 'catering'
     and o.business_date >= dt - 56 and o.business_date < today;
  ndays := coalesce(cardinality(days), 0);
  select count(*) into nw from unnest(days) d where extract(isodow from d) = extract(isodow from dt);
  if nw >= 2 then basis := 'weekday'; select array_agg(d) into days from unnest(days) d where extract(isodow from d) = extract(isodow from dt);
  elsif ndays >= 7 then basis := 'all_days';
  else
    select array_agg(distinct h.day) into days from public.sales_history_items h where h.restaurant_id = r.id and h.day >= dt - 56 and h.day < today and h.qty > 0;
    ndays := coalesce(cardinality(days), 0);
    select count(*) into nw from unnest(days) d where extract(isodow from d) = extract(isodow from dt);
    if nw >= 2 then basis := 'history_weekday'; select array_agg(d) into days from unnest(days) d where extract(isodow from d) = extract(isodow from dt);
    elsif ndays >= 7 then basis := 'history';
    else basis := 'none'; days := '{}'; end if;
  end if;
  nw := coalesce(cardinality(days), 0);

  with
  sold as (   -- till sales on the chosen days, per dish, size and dine-in or not
    select l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.quantity)::numeric qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where basis in ('weekday', 'all_days') and l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and od.source <> 'catering' and l.menu_item_id is not null and od.business_date = any (days)
     group by 1, 2, 3
    union all  -- or the imported history, matched to the menu by name
    select m.id, null, true, sum(h.qty)
      from public.sales_history_items h
      join public.menu_items m on m.restaurant_id = r.id
                                and exists (select 1 from jsonb_each_text(m.name) x where app.norm_name(x.value) = app.norm_name(h.name))
     where basis in ('history_weekday', 'history') and h.restaurant_id = r.id and h.day = any (days)
     group by 1),
  last_week as (
    select l.menu_item_id, sum(l.quantity) qty
      from public.order_lines l join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled' and od.source <> 'catering'
       and l.menu_item_id is not null and od.business_date = dt - 7
     group by 1),
  cat as (    -- confirmed catering for that day
    select cl.menu_item_id, sum(cl.qty) qty
      from public.catering_orders c join public.catering_lines cl on cl.restaurant_id = c.restaurant_id and cl.catering_id = c.id
     where c.restaurant_id = r.id and c.event_date = dt and c.status = 'confirmed' and c.order_id is null and cl.menu_item_id is not null
     group by 1),
  dishes as (
    select m.id, m.name, coalesce(s.qty, 0) / greatest(nw, 1) * (case when closed then 0 else 1 end) expected,
           coalesce(lw.qty, 0) last_week, coalesce(c.qty, 0) catering
      from public.menu_items m
      left join (select menu_item_id, sum(qty) qty from sold group by 1) s on s.menu_item_id = m.id
      left join last_week lw on lw.menu_item_id = m.id
      left join cat c on c.menu_item_id = m.id
     where m.restaurant_id = r.id and (s.qty > 0 or c.qty > 0)),
  -- what the sales use, per ingredient (made-ahead preparations stay preparations, like the stock)
  use_sales as (
    select x.ingredient_id, sum(x.qty) / greatest(nw, 1) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
      cross join lateral app.prep_tree(r.id, rl.ingredient_id, s.qty * rl.qty, true) x
     where not closed
     group by 1),
  use_cat as (
    select x.ingredient_id, sum(x.qty) qty
      from public.catering_orders c
      join public.catering_lines cl on cl.restaurant_id = c.restaurant_id and cl.catering_id = c.id
      left join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = cl.menu_item_id and rl.variant_id is null and rl.modifier_option_id is null
      cross join lateral app.prep_tree(r.id, coalesce(rl.ingredient_id, cl.ingredient_id), cl.qty * coalesce(rl.qty, 1), true) x
     where c.restaurant_id = r.id and c.event_date = dt and c.status = 'confirmed' and c.order_id is null
       and (rl.id is not null or cl.ingredient_id is not null)
     group by 1),
  needs as (
    select g.id, g.name, g.base_unit, g.stock_qty,
           (coalesce(u.qty, 0) + coalesce(c.qty, 0)) / (1 - g.waste_bp / 10000.0) need
      from public.ingredients g
      left join use_sales u on u.ingredient_id = g.id
      left join use_cat c on c.ingredient_id = g.id
     where g.restaurant_id = r.id and g.active and (u.qty > 0 or c.qty > 0))
  select jsonb_build_object(
    'date', dt, 'today', today, 'closed', closed, 'basis', basis, 'basis_days', nw,
    'revenue_cents', case when closed or basis not in ('weekday', 'all_days') then null else (
        select round(sum(o.total_cents)::numeric / greatest(nw, 1)) from public.orders o
         where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled' and o.source <> 'catering' and o.business_date = any (days)) end,
    'tickets', case when closed or basis not in ('weekday', 'all_days') then null else (
        select round(count(*)::numeric / greatest(nw, 1)) from public.orders o
         where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled' and o.source <> 'catering' and o.business_date = any (days)) end,
    'dishes', (select coalesce(jsonb_agg(jsonb_build_object('menu_item_id', id, 'name', name, 'expected', round(expected, 1),
                                                            'last_week', last_week, 'catering', catering) order by expected + catering desc, name), '[]'::jsonb)
                 from (select * from dishes where expected >= 0.5 or catering > 0 order by expected + catering desc limit 60) d),
    'ingredients', (select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', id, 'name', name, 'base_unit', base_unit, 'need', round(need, 3),
                                                                 'stock_qty', stock_qty, 'short', case when stock_qty is not null and need > stock_qty then round(need - greatest(stock_qty, 0), 3) end)
                                              order by (stock_qty is not null and need > stock_qty) desc, name), '[]'::jsonb)
                      from needs where need > 0)
  ) into res;
  return res;
end $$;
revoke all on function public.demand_forecast(uuid, date) from public, anon;
grant execute on function public.demand_forecast(uuid, date) to authenticated;
