-- =============================================================================
-- EXPIRY DATES, step 4: clearing out, catering, traceability
--   * expired lots can be thrown away in one go (expiry_sweep, a button), and automatically when a day is
--     closed (setting restaurants.profit_settings.expiry_auto_discard = true). Same bookkeeping as a manual
--     discard: a normal waste move linked to the lot, reason "expired". Closing a day never fails because of it;
--   * catering_expiry_check: for the confirmed catering orders of a day, how much of each tracked ingredient is
--     still good ON that day (lots that expire before the event do not count);
--   * traceability: which lots of which ingredient went into a production (production_trace), and the other
--     way round, which productions used a given lot (lot_trace), for a recall. Only dated lots are traced:
--     what came from the undated stock is shown as "untraced".
-- =============================================================================

-- ------------------------------------------------------------ throw away what expired
create or replace function app.expiry_sweep(p_restaurant_id uuid, p_through date, p_move_date date, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; g public.ingredients; take numeric; v numeric; mid bigint; n int := 0; cents numeric := 0; unit numeric;
begin
  for l in select x.id, x.ingredient_id, x.qty_remaining, x.unit_cost_cents
             from public.stock_lots x
             join public.ingredients i on i.restaurant_id = x.restaurant_id and i.id = x.ingredient_id
            where x.restaurant_id = p_restaurant_id and x.qty_remaining > 0 and x.expires_on <= p_through
              and i.track_expiry and i.stock_qty is not null
            order by x.expires_on, x.id loop
    begin   -- one lot at a time: a problem with one never blocks the others, nor the caller
      select * into g from public.ingredients where restaurant_id = p_restaurant_id and id = l.ingredient_id;
      take := least(l.qty_remaining, greatest(coalesce(g.stock_qty, 0), 0));
      if take > 0 then
        perform set_config('app.lots_skip', '1', true);
        update public.stock_lots set qty_remaining = qty_remaining - take, updated_at = now() where id = l.id;
        v := app.stock_apply(p_restaurant_id, g.id, 'waste', -take, p_move_date, '{}'::jsonb, p_note, null);
        perform set_config('app.lots_skip', '', true);
        if v is null then raise exception 'stock_not_tracked'; end if;
        select max(id) into mid from public.stock_moves where restaurant_id = p_restaurant_id and ingredient_id = g.id and kind = 'waste';
        update public.stock_moves set lot_id = l.id, waste_reason = 'expired' where id = mid;
        perform app.lots_trim(p_restaurant_id, g.id, v);
        unit := coalesce(l.unit_cost_cents, case when g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end);
        n := n + 1;
        cents := cents + coalesce(take * unit, 0);
      end if;
    exception when others then
      perform set_config('app.lots_skip', '', true);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'lots', n, 'cents', round(cents)::bigint);
end $$;
revoke all on function app.expiry_sweep(uuid, date, date, text) from public, anon, authenticated;

-- the button: everything that is past its date (yesterday and before) goes
create or replace function public.expiry_sweep(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; dt date;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  dt := app.business_date(r);
  return app.expiry_sweep(r.id, dt - 1, dt, 'Périmé (nettoyage)');
end $$;
revoke all on function public.expiry_sweep(uuid) from public, anon;
grant execute on function public.expiry_sweep(uuid) to authenticated;

-- closing a day: what expires that day (or before) is no longer sellable the next morning
create or replace function app.day_closures_sweep()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.restaurants where id = new.restaurant_id and coalesce(profit_settings ->> 'expiry_auto_discard', '') = 'true') then
    begin
      perform app.expiry_sweep(new.restaurant_id, new.business_date, new.business_date, 'Périmé (clôture de la journée)');
    exception when others then null;   -- closing the day must never fail because of this
    end;
  end if;
  return null;
end $$;
drop trigger if exists day_closures_sweep on public.day_closures;
create trigger day_closures_sweep after insert on public.day_closures
  for each row execute function app.day_closures_sweep();

-- ------------------------------------------------------------ catering: what is still good on the day
create or replace function public.catering_expiry_check(p_restaurant_id uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; items jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  if p_date is null then perform app.fail('invalid_request', 'date'); end if;
  with need as (select ingredient_id, sum(qty) qty from app.catering_needs(r.id, p_date) group by 1),
  lots as (
    select ingredient_id, sum(qty_remaining) dated,
           coalesce(sum(qty_remaining) filter (where expires_on >= p_date), 0) good,
           coalesce(sum(qty_remaining) filter (where expires_on < p_date), 0) bad
      from public.stock_lots where restaurant_id = r.id and qty_remaining > 0 group by 1),
  x as (
    select g.id, g.name, g.base_unit, n.qty need,
           greatest(greatest(coalesce(g.stock_qty, 0), 0) - coalesce(l.dated, 0), 0) + coalesce(l.good, 0) usable,
           coalesce(l.bad, 0) expiring
      from need n
      join public.ingredients g on g.restaurant_id = r.id and g.id = n.ingredient_id and g.track_expiry and g.active
      left join lots l on l.ingredient_id = g.id
     where n.qty > 0)
  select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', id, 'name', name, 'base_unit', base_unit,
           'need', round(need, 3), 'usable', round(usable, 3), 'expiring', round(expiring, 3),
           'short', round(greatest(need - usable, 0), 3)) order by greatest(need - usable, 0) desc, name), '[]'::jsonb)
    into items from x;
  return jsonb_build_object('date', p_date, 'items', items,
    'short_count', (select count(*)::int from jsonb_array_elements(items) e where (e ->> 'short')::numeric > 0));
end $$;
revoke all on function public.catering_expiry_check(uuid, date) from public, anon;
grant execute on function public.catering_expiry_check(uuid, date) to authenticated;

