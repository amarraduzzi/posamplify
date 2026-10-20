-- =============================================================================
-- PRODUCTION YIELD: what you meant to make against what came out (baking loss)
--
-- Until now a production was booked for the quantity that came out, and the ingredients were scaled to
-- that quantity. A batch that came out short (too long in the oven, a collapsed cake, dough thrown away)
-- therefore looked perfect: fewer ingredients were booked, and the loss stayed invisible.
--
-- Now production_record takes an optional fifth value, p_planned_qty: the quantity the ingredients taken
-- out were meant for (the quantity you started from). Example: ingredients for 60 croissants are taken
-- out (p_planned_qty = 60), 54 come out of the oven (p_qty = 54): the stock gets 54, the ingredients of 60
-- leave the stock, and the batch shows a yield of 90 %.
--   * Without p_planned_qty everything works as before (ingredients scaled to p_qty, no yield measured).
--   * The cost of the batch (cost_cents) is what the ingredients really cost, so the loss is in the books.
--   * production_yield_report: per preparation over a period, the yield and what the loss cost. Only
--     productions where the planned quantity was given count; the others are "not measured".
-- Nothing changes for productions already recorded (planned_qty stays empty).
-- =============================================================================

alter table public.production_batches
  add column if not exists planned_qty numeric(14, 3) check (planned_qty is null or (planned_qty > 0 and planned_qty < 100000000));

-- ------------------------------------------------------------ production_record with a planned quantity
-- Same function as before (with the lots of step 3 and the traceability of step 4), plus p_planned_qty.
-- The old four-argument version is dropped: two versions would make a call with four values ambiguous.
drop function if exists public.production_record(uuid, numeric, text, uuid);

create or replace function public.production_record(p_ingredient_id uuid, p_qty numeric, p_note text default null, p_catering_id uuid default null, p_planned_qty numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; b public.production_batches; dt date; u record; n int := 0; live numeric; used_for numeric;
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if not g.is_preparation then perform app.fail('not_a_preparation'); end if;
  if not g.made_ahead then perform app.fail('made_on_the_spot'); end if;
  if p_qty is null or p_qty <= 0 or p_qty >= 100000000 then perform app.fail('invalid_request', 'qty'); end if;
  if p_planned_qty is not null and (p_planned_qty <= 0 or p_planned_qty >= 100000000) then perform app.fail('invalid_request', 'planned_qty'); end if;
  if not exists (select 1 from public.preparation_lines where restaurant_id = r.id and preparation_id = g.id) then perform app.fail('no_recipe'); end if;
  dt := app.business_date(r);
  used_for := coalesce(p_planned_qty, p_qty);   -- the ingredients taken out are the ones for this quantity
  insert into public.production_batches (restaurant_id, ingredient_id, qty, planned_qty, produced_on, cost_cents, note, catering_id)
  values (r.id, g.id, p_qty, p_planned_qty, dt,
          case when g.purchase_price_cents is not null then round(used_for * g.purchase_price_cents / g.purchase_qty) end,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_catering_id)
  returning * into b;
  if g.stock_qty is null then
    update public.ingredients set stock_qty = 0, stock_since = null, stock_updated_at = now() where restaurant_id = r.id and id = g.id;
  end if;
  perform app.stock_apply(r.id, g.id, 'production', p_qty, dt, jsonb_build_object('production_id', b.id), g.name);
  if g.track_expiry and g.shelf_life_days is not null then
    select greatest(coalesce(stock_qty, 0), 0) into live from public.ingredients where id = g.id;
    if least(p_qty, live) > 0 then
      insert into public.stock_lots (restaurant_id, ingredient_id, qty_initial, qty_remaining, expires_on, estimated, received_on, source, production_id, unit_cost_cents)
      values (r.id, g.id, least(p_qty, live), least(p_qty, live), dt + g.shelf_life_days, false, dt, 'production', b.id,
              case when g.purchase_price_cents is not null and g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end);
    end if;
  end if;
  perform set_config('app.production_id', b.id::text, true);
  for u in select * from app.production_usage(r.id, g.id, used_for) loop
    perform app.stock_apply(r.id, u.ingredient_id, 'production', -u.qty, dt, jsonb_build_object('production_id', b.id), g.name);
    n := n + 1;
  end loop;
  perform set_config('app.production_id', '', true);
  return jsonb_build_object('ok', true, 'id', b.id, 'ingredients', n, 'cost_cents', b.cost_cents,
                            'stock_qty', (select stock_qty from public.ingredients where id = g.id),
                            'planned_qty', b.planned_qty,
                            'yield_bp', case when b.planned_qty is not null then round(b.qty * 10000 / b.planned_qty)::int end);
end $$;

revoke all on function public.production_record(uuid, numeric, text, uuid, numeric) from public, anon;
grant execute on function public.production_record(uuid, numeric, text, uuid, numeric) to authenticated;

-- ------------------------------------------------------------ the report
-- Per preparation, over a period (production dates, both ends included): how many productions, how many
-- of them with a measured yield, what came out against what was planned, the yield in basis points
-- (10000 = 100 %), the lowest yield of one production, and what the loss cost (the ingredients of the
-- missing part, at the cost of each production). A surplus counts against the loss, so the figures are net.
create or replace function public.production_yield_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; items jsonb; total_loss bigint; total_measured int;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then perform app.fail('invalid_request', 'period'); end if;

  with b as (
    select x.ingredient_id, x.qty, x.planned_qty, x.cost_cents
      from public.production_batches x
     where x.restaurant_id = r.id and x.cancelled_at is null and x.produced_on between p_from and p_to),
  agg as (
    select b.ingredient_id,
           count(*) batches,
           count(*) filter (where b.planned_qty is not null) measured,
           sum(b.qty) filter (where b.planned_qty is not null) produced_qty,
           sum(b.planned_qty) filter (where b.planned_qty is not null) planned_qty,
           min(round(b.qty * 10000 / b.planned_qty)) filter (where b.planned_qty is not null) lowest_bp,
           round(sum(b.cost_cents * (b.planned_qty - b.qty) / b.planned_qty)
                 filter (where b.planned_qty is not null and b.cost_cents is not null)) loss_cents
      from b group by b.ingredient_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit,
           'batches', a.batches, 'measured', a.measured,
           'produced_qty', a.produced_qty, 'planned_qty', a.planned_qty,
           'yield_bp', case when a.planned_qty > 0 then round(a.produced_qty * 10000 / a.planned_qty)::int end,
           'lowest_yield_bp', a.lowest_bp::int,
           'loss_qty', a.planned_qty - a.produced_qty,
           'loss_cents', a.loss_cents::bigint)
         order by a.loss_cents desc nulls last, g.name), '[]'::jsonb),
         coalesce(sum(a.loss_cents), 0)::bigint, coalesce(sum(a.measured), 0)::int
    into items, total_loss, total_measured
    from agg a
    join public.ingredients g on g.restaurant_id = r.id and g.id = a.ingredient_id;

  return jsonb_build_object('from', p_from, 'to', p_to, 'items', items,
                            'totals', jsonb_build_object('measured', total_measured, 'loss_cents', total_loss));
end $$;

revoke all on function public.production_yield_report(uuid, date, date) from public, anon;
grant execute on function public.production_yield_report(uuid, date, date) to authenticated;
