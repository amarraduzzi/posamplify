-- =============================================================================
-- EXPIRY DATES, step 2: what to use today (briefing) and what expiry costs (loss report)
--   * expiry_alerts: the lots that are past their date, expire today, or expire within the warning
--     days of their ingredient, with the amount in cents (the briefing shows "À utiliser aujourd'hui");
--   * expiry_losses: what was thrown away because it expired over a period, in cents, against the
--     period before it, by ingredient, by day and by reason, plus what is expired but not thrown yet.
-- Read only: nothing changes for anyone who does not call these. FEFO itself (soonest expiry leaves
-- first when something is sold) is the trigger of step 1; step 2 only adds tests around it.
--
-- A lot is valued at its own unit cost, or else at the purchase price of the ingredient. With neither,
-- it has no amount: it is counted as "unpriced" instead of being counted as 0.
-- =============================================================================

-- ------------------------------------------------------------ helper: one bucket of the alerts
-- p_items: array of {ingredient_id, name, base_unit, qty, value_cents, expires_on, days_left, lots}
create or replace function app.expiry_pack(p_items jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'count',       jsonb_array_length(p_items),
    'value_cents', coalesce((select sum((e ->> 'value_cents')::bigint) from jsonb_array_elements(p_items) e), 0),
    'unpriced',    (select count(*)::int from jsonb_array_elements(p_items) e where e ->> 'value_cents' is null),
    'items',       coalesce((select jsonb_agg(s.e order by s.o)
                               from (select e, o from jsonb_array_elements(p_items) with ordinality t(e, o) order by o limit 8) s), '[]'::jsonb));
$$;
revoke all on function app.expiry_pack(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------ the briefing
create or replace function public.expiry_alerts(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; dt date; res jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  dt := app.business_date(r);
  with x as (
    select g.id ingredient_id, g.name, g.base_unit,
           case when l.expires_on < dt then 'expired' when l.expires_on = dt then 'today' else 'soon' end bucket,
           l.qty_remaining, l.expires_on,
           case when coalesce(l.unit_cost_cents, case when g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end) is not null
                then l.qty_remaining * coalesce(l.unit_cost_cents, g.purchase_price_cents::numeric / g.purchase_qty) end value
      from public.stock_lots l
      join public.ingredients g on g.restaurant_id = l.restaurant_id and g.id = l.ingredient_id
     where l.restaurant_id = r.id and l.qty_remaining > 0 and g.active and g.track_expiry
       and l.expires_on <= dt + g.expiry_warn_days),
  y as (   -- one row per ingredient and bucket: its quantity, its soonest date, its amount
    select bucket, ingredient_id, name, base_unit, sum(qty_remaining) qty, min(expires_on) expires_on, count(*)::int lots,
           round(sum(value))::bigint value_cents
      from x group by bucket, ingredient_id, name, base_unit)
  select jsonb_build_object('date', dt,
    'expired', app.expiry_pack(coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'name', name, 'base_unit', base_unit, 'qty', qty,
                 'value_cents', value_cents, 'expires_on', expires_on, 'days_left', expires_on - dt, 'lots', lots)
                 order by value_cents desc nulls last, name) from y where bucket = 'expired'), '[]'::jsonb)),
    'today',   app.expiry_pack(coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'name', name, 'base_unit', base_unit, 'qty', qty,
                 'value_cents', value_cents, 'expires_on', expires_on, 'days_left', expires_on - dt, 'lots', lots)
                 order by value_cents desc nulls last, name) from y where bucket = 'today'), '[]'::jsonb)),
    'soon',    app.expiry_pack(coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'name', name, 'base_unit', base_unit, 'qty', qty,
                 'value_cents', value_cents, 'expires_on', expires_on, 'days_left', expires_on - dt, 'lots', lots)
                 order by expires_on, value_cents desc nulls last, name) from y where bucket = 'soon'), '[]'::jsonb)))
    into res;
  return res;
end $$;

-- ------------------------------------------------------------ the loss report
-- What was thrown away from a lot over the last p_days days (today included), against the p_days before.
-- Only lot discards count (stock_lot_discard): they carry a reason. "expired" is the headline figure.
create or replace function public.expiry_losses(p_restaurant_id uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; dt date; d0 date; res jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_days is null or p_days < 1 or p_days > 366 then perform app.fail('invalid_request', 'days'); end if;
  dt := app.business_date(r);
  d0 := dt - (p_days - 1);
  with mv as (
    select m.business_date d, m.ingredient_id, g.name, g.base_unit, -m.qty qty, m.waste_reason reason,
           round(-m.qty * c.u)::bigint cents
      from public.stock_moves m
      join public.ingredients g on g.restaurant_id = m.restaurant_id and g.id = m.ingredient_id
      left join public.stock_lots l on l.restaurant_id = m.restaurant_id and l.id = m.lot_id
      cross join lateral (select coalesce(l.unit_cost_cents, case when g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end) u) c
     where m.restaurant_id = r.id and m.kind = 'waste' and m.lot_id is not null and m.waste_reason is not null
       and m.business_date between d0 - p_days and dt),
  cur as (select * from mv where d >= d0),
  prev as (select * from mv where d < d0),
  stake as (   -- expired and still in stock: it will be lost as soon as somebody throws it away
    select l.qty_remaining * coalesce(l.unit_cost_cents, case when g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end) v
      from public.stock_lots l
      join public.ingredients g on g.restaurant_id = l.restaurant_id and g.id = l.ingredient_id
     where l.restaurant_id = r.id and l.qty_remaining > 0 and l.expires_on < dt and g.active and g.track_expiry)
  select jsonb_build_object(
    'from', d0, 'to', dt, 'days', p_days,
    'tracking',         (select count(*)::int from public.ingredients where restaurant_id = r.id and active and track_expiry),
    'expired_cents',    coalesce((select sum(cents) from cur where reason = 'expired'), 0),
    'expired_count',    (select count(*)::int from cur where reason = 'expired'),
    'expired_unpriced', (select count(*)::int from cur where reason = 'expired' and cents is null),
    'previous_cents',   coalesce((select sum(cents) from prev where reason = 'expired'), 0),
    'other_cents',      coalesce((select sum(cents) from cur where reason <> 'expired'), 0),
    'by_reason', coalesce((select jsonb_agg(jsonb_build_object('reason', reason, 'cents', coalesce(c, 0), 'n', n) order by c desc nulls last, reason)
                             from (select reason, sum(cents) c, count(*)::int n from cur group by reason) s), '[]'::jsonb),
    'by_ingredient', coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'name', name, 'base_unit', base_unit,
                                                                   'qty', qty, 'cents', coalesce(c, 0), 'n', n) order by c desc nulls last, name)
                                 from (select ingredient_id, name, base_unit, sum(qty) qty, sum(cents) c, count(*)::int n
                                         from cur where reason = 'expired' group by ingredient_id, name, base_unit
                                        order by sum(cents) desc nulls last, name limit 10) s), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'cents', coalesce(c, 0)) order by d)
                          from (select d, sum(cents) c from cur where reason = 'expired' group by d) s), '[]'::jsonb),
    'at_stake', (select jsonb_build_object('count', count(*)::int, 'cents', coalesce(round(sum(v)), 0)::bigint, 'unpriced', (count(*) filter (where v is null))::int) from stake)
  ) into res;
  return res;
end $$;

revoke all on function public.expiry_alerts(uuid) from public, anon;
revoke all on function public.expiry_losses(uuid, integer) from public, anon;
grant execute on function public.expiry_alerts(uuid) to authenticated;
grant execute on function public.expiry_losses(uuid, integer) to authenticated;
