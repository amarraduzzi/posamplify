-- =============================================================================
-- EXPIRY DATES, step 1: lots (a delivery with its date), discarding, FEFO bookkeeping
--
-- The stock of an ingredient stays ONE number (ingredients.stock_qty, with its ledger stock_moves).
-- For an ingredient that has track_expiry on, the dated part of that stock is also kept as lots:
--   * a purchase received with an expiry date (or, if none is given, today + the ingredient's
--     shelf life, marked "estimated") creates a lot;
--   * whatever leaves the stock (sale, loss, production, count) leaves the undated stock first (it is
--     the oldest), then the lots, soonest expiry first (FEFO). This is done by a trigger on
--     ingredients.stock_qty, so every existing path (stock_apply, stock_reset, ...) stays untouched;
--   * the dated lots never add up to more than the stock: the rest is "undated" stock (stock that
--     was there before tracking started, refunds, positive corrections). A manager can date it
--     (stock_lot_from_rest);
--   * a lot can be discarded (stock_lot_discard): a normal 'waste' move with the lot and a reason, so
--     every existing waste figure keeps working and expired waste can be told apart (waste_reason).
-- Nothing changes for an ingredient with track_expiry off (the default).
-- =============================================================================

-- ------------------------------------------------------------ settings and columns
alter table public.ingredients
  add column if not exists track_expiry boolean not null default false,
  add column if not exists expiry_type text not null default 'dlc' check (expiry_type in ('dlc', 'ddm')),   -- dlc: to eat by; ddm: best before
  add column if not exists shelf_life_days integer check (shelf_life_days is null or shelf_life_days between 1 and 3650),
  add column if not exists expiry_warn_days integer not null default 2 check (expiry_warn_days between 0 and 60);

alter table public.stock_purchases
  add column if not exists expires_on date,
  add column if not exists lot_code text check (lot_code is null or length(lot_code) <= 40);
alter table public.stock_purchases drop constraint if exists stock_purchases_expires_check;
alter table public.stock_purchases add constraint stock_purchases_expires_check
  check (expires_on is null or (expires_on >= purchased_on - 365 and expires_on <= purchased_on + 3650));

alter table public.stock_moves
  add column if not exists lot_id uuid,
  add column if not exists waste_reason text check (waste_reason is null or waste_reason in ('expired', 'damaged', 'returned', 'quality', 'other'));

