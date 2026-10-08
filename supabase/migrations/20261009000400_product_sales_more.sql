-- =============================================================================
-- Sales per product, step 2
-- * product_detail also gives: what is bought together with it (share of its tickets), per channel
--   (room, QR at the table, takeaway, delivery, phone, Glovo) and per staff member.
-- * The sales imported from the old till join the same figures: quantities per product (matched
--   on the exact name of the dish in one of the menu languages, otherwise their own line) and the
--   day totals. The old till gives no amount per product on tickets with several products, so the
--   revenue per product stays Amplify only; the totals of the period include the old till.
-- =============================================================================
drop function if exists app.sold_lines(public.restaurants, date, date);
create function app.sold_lines(r public.restaurants, p_from date, p_to date)
returns table (order_id uuid, business_date date, menu_item_id uuid, variant_id uuid, name text, qty integer,
               gross_cents bigint, net_cents numeric, net_ht_cents numeric, ordered_at timestamptz,
               channel text, staff_id uuid)
language sql stable security definer set search_path = '' as $$
  select o.id, o.business_date, l.menu_item_id, l.variant_id, l.name, l.quantity, l.line_total_cents,
         l.line_total_cents * case when o.subtotal_cents > 0 then o.total_cents::numeric / o.subtotal_cents else 1 end,
         l.line_total_cents * case when o.subtotal_cents > 0 then o.total_cents::numeric / o.subtotal_cents else 1 end
           * 10000.0 / (10000 + l.vat_bp),
         l.created_at,
         case when o.source in ('qr', 'glovo', 'phone') then o.source else o.order_type end,
         coalesce(l.staff_id, o.staff_id)
    from public.orders o
    join public.order_lines l on l.restaurant_id = o.restaurant_id and l.order_id = o.id
   where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled'
     and o.business_date between p_from and p_to
$$;
revoke all on function app.sold_lines(public.restaurants, date, date) from public, anon, authenticated;

-- imported lines of the old till with the key of the product they belong to
create or replace function app.history_lines(r public.restaurants, p_from date, p_to date)
returns table (key text, item_id uuid, day date, name text, qty numeric, revenue_cents bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(m.id::text, 'hist:' || lower(btrim(h.name))), m.id, h.day, h.name, h.qty, h.revenue_cents
    from public.sales_history_items h
    left join lateral (
      select i.id from public.menu_items i
       where i.restaurant_id = r.id
         and lower(btrim(h.name)) in (lower(btrim(i.name ->> 'fr')), lower(btrim(i.name ->> 'ar')), lower(btrim(i.name ->> 'en')))
       order by i.active desc, i.created_at limit 1) m on true
   where h.restaurant_id = r.id and h.day between p_from and p_to
$$;
revoke all on function app.history_lines(public.restaurants, date, date) from public, anon, authenticated;

create or replace function public.product_sales(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; len int; pfrom date; pto date; costs jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then perform app.fail('invalid_request', 'period'); end if;
  len := p_to - p_from + 1; pfrom := p_from - len; pto := p_from - 1;
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
             case when bool_and(unit_cost is not null) filter (where cur)
                  then sum(net_ht_cents - qty * unit_cost) filter (where cur) end margin
        from k group by key),
    hist as (
      select key, (array_agg(item_id))[1] item_id, (array_agg(name order by day desc))[1] snap,
             coalesce(sum(qty) filter (where day >= p_from), 0) qty,
             coalesce(sum(qty) filter (where day < p_from), 0) prev_qty,
             count(distinct day) filter (where day >= p_from) days
        from app.history_lines(r, pfrom, p_to) group by key),
    hd as (select * from public.sales_history_days where restaurant_id = r.id and day between pfrom and p_to),
    menu as (
      select i.id::text key, i.id item_id, i.name, i.image_url, c.name cat, c.sort_order cat_sort, i.sort_order
        from public.menu_items i left join public.categories c on c.restaurant_id = r.id and c.id = i.category_id
       where i.restaurant_id = r.id and (i.active or exists (select 1 from agg a where a.key = i.id::text) or exists (select 1 from hist h where h.key = i.id::text))),
    keys as (select key from menu union select key from agg union select key from hist)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'prev_from', pfrom, 'prev_to', pto,
      'totals', (select jsonb_build_object(
          'revenue_cents', round(coalesce((select sum(net_cents) from k where cur), 0) + coalesce((select sum(revenue_cents) from hd where day >= p_from), 0)),
          'qty', coalesce((select sum(qty) from k where cur), 0) + coalesce((select sum(qty) from hist), 0),
          'tickets', (select count(distinct order_id) from k where cur) + coalesce((select sum(tickets) from hd where day >= p_from), 0),
          'discount_cents', round(coalesce((select sum(gross_cents - net_cents) from k where cur), 0)),
          'prev_revenue_cents', round(coalesce((select sum(net_cents) from k where not cur), 0) + coalesce((select sum(revenue_cents) from hd where day < p_from), 0)),
          'prev_qty', coalesce((select sum(qty) from k where not cur), 0) + coalesce((select sum(prev_qty) from hist), 0),
          'prev_tickets', (select count(distinct order_id) from k where not cur) + coalesce((select sum(tickets) from hd where day < p_from), 0),
          'history_days', (select count(*) from hd where day >= p_from),
          'history_revenue_cents', coalesce((select sum(revenue_cents) from hd where day >= p_from), 0))),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
          'key', x.key, 'item_id', coalesce(m.item_id, a.item_id, h.item_id),
          'name', coalesce(m.name, jsonb_build_object('fr', coalesce(a.snap, h.snap))), 'category', m.cat, 'image_url', m.image_url,
          'history_only', m.key is null and a.key is null,
          'qty', coalesce(a.qty, 0) + coalesce(h.qty, 0), 'history_qty', coalesce(h.qty, 0),
          'revenue_cents', round(coalesce(a.revenue, 0)), 'gross_cents', coalesce(a.gross, 0),
          'prev_qty', coalesce(a.prev_qty, 0) + coalesce(h.prev_qty, 0), 'prev_revenue_cents', round(coalesce(a.prev_revenue, 0)),
          'days_sold', greatest(coalesce(a.days_sold, 0), coalesce(h.days, 0)), 'tickets', coalesce(a.tickets, 0),
          'margin_cents', round(a.margin))
          order by coalesce(a.revenue, 0) desc, coalesce(a.qty, 0) + coalesce(h.qty, 0) desc, m.cat_sort, m.sort_order), '[]'::jsonb)
        from keys x left join menu m on m.key = x.key left join agg a on a.key = x.key left join hist h on h.key = x.key
       where m.key is not null or coalesce(a.qty, 0) + coalesce(a.prev_qty, 0) + coalesce(h.qty, 0) + coalesce(h.prev_qty, 0) > 0)));
