-- =============================================================================
-- 0012 OWNER BRIEFING
-- =============================================================================
-- One call that gathers the facts of a business day for the owner's briefing:
-- sales against the same weekday last week and the 4-week average, sales per
-- hour, best and slowest dishes, per staff member (sales, discounts,
-- cancellations), cancellation reasons, credit notes and order channels.
-- Every number is computed here, exactly, from the fiscal documents and
-- orders. The screen (and later the AI summary) only explains them: an AI
-- never calculates figures itself.
-- Owners and managers only.
-- =============================================================================

create or replace function public.owner_briefing(p_restaurant_id uuid, p_business_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r   public.restaurants;
  dt  date;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  dt := coalesce(p_business_date, app.business_date(r));

  return jsonb_build_object(
    'restaurant', r.name,
    'business_date', dt,
    'weekday', extract(isodow from dt)::int,
    'day_closed', exists (select 1 from public.day_closures where restaurant_id = r.id and business_date = dt),
    'today', app.day_totals(r.id, dt),
    'last_week', app.day_totals(r.id, dt - 7),
    -- average revenue of the same weekday over the 4 previous weeks (days without sales count as 0)
    'avg_4w_revenue_cents', (
      select coalesce(round(avg(coalesce(s.rev, 0))), 0)::bigint
        from generate_series(1, 4) w
        left join lateral (
          select sum(d.total_ttc_cents) rev from public.fiscal_documents d
           where d.restaurant_id = r.id and d.business_date = dt - 7 * w) s on true),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'revenue_cents', rev, 'tickets', n) order by h), '[]')
        from (select extract(hour from d.issued_at at time zone r.timezone)::int h,
                     sum(d.total_ttc_cents) rev, count(*) filter (where d.doc_type <> 'credit_note') n
                from public.fiscal_documents d
               where d.restaurant_id = r.id and d.business_date = dt
               group by 1) x),
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'qty', qty, 'revenue_cents', rev) order by qty desc, rev desc), '[]')
        from (select l ->> 'name' name, sum((l ->> 'qty')::int) qty, sum((l ->> 'total_ttc')::bigint) rev
                from public.fiscal_documents d, jsonb_array_elements(d.lines) l
               where d.restaurant_id = r.id and d.business_date = dt and d.doc_type <> 'credit_note'
               group by 1 order by 2 desc, 3 desc limit 8) x),
    -- dishes on the menu for more than 2 weeks that nobody bought in the last 14 days
    'slow_items', (
      select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.name ->> r.languages[1], i.name ->> 'fr'),
                                                  'price_cents', i.price_cents) order by i.sort_order), '[]')
        from (select i.* from public.menu_items i
               where i.restaurant_id = r.id and i.active and i.available
                 and i.created_at < now() - interval '14 days'
                 and not exists (
                   select 1 from public.order_lines l join public.orders o on o.restaurant_id = l.restaurant_id and o.id = l.order_id
                    where l.restaurant_id = r.id and l.menu_item_id = i.id
                      and o.closed_at is not null and o.business_date > dt - 14 and o.business_date <= dt)
               order by i.sort_order limit 8) i),
    'staff', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'staff_id', staff_id, 'name', name, 'orders', orders, 'revenue_cents', rev,
               'discounted_orders', disc_n, 'discount_cents', disc, 'cancelled', canc) order by rev desc), '[]')
        from (select o.staff_id, s.name,
                     count(*) filter (where o.closed_at is not null) orders,
                     coalesce(sum(o.total_cents) filter (where o.closed_at is not null), 0) rev,
                     count(*) filter (where o.discount_cents > 0 and o.closed_at is not null) disc_n,
                     coalesce(sum(o.discount_cents) filter (where o.closed_at is not null), 0) disc,
                     count(*) filter (where o.status = 'cancelled') canc
                from public.orders o left join public.staff s on s.restaurant_id = o.restaurant_id and s.id = o.staff_id
               where o.restaurant_id = r.id and o.business_date = dt
               group by o.staff_id, s.name) x),
    'cancel_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'count', n, 'amount_cents', amt) order by n desc), '[]')
        from (select coalesce(nullif(btrim(o.cancel_reason), ''), '?') reason, count(*) n, sum(o.subtotal_cents) amt
                from public.orders o
               where o.restaurant_id = r.id and o.business_date = dt and o.status = 'cancelled'
               group by 1) x),
    'channels', (
      select coalesce(jsonb_object_agg(source, n), '{}')
        from (select o.source, count(*) n from public.orders o
               where o.restaurant_id = r.id and o.business_date = dt and o.closed_at is not null
               group by 1) x)
  );
end $$;

revoke all on function public.owner_briefing(uuid, date) from public, anon;
grant execute on function public.owner_briefing(uuid, date) to authenticated;