-- ------------------------------------------------------------ lots
create table if not exists public.stock_lots (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  ingredient_id   uuid not null,
  qty_initial     numeric(14, 3) not null check (qty_initial > 0),
  qty_remaining   numeric(14, 3) not null check (qty_remaining >= 0),            -- base unit
  expires_on      date not null,
  estimated       boolean not null default false,                                -- the date came from the shelf life, not from the label
  received_on     date not null,
  lot_code        text check (lot_code is null or length(lot_code) <= 40),
  supplier        text check (supplier is null or length(supplier) <= 80),
  unit_cost_cents numeric(16, 6) check (unit_cost_cents is null or unit_cost_cents >= 0),   -- per base unit, to value a loss
  source          text not null default 'purchase' check (source in ('purchase', 'opening')),
  purchase_id     uuid references public.stock_purchases (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create index if not exists stock_lots_ing_idx on public.stock_lots (restaurant_id, ingredient_id, expires_on) where qty_remaining > 0;
create index if not exists stock_lots_exp_idx on public.stock_lots (restaurant_id, expires_on) where qty_remaining > 0;
create index if not exists stock_lots_purchase_idx on public.stock_lots (purchase_id) where purchase_id is not null;

alter table public.stock_lots enable row level security;
grant select on public.stock_lots to authenticated;
drop policy if exists stock_lots_select on public.stock_lots;
create policy stock_lots_select on public.stock_lots for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- ------------------------------------------------------------ bookkeeping
-- take a quantity out of the lots, soonest expiry first
create or replace function app.lots_consume(p_restaurant_id uuid, p_ingredient_id uuid, p_qty numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare l record; take numeric; rest numeric := p_qty;
begin
  for l in select id, qty_remaining from public.stock_lots
            where restaurant_id = p_restaurant_id and ingredient_id = p_ingredient_id and qty_remaining > 0
            order by expires_on, received_on, created_at, id for update loop
    exit when rest <= 0;
    take := least(l.qty_remaining, rest);
    update public.stock_lots set qty_remaining = qty_remaining - take, updated_at = now() where id = l.id;
    rest := rest - take;
  end loop;
end $$;

-- the dated lots never add up to more than the stock
create or replace function app.lots_trim(p_restaurant_id uuid, p_ingredient_id uuid, p_stock numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare total numeric;
begin
  select coalesce(sum(qty_remaining), 0) into total from public.stock_lots
   where restaurant_id = p_restaurant_id and ingredient_id = p_ingredient_id and qty_remaining > 0;
  if total > greatest(coalesce(p_stock, 0), 0) then
    perform app.lots_consume(p_restaurant_id, p_ingredient_id, total - greatest(coalesce(p_stock, 0), 0));
  end if;
end $$;

-- every change of the live stock moves the lots (unless the caller handles the lots itself)
-- Stock without a date is the oldest (it was there before the tracking started): it leaves first,
-- then the lots, soonest expiry first.
create or replace function app.ingredients_lots_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gone numeric; dated numeric; undated numeric;
begin
  if coalesce(current_setting('app.lots_skip', true), '') = '1' then return null; end if;
  if old.stock_qty is not null and new.stock_qty is not null and new.stock_qty < old.stock_qty then
    gone := old.stock_qty - new.stock_qty;
    select coalesce(sum(qty_remaining), 0) into dated from public.stock_lots
     where restaurant_id = new.restaurant_id and ingredient_id = new.id and qty_remaining > 0;
    undated := greatest(old.stock_qty - dated, 0);
    if gone > undated then perform app.lots_consume(new.restaurant_id, new.id, gone - undated); end if;
  end if;
  perform app.lots_trim(new.restaurant_id, new.id, new.stock_qty);
  return null;
end $$;
drop trigger if exists ingredients_lots_sync on public.ingredients;
create trigger ingredients_lots_sync after update of stock_qty on public.ingredients
  for each row when (new.track_expiry and new.stock_qty is distinct from old.stock_qty)
  execute function app.ingredients_lots_sync();

-- switching the tracking off forgets the lots
create or replace function app.ingredients_lots_off()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.stock_lots where restaurant_id = new.restaurant_id and ingredient_id = new.id;
  return null;
end $$;
drop trigger if exists ingredients_lots_off on public.ingredients;
create trigger ingredients_lots_off after update of track_expiry on public.ingredients
  for each row when (old.track_expiry and not new.track_expiry)
  execute function app.ingredients_lots_off();

-- ------------------------------------------------------------ purchases create lots
-- (same as before, plus the lot; an edited purchase keeps what was already used from its lot)
create or replace function app.stock_purchases_live()
returns trigger language plpgsql security definer set search_path = '' as $$
declare done numeric; g public.ingredients; lot public.stock_lots; consumed numeric := 0;
        exp date; est boolean; unit numeric; rid uuid; iid uuid; tr boolean; q numeric;
begin
  if app.purging() then return null; end if;
  rid := case when tg_op = 'DELETE' then old.restaurant_id else new.restaurant_id end;
  iid := case when tg_op = 'DELETE' then old.ingredient_id else new.ingredient_id end;
  if tg_op in ('UPDATE', 'DELETE') then
    select coalesce(sum(qty), 0) into done from public.stock_moves where purchase_id = old.id;
    select * into lot from public.stock_lots where purchase_id = old.id;
    if lot.id is not null then
      consumed := lot.qty_initial - lot.qty_remaining;
      delete from public.stock_lots where id = lot.id;
    end if;
    if done <> 0 and exists (select 1 from public.ingredients where restaurant_id = old.restaurant_id and id = old.ingredient_id) then
      perform set_config('app.lots_skip', '1', true);
      perform app.stock_apply(old.restaurant_id, old.ingredient_id, 'purchase', -done, old.purchased_on,
                              jsonb_build_object('purchase_id', old.id, 'after_count', old.after_count), 'Achat modifié ou supprimé', null);
      perform set_config('app.lots_skip', '', true);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select * into g from public.ingredients where restaurant_id = new.restaurant_id and id = new.ingredient_id;
    if g.stock_qty is not null and g.stock_since is not null
       and (new.purchased_on > g.stock_since or (new.purchased_on = g.stock_since and new.after_count)) then
      perform app.stock_apply(new.restaurant_id, new.ingredient_id, 'purchase', new.qty, new.purchased_on,
                              jsonb_build_object('purchase_id', new.id, 'after_count', new.after_count), new.supplier, null);
      if g.track_expiry then
        exp := new.expires_on; est := false;
        if exp is null and g.shelf_life_days is not null then exp := new.purchased_on + g.shelf_life_days; est := true; end if;
        if exp is not null then
          unit := case when new.total_cents is not null and new.qty > 0 then new.total_cents::numeric / new.qty
                       when g.purchase_price_cents is not null and g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end;
          insert into public.stock_lots (restaurant_id, ingredient_id, qty_initial, qty_remaining, expires_on, estimated, received_on,
                                         lot_code, supplier, unit_cost_cents, source, purchase_id)
          values (new.restaurant_id, new.ingredient_id, new.qty, greatest(new.qty - consumed, 0), exp, est, new.purchased_on,
                  new.lot_code, new.supplier, unit, 'purchase', new.id);
        end if;
      end if;
    end if;
  end if;
  select track_expiry, stock_qty into tr, q from public.ingredients where restaurant_id = rid and id = iid;
  if coalesce(tr, false) then perform app.lots_trim(rid, iid, q); end if;
  return null;
end $$;

-- a delivery received with the date of each line (optional: expires_on, lot_code)
create or replace function public.po_receive(p_order_id uuid, p_lines jsonb, p_received_on date default null, p_after_count boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; r public.restaurants; l public.purchase_order_lines; g public.ingredients; x jsonb;
        v_units numeric; v_cents bigint; pid uuid; dt date; n int := 0; alerts jsonb := '[]'; old_unit numeric; new_unit numeric; sup text; v_exp date; v_code text;
begin
  select * into po from public.purchase_orders where id = p_order_id for update;
  if po.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(po.restaurant_id, 'manager', true);
  if po.status in ('received', 'cancelled') then perform app.fail('po_closed'); end if;
  if jsonb_typeof(p_lines) <> 'array' then perform app.fail('invalid_request', 'lines'); end if;
  dt := coalesce(p_received_on, app.business_date(r));
  if dt > app.business_date(r) then perform app.fail('invalid_date'); end if;
  select name into sup from public.suppliers where restaurant_id = r.id and id = po.supplier_id;
  for x in select * from jsonb_array_elements(p_lines) loop
    select * into l from public.purchase_order_lines where restaurant_id = r.id and order_id = po.id and id = app.try_uuid(x ->> 'line_id');
    if l.id is null then perform app.fail('not_found', 'line'); end if;
    v_units := nullif(x ->> 'units', '')::numeric;
    v_cents := nullif(x ->> 'total_cents', '')::bigint;
    if v_units is null or v_units < 0 or v_units >= 1000000 or (v_cents is not null and (v_cents < 0 or v_cents > 10000000000)) then
      perform app.fail('invalid_request', 'line');
    end if;
    v_exp := nullif(x ->> 'expires_on', '')::date;
    v_code := nullif(left(btrim(coalesce(x ->> 'lot_code', '')), 40), '');
    if v_exp is not null and (v_exp < dt - 365 or v_exp > dt + 3650) then perform app.fail('invalid_request', 'expires_on'); end if;
    pid := null;
    if v_units > 0 then
      select * into g from public.ingredients where restaurant_id = r.id and id = l.ingredient_id;
      old_unit := g.purchase_price_cents;
      insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, supplier, supplier_id, purchase_order_id, after_count, expires_on, lot_code)
      values (r.id, g.id, dt, v_units * g.purchase_qty, v_cents, sup, po.supplier_id, po.id, p_after_count, v_exp, v_code)
      returning id into pid;
      n := n + 1;
      -- price up by more than 5 % compared with the last known price
      if v_cents is not null and v_cents > 0 and old_unit is not null and old_unit > 0 then
        new_unit := v_cents / v_units;
        if new_unit > old_unit * 1.05 then
          alerts := alerts || jsonb_build_object('ingredient_id', g.id, 'name', g.name, 'purchase_unit', g.purchase_unit,
                                                 'old_cents', old_unit, 'new_cents', round(new_unit)::bigint,
                                                 'bp', round((new_unit - old_unit) * 10000 / old_unit)::int);
        end if;
      end if;
    end if;
    update public.purchase_order_lines set received_units = v_units, received_cents = v_cents, purchase_id = pid where id = l.id;
  end loop;
  update public.purchase_orders set status = 'received', received_at = now(), received_on = dt where id = po.id;
  return jsonb_build_object('ok', true, 'purchases', n, 'price_alerts', alerts,
    'total_cents', (select coalesce(sum(received_cents), 0) from public.purchase_order_lines where order_id = po.id));
end $$;

-- ------------------------------------------------------------ actions (manager)
-- Throw away (part of) a lot: a normal loss of the stock, linked to the lot and with a reason.
create or replace function public.stock_lot_discard(p_lot_id uuid, p_qty numeric, p_reason text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.stock_lots; g public.ingredients; r public.restaurants; v numeric; mid bigint; txt text;
begin
  select * into l from public.stock_lots where id = p_lot_id for update;
  if l.id is null then perform app.fail('not_found'); end if;
  select * into g from public.ingredients where restaurant_id = l.restaurant_id and id = l.ingredient_id;
  r := app.require_role(l.restaurant_id, 'manager', true);
  if p_qty is null or p_qty <= 0 or p_qty > l.qty_remaining then perform app.fail('invalid_request', 'qty'); end if;
  if p_reason is null or p_reason not in ('expired', 'damaged', 'returned', 'quality', 'other') then perform app.fail('invalid_request', 'reason'); end if;
  if g.stock_qty is null then perform app.fail('stock_not_tracked'); end if;
  txt := coalesce(nullif(left(btrim(coalesce(p_note, '')), 200), ''),
    case p_reason when 'expired' then 'Périmé' when 'damaged' then 'Abîmé' when 'returned' then 'Rendu au fournisseur' when 'quality' then 'Qualité' else 'Autre' end);
  perform set_config('app.lots_skip', '1', true);
  update public.stock_lots set qty_remaining = qty_remaining - p_qty, updated_at = now() where id = l.id;
  v := app.stock_apply(r.id, g.id, 'waste', -p_qty, app.business_date(r), '{}'::jsonb, txt, null);
  perform set_config('app.lots_skip', '', true);
  if v is null then perform app.fail('stock_not_tracked'); end if;
  select max(id) into mid from public.stock_moves where restaurant_id = r.id and ingredient_id = g.id and kind = 'waste';
  update public.stock_moves set lot_id = l.id, waste_reason = p_reason where id = mid;
  perform app.lots_trim(r.id, g.id, v);
  return jsonb_build_object('ok', true, 'stock_qty', v, 'cost_cents', case when l.unit_cost_cents is not null then round(p_qty * l.unit_cost_cents)::bigint end);
end $$;

-- Correct the date (or the code) of a lot.
create or replace function public.stock_lot_set_expiry(p_lot_id uuid, p_expires_on date, p_lot_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.stock_lots; r public.restaurants;
begin
  select * into l from public.stock_lots where id = p_lot_id for update;
  if l.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(l.restaurant_id, 'manager', true);
  if p_expires_on is null or p_expires_on < l.received_on - 365 or p_expires_on > l.received_on + 3650 then perform app.fail('invalid_request', 'expires_on'); end if;
  update public.stock_lots set expires_on = p_expires_on, estimated = false,
         lot_code = coalesce(nullif(left(btrim(coalesce(p_lot_code, '')), 40), ''), lot_code), updated_at = now()
   where id = l.id;
  return jsonb_build_object('ok', true);
end $$;

-- Give a date to stock that has none yet (stock from before the tracking, or after a correction).
create or replace function public.stock_lot_from_rest(p_ingredient_id uuid, p_qty numeric, p_expires_on date, p_lot_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; dated numeric; new_id uuid; dt date;
begin
  select * into g from public.ingredients where id = p_ingredient_id for update;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if not g.track_expiry then perform app.fail('expiry_not_tracked'); end if;
  if g.stock_qty is null then perform app.fail('stock_not_tracked'); end if;
  dt := app.business_date(r);
  if p_qty is null or p_qty <= 0 or p_qty >= 1000000000 then perform app.fail('invalid_request', 'qty'); end if;
  if p_expires_on is null or p_expires_on < dt - 365 or p_expires_on > dt + 3650 then perform app.fail('invalid_request', 'expires_on'); end if;
  select coalesce(sum(qty_remaining), 0) into dated from public.stock_lots where restaurant_id = r.id and ingredient_id = g.id and qty_remaining > 0;
  if p_qty > g.stock_qty - dated then perform app.fail('invalid_request', 'qty'); end if;
  insert into public.stock_lots (restaurant_id, ingredient_id, qty_initial, qty_remaining, expires_on, estimated, received_on, lot_code, unit_cost_cents, source)
  values (r.id, g.id, p_qty, p_qty, p_expires_on, false, dt, nullif(left(btrim(coalesce(p_lot_code, '')), 40), ''),
          case when g.purchase_price_cents is not null and g.purchase_qty > 0 then g.purchase_price_cents::numeric / g.purchase_qty end, 'opening')
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

revoke all on function public.stock_lot_discard(uuid, numeric, text, text) from public, anon;
revoke all on function public.stock_lot_set_expiry(uuid, date, text) from public, anon;
revoke all on function public.stock_lot_from_rest(uuid, numeric, date, text) from public, anon;
grant execute on function public.stock_lot_discard(uuid, numeric, text, text) to authenticated;
grant execute on function public.stock_lot_set_expiry(uuid, date, text) to authenticated;
grant execute on function public.stock_lot_from_rest(uuid, numeric, date, text) to authenticated;
