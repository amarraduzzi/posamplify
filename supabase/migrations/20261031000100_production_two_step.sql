-- =============================================================================
-- PRODUCTION IN TWO STEPS: start the batch, note what came out when it is out of the oven
--
-- You only know how much came out after the oven. So a production can now be recorded in two steps:
--   1. production_start(preparation, planned quantity): the ingredients for the planned quantity leave the
--      stock NOW (with their lots, for the traceability), and the batch is "running" (status 'running').
--      The stock of the preparation itself does not change yet.
--   2. production_finish(batch, quantity obtained): the stock of the preparation gets what really came out
--      (with its lot and expiry date), the batch becomes 'done' and the yield is known (obtained / planned).
-- production_cancel works for both: a running batch gives the ingredients back, a finished one also takes
-- the preparation and its lot away. production_record (everything in one go, optionally with the planned
-- quantity) stays as it is: it is the quick route when the batch is already out.
--
-- A running batch has qty = 0: sums of what was produced (plan, stock reconciliation, reports) do not count
-- it until it is finished. The cost of the batch is that of the ingredients of the planned quantity, as soon
-- as they are taken out. The preparation goes into stock on the day it is finished.
-- =============================================================================

alter table public.production_batches
  add column if not exists status text not null default 'done' check (status in ('running', 'done')),
  add column if not exists finished_at timestamptz;

-- the quantity check of the table ("qty > 0") becomes: > 0, except for a running batch (0 until it is finished)
do $$ declare c text; begin
  for c in select x.conname from pg_constraint x
            where x.conrelid = 'public.production_batches'::regclass and x.contype = 'c'
              and x.conname <> 'production_batches_qty_status_check'
              and x.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'public.production_batches'::regclass and a.attname = 'qty')]::int2[]
  loop execute format('alter table public.production_batches drop constraint %I', c); end loop;
end $$;
alter table public.production_batches drop constraint if exists production_batches_qty_status_check;
alter table public.production_batches add constraint production_batches_qty_status_check
  check ((status = 'running' and qty = 0) or (status = 'done' and qty > 0 and qty < 100000000));

-- ------------------------------------------------------------ step 1: start
create or replace function public.production_start(p_ingredient_id uuid, p_planned_qty numeric, p_note text default null, p_catering_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; b public.production_batches; dt date; u record; n int := 0;
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if not g.is_preparation then perform app.fail('not_a_preparation'); end if;
  if not g.made_ahead then perform app.fail('made_on_the_spot'); end if;
  if p_planned_qty is null or p_planned_qty <= 0 or p_planned_qty >= 100000000 then perform app.fail('invalid_request', 'planned_qty'); end if;
  if not exists (select 1 from public.preparation_lines where restaurant_id = r.id and preparation_id = g.id) then perform app.fail('no_recipe'); end if;
  dt := app.business_date(r);
  insert into public.production_batches (restaurant_id, ingredient_id, qty, planned_qty, produced_on, cost_cents, note, catering_id, status)
  values (r.id, g.id, 0, p_planned_qty, dt,
          case when g.purchase_price_cents is not null then round(p_planned_qty * g.purchase_price_cents / g.purchase_qty) end,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_catering_id, 'running')
  returning * into b;
  perform set_config('app.production_id', b.id::text, true);
  for u in select * from app.production_usage(r.id, g.id, p_planned_qty) loop
    perform app.stock_apply(r.id, u.ingredient_id, 'production', -u.qty, dt, jsonb_build_object('production_id', b.id), g.name);
    n := n + 1;
  end loop;
  perform set_config('app.production_id', '', true);
  return jsonb_build_object('ok', true, 'id', b.id, 'ingredients', n, 'cost_cents', b.cost_cents, 'planned_qty', b.planned_qty);
end $$;

-- ------------------------------------------------------------ step 2: finish
create or replace function public.production_finish(p_id uuid, p_qty numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.production_batches; g public.ingredients; r public.restaurants; dt date; live numeric;
begin
  select * into b from public.production_batches where id = p_id for update;
  if b.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(b.restaurant_id, 'manager', true);
  if b.cancelled_at is not null then perform app.fail('already_cancelled'); end if;
  if b.status <> 'running' then perform app.fail('not_running'); end if;
  if p_qty is null or p_qty <= 0 or p_qty >= 100000000 then perform app.fail('invalid_request', 'qty'); end if;
  select * into g from public.ingredients where restaurant_id = r.id and id = b.ingredient_id;
  dt := app.business_date(r);
  update public.production_batches set qty = p_qty, status = 'done', finished_at = now() where id = b.id returning * into b;
  -- a preparation made for the first time starts its live stock now
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
  return jsonb_build_object('ok', true, 'id', b.id, 'cost_cents', b.cost_cents,
                            'stock_qty', (select stock_qty from public.ingredients where id = g.id),
                            'planned_qty', b.planned_qty,
                            'yield_bp', case when b.planned_qty is not null then round(b.qty * 10000 / b.planned_qty)::int end);
end $$;

revoke all on function public.production_start(uuid, numeric, text, uuid) from public, anon;
revoke all on function public.production_finish(uuid, numeric) from public, anon;
grant execute on function public.production_start(uuid, numeric, text, uuid) to authenticated;
grant execute on function public.production_finish(uuid, numeric) to authenticated;

-- ------------------------------------------------------------ the report ignores batches still running
-- Same report as before; a running batch has no result yet, so only 'done' batches count.
create or replace function public.production_yield_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; items jsonb; total_loss bigint; total_measured int;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then perform app.fail('invalid_request', 'period'); end if;

  with b as (
    select x.ingredient_id, x.qty, x.planned_qty, x.cost_cents
      from public.production_batches x
     where x.restaurant_id = r.id and x.cancelled_at is null and x.status = 'done' and x.produced_on between p_from and p_to),
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
