-- =============================================================================
-- Sales per product over any period (Ventes > Produits)
-- * product_sales(restaurant, from, to): every product of the menu (also those that did not sell)
--   and every free line typed at the till, with quantity, revenue, days sold, the same figures
--   for the period just before (same length), and the margin when the recipe is costed.
-- * product_detail(restaurant, item | free-line name, from, to): one product per day, per weekday,
--   per hour and per size, and in how many tickets it appears.
-- Counted: closed orders that were not cancelled, by business date. A discount on the ticket is
-- spread over its lines in proportion, so the revenue is what was really cashed (TTC). The margin
-- is on the price without VAT, after the discount.
-- =============================================================================
create or replace function app.sold_lines(r public.restaurants, p_from date, p_to date)
returns table (order_id uuid, business_date date, menu_item_id uuid, variant_id uuid, name text, qty integer,
               gross_cents bigint, net_cents numeric, net_ht_cents numeric, ordered_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.id, o.business_date, l.menu_item_id, l.variant_id, l.name, l.quantity, l.line_total_cents,
         l.line_total_cents * case when o.subtotal_cents > 0 then o.total_cents::numeric / o.subtotal_cents else 1 end,
         l.line_total_cents * case when o.subtotal_cents > 0 then o.total_cents::numeric / o.subtotal_cents else 1 end
           * 10000.0 / (10000 + l.vat_bp),
         l.created_at
    from public.orders o
    join public.order_lines l on l.restaurant_id = o.restaurant_id and l.order_id = o.id
   where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled'
     and o.business_date between p_from and p_to
$$;
revoke all on function app.sold_lines(public.restaurants, date, date) from public, anon, authenticated;

create or replace function public.product_sales(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; len int; pfrom date; pto date; costs jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then perform app.fail('invalid_request', 'period'); end if;
  len := p_to - p_from + 1; pfrom := p_from - len; pto := p_from - 1;
  -- recipe cost per dish and size (null when not costed)
  costs := (public.profit_dishes(p_restaurant_id, 1)) -> 'dishes';
  return (
    with l as (select * from app.sold_lines(r, pfrom, p_to)),
    cost as (
      select (x ->> 'item_id')::uuid item_id, nullif(x ->> 'variant_id', '')::uuid variant_id, (x ->> 'cost_cents')::numeric cost
        from jsonb_array_elements(costs) x),
    k as (
      select coalesce(l.menu_item_id::text, 'free:' || lower(btrim(l.name))) key, l.*,
             l.business_date >= p_from cur,
             (select c.cost from cost c where c.item_id = l.menu_item_id and c.variant_id is not distinct from l.variant_id) unit_cost
        from l),
    agg as (
      select key, (array_agg(menu_item_id))[1] item_id, (array_agg(name order by business_date desc))[1] snap,
             coalesce(sum(qty) filter (where cur), 0) qty,
             coalesce(sum(net_cents) filter (where cur), 0) revenue,
             coalesce(sum(gross_cents) filter (where cur), 0) gross,
             coalesce(sum(qty) filter (where not cur), 0) prev_qty,
             coalesce(sum(net_cents) filter (where not cur), 0) prev_revenue,
             count(distinct business_date) filter (where cur) days_sold,
             count(distinct order_id) filter (where cur) tickets,
             -- the margin only when every sold size has a costed recipe
             case when bool_and(unit_cost is not null) filter (where cur)
                  then sum(net_ht_cents - qty * unit_cost) filter (where cur) end margin
        from k group by key),
    menu as (
      select i.id::text key, i.id item_id, i.name, i.image_url, c.name cat, c.sort_order cat_sort, i.sort_order
        from public.menu_items i left join public.categories c on c.restaurant_id = r.id and c.id = i.category_id
       where i.restaurant_id = r.id and (i.active or exists (select 1 from agg a where a.key = i.id::text)))
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'prev_from', pfrom, 'prev_to', pto,
      'totals', (select jsonb_build_object(
          'revenue_cents', round(coalesce(sum(net_cents) filter (where cur), 0)),
          'qty', coalesce(sum(qty) filter (where cur), 0),
          'tickets', count(distinct order_id) filter (where cur),
          'discount_cents', round(coalesce(sum(gross_cents - net_cents) filter (where cur), 0)),
          'prev_revenue_cents', round(coalesce(sum(net_cents) filter (where not cur), 0)),
          'prev_qty', coalesce(sum(qty) filter (where not cur), 0),
          'prev_tickets', count(distinct order_id) filter (where not cur)) from k),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'key', coalesce(m.key, a.key), 'item_id', coalesce(m.item_id, a.item_id),
          'name', coalesce(m.name, jsonb_build_object('fr', a.snap)), 'category', m.cat, 'image_url', m.image_url,
          'qty', coalesce(a.qty, 0), 'revenue_cents', round(coalesce(a.revenue, 0)), 'gross_cents', coalesce(a.gross, 0),
          'prev_qty', coalesce(a.prev_qty, 0), 'prev_revenue_cents', round(coalesce(a.prev_revenue, 0)),
          'days_sold', coalesce(a.days_sold, 0), 'tickets', coalesce(a.tickets, 0),
          'margin_cents', round(a.margin))
          order by coalesce(a.revenue, 0) desc, m.cat_sort, m.sort_order), '[]'::jsonb)
        from menu m full join agg a on a.key = m.key
       where m.key is not null or a.qty > 0 or a.prev_qty > 0)));