end $$;

drop function if exists public.product_detail(uuid, uuid, text, date, date);
create function public.product_detail(p_restaurant_id uuid, p_item_id uuid, p_name text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; hkey text;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 731 then perform app.fail('invalid_request', 'period'); end if;
  hkey := coalesce(p_item_id::text, 'hist:' || lower(btrim(p_name)));
  return (
    with all_l as (select * from app.sold_lines(r, p_from, p_to)),
    l as (select * from all_l where case when p_item_id is not null then menu_item_id = p_item_id
                                         else menu_item_id is null and lower(btrim(name)) = lower(btrim(p_name)) end),
    h as (select * from app.history_lines(r, p_from, p_to) x where x.key = hkey),
    mine as (select distinct order_id from l),
    days as (select d::date as day from generate_series(p_from, p_to, interval '1 day') d)
    select jsonb_build_object(
      'qty', (select coalesce(sum(qty), 0) from l),
      'history_qty', (select coalesce(sum(qty), 0) from h),
      'revenue_cents', (select round(coalesce(sum(net_cents), 0)) from l),
      'tickets', (select count(*) from mine),
      'all_tickets', (select count(distinct order_id) from all_l),
      'daily', (select jsonb_agg(jsonb_build_object('day', d.day,
                  'qty', coalesce((select sum(qty) from l where l.business_date = d.day), 0),
                  'history_qty', coalesce((select sum(qty) from h where h.day = d.day), 0),
                  'revenue_cents', round(coalesce((select sum(net_cents) from l where l.business_date = d.day), 0))) order by d.day) from days d),
      'weekdays', (select jsonb_agg(jsonb_build_object('dow', w,
                  'qty', coalesce((select sum(qty) from l where extract(isodow from l.business_date) = w), 0)
                         + coalesce((select sum(qty) from h where extract(isodow from h.day) = w), 0),
                  'revenue_cents', round(coalesce((select sum(net_cents) from l where extract(isodow from l.business_date) = w), 0)),
                  'days', (select count(*) from days where extract(isodow from day) = w)) order by w) from generate_series(1, 7) w),
      'hours', (select jsonb_agg(jsonb_build_object('hour', hh,
                  'qty', coalesce((select sum(qty) from l where extract(hour from l.ordered_at at time zone r.timezone) = hh), 0)) order by hh)
                  from generate_series(0, 23) hh),
      'variants', (select coalesce(jsonb_agg(x order by x.qty desc), '[]'::jsonb) from (
                  select coalesce(v.name, jsonb_build_object('fr', '')) name, sum(l.qty) qty, round(sum(l.net_cents)) revenue_cents
                    from l left join public.item_variants v on v.restaurant_id = r.id and v.id = l.variant_id
                   group by l.variant_id, v.name) x),
      -- the other products on the same tickets: in how many of its tickets they appear
      'together', (select coalesce(jsonb_agg(x order by x.tickets desc, x.qty desc), '[]'::jsonb) from (
                  select coalesce(i.name, jsonb_build_object('fr', (array_agg(o.name))[1])) name, count(distinct o.order_id) tickets, sum(o.qty) qty
                    from all_l o join mine m on m.order_id = o.order_id
                    left join public.menu_items i on i.restaurant_id = r.id and i.id = o.menu_item_id
                   where not (case when p_item_id is not null then o.menu_item_id is not distinct from p_item_id
                                   else o.menu_item_id is null and lower(btrim(o.name)) = lower(btrim(p_name)) end)
                   group by coalesce(o.menu_item_id::text, 'free:' || lower(btrim(o.name))), i.name
                   order by count(distinct o.order_id) desc, sum(o.qty) desc limit 6) x),
      'channels', (select coalesce(jsonb_agg(x order by x.qty desc), '[]'::jsonb) from (
                  select channel, sum(qty) qty, round(sum(net_cents)) revenue_cents from l group by channel) x),
      'staff', (select coalesce(jsonb_agg(x order by x.qty desc), '[]'::jsonb) from (
                  select s.name, sum(l.qty) qty, round(sum(l.net_cents)) revenue_cents,
                         -- of all the tickets this person handled, how many had the product
                         (select count(distinct a.order_id) from all_l a where a.staff_id is not distinct from l.staff_id) staff_tickets,
                         count(distinct l.order_id) tickets
                    from l left join public.staff s on s.restaurant_id = r.id and s.id = l.staff_id
                   group by l.staff_id, s.name) x)));
end $$;

revoke all on function public.product_sales(uuid, date, date), public.product_detail(uuid, uuid, text, date, date) from public, anon;
grant execute on function public.product_sales(uuid, date, date), public.product_detail(uuid, uuid, text, date, date) to authenticated;