-- ------------------------------------------------------------ traceability
create table if not exists public.stock_lot_uses (
  id             bigint generated always as identity primary key,
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  production_id  uuid not null references public.production_batches (id) on delete cascade,
  lot_id         uuid,                                   -- no foreign key: the trace outlives a lot that is used up and removed
  ingredient_id  uuid not null,
  qty            numeric(14, 3) not null check (qty > 0),
  lot_code       text,
  supplier       text,
  received_on    date,
  expires_on     date,
  created_at     timestamptz not null default now()
);
create index if not exists stock_lot_uses_prod_idx on public.stock_lot_uses (production_id);
create index if not exists stock_lot_uses_lot_idx on public.stock_lot_uses (lot_id) where lot_id is not null;
alter table public.stock_lot_uses enable row level security;
grant select on public.stock_lot_uses to authenticated;
drop policy if exists stock_lot_uses_select on public.stock_lot_uses;
create policy stock_lot_uses_select on public.stock_lot_uses for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- same as before, plus: while a production is running (app.production_id), what is taken from a lot is noted
create or replace function app.lots_consume(p_restaurant_id uuid, p_ingredient_id uuid, p_qty numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; take numeric; rest numeric := p_qty; prod uuid := nullif(current_setting('app.production_id', true), '')::uuid;
begin
  for l in select id, qty_remaining, lot_code, supplier, received_on, expires_on from public.stock_lots
            where restaurant_id = p_restaurant_id and ingredient_id = p_ingredient_id and qty_remaining > 0
            order by expires_on, received_on, created_at, id for update loop
    exit when rest <= 0;
    take := least(l.qty_remaining, rest);
    update public.stock_lots set qty_remaining = qty_remaining - take, updated_at = now() where id = l.id;
    if prod is not null then
      insert into public.stock_lot_uses (restaurant_id, production_id, lot_id, ingredient_id, qty, lot_code, supplier, received_on, expires_on)
      values (p_restaurant_id, prod, l.id, p_ingredient_id, take, l.lot_code, l.supplier, l.received_on, l.expires_on);
    end if;
    rest := rest - take;
  end loop;
end $$;

-- production_record of step 3, with the production marked while its ingredients are taken out
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
  for u in select * from app.production_usage(r.id, g.id, p_qty) loop
    perform app.stock_apply(r.id, u.ingredient_id, 'production', -u.qty, dt, jsonb_build_object('production_id', b.id), g.name);
    n := n + 1;
  end loop;
  perform set_config('app.production_id', '', true);
  return jsonb_build_object('ok', true, 'id', b.id, 'ingredients', n, 'cost_cents', b.cost_cents,
                            'stock_qty', (select stock_qty from public.ingredients where id = g.id));
end $$;

-- what went into one production: per ingredient, the lots (with supplier and lot code) and what could not be traced
create or replace function public.production_trace(p_production_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.production_batches; r public.restaurants; g public.ingredients; items jsonb;
begin
  select * into b from public.production_batches where id = p_production_id;
  if b.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(b.restaurant_id, 'manager', false);
  select * into g from public.ingredients where restaurant_id = r.id and id = b.ingredient_id;
  with used as (
    select m.ingredient_id, sum(-m.qty) qty from public.stock_moves m
     where m.restaurant_id = r.id and m.production_id = b.id and m.qty < 0 group by 1),
  traced as (
    select ingredient_id, sum(qty) qty,
           jsonb_agg(jsonb_build_object('lot_code', lot_code, 'supplier', supplier, 'received_on', received_on, 'expires_on', expires_on, 'qty', qty)
                     order by expires_on, id) lots
      from public.stock_lot_uses where production_id = b.id group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', u.ingredient_id, 'name', i.name, 'base_unit', i.base_unit,
           'used', u.qty, 'traced', coalesce(t.qty, 0), 'untraced', greatest(u.qty - coalesce(t.qty, 0), 0), 'lots', coalesce(t.lots, '[]'::jsonb))
           order by i.name), '[]'::jsonb)
    into items
    from used u
    join public.ingredients i on i.restaurant_id = r.id and i.id = u.ingredient_id
    left join traced t on t.ingredient_id = u.ingredient_id;
  return jsonb_build_object('production_id', b.id, 'name', g.name, 'base_unit', g.base_unit, 'qty', b.qty, 'produced_on', b.produced_on,
                            'cancelled', b.cancelled_at is not null, 'ingredients', items);
end $$;

-- the other way round, for a recall: which productions used this lot
create or replace function public.lot_trace(p_lot_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare rid uuid; r public.restaurants; res jsonb;
begin
  select restaurant_id into rid from public.stock_lots where id = p_lot_id;
  if rid is null then select restaurant_id into rid from public.stock_lot_uses where lot_id = p_lot_id limit 1; end if;
  if rid is null then perform app.fail('not_found'); end if;
  r := app.require_role(rid, 'manager', false);
  select coalesce(jsonb_agg(jsonb_build_object('production_id', b.id, 'name', g.name, 'produced_on', b.produced_on,
           'qty_made', b.qty, 'qty_used', u.qty, 'cancelled', b.cancelled_at is not null) order by b.produced_on, b.created_at), '[]'::jsonb)
    into res
    from (select production_id, sum(qty) qty from public.stock_lot_uses where lot_id = p_lot_id group by 1) u
    join public.production_batches b on b.id = u.production_id
    join public.ingredients g on g.restaurant_id = b.restaurant_id and g.id = b.ingredient_id;
  return jsonb_build_object('lot_id', p_lot_id, 'productions', res);
end $$;

revoke all on function public.production_trace(uuid) from public, anon;
revoke all on function public.lot_trace(uuid) from public, anon;
grant execute on function public.production_trace(uuid) to authenticated;
grant execute on function public.lot_trace(uuid) to authenticated;
