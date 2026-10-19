-- =============================================================================
-- EXPIRY DATES, step 3: preparations (pâtisserie)
--   * a preparation with track_expiry on and a shelf life gets a lot with every production
--     (expires = day produced + shelf life); cancelling the production takes that lot away again;
--   * the production plan only counts stock that is still sellable: expired lots no longer cover the need.
-- Nothing changes for a preparation with track_expiry off (the default).
-- =============================================================================

alter table public.stock_lots
  add column if not exists production_id uuid references public.production_batches (id) on delete cascade;
alter table public.stock_lots drop constraint if exists stock_lots_source_check;
alter table public.stock_lots add constraint stock_lots_source_check check (source in ('purchase', 'opening', 'production'));
create index if not exists stock_lots_production_idx on public.stock_lots (production_id) where production_id is not null;

-- ------------------------------------------------------------ production makes a lot
create or replace function public.production_record(p_ingredient_id uuid, p_qty numeric, p_note text default null, p_catering_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; b public.production_batches; dt date; u record; n int := 0; live numeric;
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if not g.is_preparation then perform app.fail('not_a_preparation'); end if;
  if not g.made_ahead then perform app.fail('made_on_the_spot'); end if;
  if p_qty is null or p_qty <= 0 or p_qty >= 100000000 then perform app.fail('invalid_request', 'qty'); end if;
  if not exists (select 1 from public.preparation_lines where restaurant_id = r.id and preparation_id = g.id) then perform app.fail('no_recipe'); end if;
  dt := app.business_date(r);
  insert into public.production_batches (restaurant_id, ingredient_id, qty, produced_on, cost_cents, note, catering_id)
  values (r.id, g.id, p_qty, dt, case when g.purchase_price_cents is not null then round(p_qty * g.purchase_price_cents / g.purchase_qty) end,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_catering_id)
  returning * into b;
  -- a preparation made for the first time starts its live stock now
  if g.stock_qty is null then
    update public.ingredients set stock_qty = 0, stock_since = null, stock_updated_at = now() where restaurant_id = r.id and id = g.id;
  end if;
  perform app.stock_apply(r.id, g.id, 'production', p_qty, dt, jsonb_build_object('production_id', b.id), g.name);
  -- the lot of this production (never more than the live stock: the dated lots never exceed it)
  if g.track_expiry and g.shelf_life_days is not null then
    select greatest(coalesce(stock_qty, 0), 0) into live from public.ingredients where id = g.id;
    if least(p_qty, live) > 0 then
      insert into public.stock_lots (restaurant_id, ingredient_id, qty_initial, qty_remaining, expires_on, estimated, received_on, source, production_id, unit_cost_cents)
      values (r.id, g.id, least(p_qty, live), least(p_qty, live), dt + g.shelf_life_days, false, dt, 'production', b.id,
              case when g.purchase_price_cents is not null and g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end);
    end if;
  end if;
  for u in select * from app.production_usage(r.id, g.id, p_qty) loop
    perform app.stock_apply(r.id, u.ingredient_id, 'production', -u.qty, dt, jsonb_build_object('production_id', b.id), g.name);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'id', b.id, 'ingredients', n, 'cost_cents', b.cost_cents,
                            'stock_qty', (select stock_qty from public.ingredients where id = g.id));
end $$;

/** A production noted by mistake: everything goes back, including the lot it made. */
create or replace function public.production_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.production_batches; r public.restaurants; m record;
begin
  select * into b from public.production_batches where id = p_id;
  if b.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(b.restaurant_id, 'manager', true);
  if b.cancelled_at is not null then perform app.fail('already_cancelled'); end if;
  update public.production_batches set cancelled_at = now() where id = b.id;
  -- the lot of this production goes away as a whole; the other lots must stay as they are
  delete from public.stock_lots where restaurant_id = r.id and production_id = b.id;
  perform set_config('app.lots_skip', '1', true);
  for m in select ingredient_id, sum(qty) q from public.stock_moves where restaurant_id = r.id and production_id = b.id group by 1 loop
    perform app.stock_apply(r.id, m.ingredient_id, 'adjust', -m.q, app.business_date(r), jsonb_build_object('production_id', b.id), 'Production annulée');
  end loop;
  perform set_config('app.lots_skip', '', true);
  perform app.lots_trim(r.id, b.ingredient_id, (select stock_qty from public.ingredients where id = b.ingredient_id));
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------ the plan counts what can still be sold
create or replace function public.production_plan(p_restaurant_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; dt date; items jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  dt := coalesce(p_date, app.business_date(r));
  with
  sold as (
    select od.business_date d, l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled' and od.source <> 'catering'
       and l.menu_item_id is not null and od.business_date >= dt - 28 and od.business_date < dt
     group by 1, 2, 3, 4),
  use_by_day as (
    select s.d, x.ingredient_id, sum(x.qty) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
      cross join lateral app.prep_tree(r.id, rl.ingredient_id, s.qty * rl.qty, false) x
     group by 1, 2),
  days as (select count(distinct d) n, count(distinct d) filter (where extract(isodow from d) = extract(isodow from dt)) nw from sold),
  avg_use as (
    select u.ingredient_id,
           case when (select nw from days) >= 2
                then sum(u.qty) filter (where extract(isodow from u.d) = extract(isodow from dt)) / (select nw from days)
                else sum(u.qty) / nullif((select n from days), 0) end daily
      from use_by_day u group by 1),
  cat as (select * from app.catering_needs(r.id, dt)),
  made as (
    select ingredient_id, sum(qty) qty from public.production_batches
     where restaurant_id = r.id and produced_on = dt and cancelled_at is null group by 1),
  gone as (   -- stock whose date has passed on the day of the plan: it can no longer be sold
    select ingredient_id, sum(qty_remaining) qty from public.stock_lots
     where restaurant_id = r.id and qty_remaining > 0 and expires_on < dt group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit, 'purchase_unit', g.purchase_unit, 'batch_qty', g.purchase_qty,
      'stock_qty', g.stock_qty, 'daily', round(coalesce(a.daily, 0), 3), 'made_today', coalesce(m.qty, 0),
      'catering', round(coalesce(c.qty, 0), 3),
      'expired_qty', coalesce(x.qty, 0),
      'suggested', greatest(0, round(coalesce(a.daily, 0) + coalesce(c.qty, 0) - greatest(greatest(coalesce(g.stock_qty, 0), 0) - coalesce(x.qty, 0), 0), 3)),
      'cost_cents', g.purchase_price_cents
    ) order by g.name), '[]'::jsonb)
    into items
    from public.ingredients g
    left join avg_use a on a.ingredient_id = g.id
    left join cat c on c.ingredient_id = g.id
    left join made m on m.ingredient_id = g.id
    left join gone x on x.ingredient_id = g.id
   where g.restaurant_id = r.id and g.active and g.is_preparation and g.made_ahead;
  return jsonb_build_object('date', dt, 'items', items);
end $$;