end $$;

create or replace function public.product_detail(p_restaurant_id uuid, p_item_id uuid, p_name text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then perform app.fail('invalid_request', 'period'); end if;
  return (
    with all_l as (select * from app.sold_lines(r, p_from, p_to)),
    l as (select * from all_l where case when p_item_id is not null then menu_item_id = p_item_id
                                         else menu_item_id is null and lower(btrim(name)) = lower(btrim(p_name)) end),
    days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d)
    select jsonb_build_object(
      'qty', (select coalesce(sum(qty), 0) from l),
      'revenue_cents', (select round(coalesce(sum(net_cents), 0)) from l),
      'tickets', (select count(distinct order_id) from l),
      'all_tickets', (select count(distinct order_id) from all_l),
      'daily', (select jsonb_agg(jsonb_build_object('day', d.day,
                  'qty', coalesce((select sum(qty) from l where l.business_date = d.day), 0),
                  'revenue_cents', round(coalesce((select sum(net_cents) from l where l.business_date = d.day), 0))) order by d.day) from days d),
      -- per weekday: total and how many of those weekdays the period has (for the average)
      'weekdays', (select jsonb_agg(jsonb_build_object('dow', w,
                  'qty', coalesce((select sum(qty) from l where extract(isodow from l.business_date) = w), 0),
                  'revenue_cents', round(coalesce((select sum(net_cents) from l where extract(isodow from l.business_date) = w), 0)),
                  'days', (select count(*) from days where extract(isodow from day) = w)) order by w) from generate_series(1, 7) w),
      'hours', (select jsonb_agg(jsonb_build_object('hour', h,
                  'qty', coalesce((select sum(qty) from l where extract(hour from l.ordered_at at time zone r.timezone) = h), 0)) order by h)
                  from generate_series(0, 23) h),
      'variants', (select coalesce(jsonb_agg(x order by x.qty desc), '[]'::jsonb) from (
                  select coalesce(v.name, jsonb_build_object('fr', '')) name, sum(l.qty) qty, round(sum(l.net_cents)) revenue_cents
                    from l left join public.item_variants v on v.restaurant_id = r.id and v.id = l.variant_id
                   group by l.variant_id, v.name) x)));
end $$;

revoke all on function public.product_sales(uuid, date, date), public.product_detail(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.product_sales(uuid, date, date), public.product_detail(uuid, uuid, text, date, date) to authenticated;
