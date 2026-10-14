-- =============================================================================
-- Preparations (half-products) and production, for pâtisseries, bakeries and kitchens
--
-- A preparation is an ingredient with its own recipe: "Crème pâtissière" (a batch of 2 kg made with
-- milk, eggs, sugar...), or a finished product made in the lab: "Croissant" (a batch of 60 pieces).
-- * Its cost is calculated by the system: purchase_price_cents = cost of one batch, purchase_qty =
--   what one batch yields (base unit). So every existing calculation (dish cost, margins, stock value,
--   what to buy) works with preparations as with any ingredient. Prices follow automatically.
-- * Made ahead (made_ahead = true, the default): it has its own stock. "Production" (60 croissants made)
--   takes its ingredients out of the stock and puts the preparation in; a sale takes the preparation out;
--   what is left at the end of the day is waste ("Perte"), so unsold pastries become visible.
-- * Made on the spot (made_ahead = false: a sauce, a dressing): no stock of its own; a sale takes its
--   ingredients out directly.
-- * A preparation can use other preparations (feuilletage in a croissant), up to 6 levels, never itself.
-- Reports: the theoretical use of raw ingredients goes through every preparation (sales exploded down
-- to butter and flour), so the real food cost and the gaps stay right; preparations themselves show
-- what was produced, sold and left.
-- =============================================================================

-- ------------------------------------------------------------ ingredients that are preparations
alter table public.ingredients add column if not exists is_preparation boolean not null default false;
alter table public.ingredients add column if not exists made_ahead boolean not null default true;
alter table public.ingredients drop constraint if exists ingredients_category_check;
alter table public.ingredients add constraint ingredients_category_check check (category in
  ('legumes', 'fruits', 'viande', 'poisson', 'laitier', 'epicerie', 'boissons', 'boulangerie', 'emballage', 'autre', 'preparation'));

create table if not exists public.preparation_lines (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  preparation_id uuid not null,
  ingredient_id  uuid not null,
  qty            numeric(14, 3) not null check (qty > 0 and qty < 100000000),   -- for one batch, base unit
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  check (preparation_id <> ingredient_id),
  foreign key (restaurant_id, preparation_id) references public.ingredients (restaurant_id, id) on delete cascade,
  -- an ingredient used in a preparation cannot be deleted by accident (hide it instead)
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete no action
);
create index if not exists preparation_lines_prep_idx on public.preparation_lines (restaurant_id, preparation_id, sort_order);
create index if not exists preparation_lines_ing_idx on public.preparation_lines (restaurant_id, ingredient_id);
drop trigger if exists preparation_lines_same_tenant on public.preparation_lines;
create trigger preparation_lines_same_tenant before update on public.preparation_lines
  for each row execute function app.forbid_restaurant_change();

alter table public.preparation_lines enable row level security;
grant select, insert, update, delete on public.preparation_lines to authenticated;
drop policy if exists preparation_lines_select on public.preparation_lines;
drop policy if exists preparation_lines_insert on public.preparation_lines;
drop policy if exists preparation_lines_update on public.preparation_lines;
drop policy if exists preparation_lines_delete on public.preparation_lines;
create policy preparation_lines_select on public.preparation_lines for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy preparation_lines_insert on public.preparation_lines for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy preparation_lines_update on public.preparation_lines for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy preparation_lines_delete on public.preparation_lines for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop trigger if exists audit_preparation_lines on public.preparation_lines;
create trigger audit_preparation_lines after insert or update or delete on public.preparation_lines
  for each row execute function app.audit();

-- ------------------------------------------------------------ the tree of a preparation
-- Everything one quantity of an ingredient stands for. p_stock_only:
--   true:  what leaves the stock (a preparation made on the spot is replaced by its ingredients);
--   false: every level (the preparation itself and everything inside it), for the theoretical use.
-- Quantities are net (as in the recipes): the caller adds the waste of each ingredient.
create or replace function app.prep_tree(p_restaurant_id uuid, p_ingredient_id uuid, p_qty numeric, p_stock_only boolean)
returns table (ingredient_id uuid, qty numeric)
language sql stable set search_path = '' as $$
  with recursive t(ingredient_id, qty, depth, expand) as (
    select g.id, p_qty, 0, g.is_preparation and (not p_stock_only or not g.made_ahead)
      from public.ingredients g where g.restaurant_id = p_restaurant_id and g.id = p_ingredient_id
    union all
    select c.id, t.qty * pl.qty / p.purchase_qty, t.depth + 1, c.is_preparation and (not p_stock_only or not c.made_ahead)
      from t
      join public.ingredients p on p.restaurant_id = p_restaurant_id and p.id = t.ingredient_id
      join public.preparation_lines pl on pl.restaurant_id = p_restaurant_id and pl.preparation_id = t.ingredient_id
      join public.ingredients c on c.restaurant_id = p_restaurant_id and c.id = pl.ingredient_id
     where t.expand and t.depth < 6)
  select t.ingredient_id, t.qty from t where not (p_stock_only and t.expand)
$$;

-- what one batch of a preparation costs (null while an ingredient has no price)
create or replace function app.prep_batch_cost(p_restaurant_id uuid, p_preparation_id uuid)
returns bigint language sql stable set search_path = '' as $$
  select case when count(*) = 0 or bool_or(g.purchase_price_cents is null) then null
              else round(sum(pl.qty / (1 - g.waste_bp / 10000.0) * g.purchase_price_cents / g.purchase_qty))::bigint end
    from public.preparation_lines pl
    join public.ingredients g on g.restaurant_id = pl.restaurant_id and g.id = pl.ingredient_id
   where pl.restaurant_id = p_restaurant_id and pl.preparation_id = p_preparation_id
$$;

-- keep the cost of a preparation up to date; the update itself refreshes the preparations that use it
create or replace function app.prep_refresh(p_restaurant_id uuid, p_preparation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c bigint;
begin
  if pg_trigger_depth() > 12 then return; end if;
  c := app.prep_batch_cost(p_restaurant_id, p_preparation_id);
  update public.ingredients set purchase_price_cents = c, price_estimated = false
   where restaurant_id = p_restaurant_id and id = p_preparation_id and is_preparation
     and purchase_price_cents is distinct from c;
end $$;

create or replace function app.preparation_lines_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform app.prep_refresh(old.restaurant_id, old.preparation_id); end if;
  if tg_op in ('INSERT', 'UPDATE') then perform app.prep_refresh(new.restaurant_id, new.preparation_id); end if;
  return null;
end $$;
drop trigger if exists preparation_lines_after on public.preparation_lines;
create trigger preparation_lines_after after insert or update or delete on public.preparation_lines
  for each row execute function app.preparation_lines_after();

-- a line must point at a preparation, and never make a loop (a preparation inside itself)
create or replace function app.preparation_lines_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.ingredients where restaurant_id = new.restaurant_id and id = new.preparation_id and is_preparation) then
    raise exception 'not a preparation' using errcode = '22023';
  end if;
  if exists (select 1 from app.prep_tree(new.restaurant_id, new.ingredient_id, 1, false) x where x.ingredient_id = new.preparation_id) then
    raise exception 'preparation loop' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists preparation_lines_check on public.preparation_lines;
create trigger preparation_lines_check before insert or update on public.preparation_lines
  for each row execute function app.preparation_lines_check();

-- an ingredient whose price, batch size or waste changes: the preparations using it follow
create or replace function app.ingredients_prep_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p uuid;
begin
  if new.purchase_price_cents is distinct from old.purchase_price_cents or new.purchase_qty is distinct from old.purchase_qty
     or new.waste_bp is distinct from old.waste_bp then
    for p in select distinct preparation_id from public.preparation_lines where restaurant_id = new.restaurant_id and ingredient_id = new.id loop
      perform app.prep_refresh(new.restaurant_id, p);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists ingredients_prep_cost on public.ingredients;
create trigger ingredients_prep_cost after update on public.ingredients
  for each row execute function app.ingredients_prep_cost();

-- the price of a preparation is calculated, never typed
create or replace function app.ingredients_prep_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_preparation and app.is_client() then
    if tg_op = 'INSERT' then new.purchase_price_cents := null;
    elsif new.purchase_price_cents is distinct from old.purchase_price_cents then new.purchase_price_cents := old.purchase_price_cents;
    end if;
    new.category := 'preparation';
  end if;
  if tg_op = 'UPDATE' and old.is_preparation and not new.is_preparation
     and exists (select 1 from public.preparation_lines where restaurant_id = new.restaurant_id and preparation_id = new.id) then
    raise exception 'preparation has a recipe' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists ingredients_prep_guard on public.ingredients;
create trigger ingredients_prep_guard before insert or update on public.ingredients
  for each row execute function app.ingredients_prep_guard();
-- a preparation whose batch size changed: its cost per unit follows (same batch cost, other yield)
-- (nothing to do: unit cost = batch cost / purchase_qty)

-- ------------------------------------------------------------ production
alter table public.stock_moves drop constraint if exists stock_moves_kind_check;
alter table public.stock_moves add constraint stock_moves_kind_check
  check (kind in ('sale', 'refund', 'purchase', 'waste', 'count', 'adjust', 'production'));
alter table public.stock_moves add column if not exists production_id uuid;

create table if not exists public.production_batches (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  ingredient_id  uuid not null,                        -- the preparation made
  qty            numeric(14, 3) not null check (qty > 0 and qty < 100000000),   -- base unit
  produced_on    date not null,
  cost_cents     bigint,                               -- what it cost, at the prices of that day
  note           text check (length(note) <= 200),
  catering_id    uuid,                                 -- made for a catering order (set by the catering module)
  cancelled_at   timestamptz,
  staff_id       uuid,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete no action
);
create index if not exists production_batches_day_idx on public.production_batches (restaurant_id, produced_on desc);
alter table public.production_batches enable row level security;
grant select on public.production_batches to authenticated;
drop policy if exists production_batches_select on public.production_batches;
create policy production_batches_select on public.production_batches for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
drop trigger if exists audit_production_batches on public.production_batches;
create trigger audit_production_batches after insert or update or delete on public.production_batches
  for each row execute function app.audit();

-- stock moves can point at a production (to show and to undo it)
create or replace function app.stock_apply(
  p_restaurant_id uuid, p_ingredient_id uuid, p_kind text, p_qty numeric, p_date date,
  p_refs jsonb default '{}'::jsonb, p_note text default null, p_staff_id uuid default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare old_q numeric; new_q numeric; since date;
begin
  if p_qty is null or p_qty = 0 then return null; end if;
  select stock_qty, stock_since into old_q, since from public.ingredients
   where restaurant_id = p_restaurant_id and id = p_ingredient_id for update;
  if old_q is null then return null; end if;
  -- a count is the stock at the END of its day: what happened that day (or before) is already in it
  if p_kind <> 'adjust' and since is not null
     and (p_date < since or (p_date = since and not coalesce((p_refs ->> 'after_count')::boolean, false))) then
    return null;
  end if;
  new_q := old_q + p_qty;
  update public.ingredients set stock_qty = new_q, stock_updated_at = now()
   where restaurant_id = p_restaurant_id and id = p_ingredient_id;
  insert into public.stock_moves (restaurant_id, ingredient_id, kind, qty, stock_after, business_date, after_count,
                                  order_id, document_id, doc_number, purchase_id, menu_item_id, production_id, note, staff_id)
  values (p_restaurant_id, p_ingredient_id, p_kind, p_qty, new_q, p_date, coalesce((p_refs ->> 'after_count')::boolean, false),
          app.try_uuid(p_refs ->> 'order_id'), app.try_uuid(p_refs ->> 'document_id'), p_refs ->> 'doc_number',
          app.try_uuid(p_refs ->> 'purchase_id'), app.try_uuid(p_refs ->> 'menu_item_id'), app.try_uuid(p_refs ->> 'production_id'),
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_staff_id);
  perform app.stock_availability(p_restaurant_id, p_ingredient_id, old_q, new_q);
  return new_q;
end $$;

-- the ingredients one production uses (stock rule: made-ahead preparations come out of their own stock)
create or replace function app.production_usage(p_restaurant_id uuid, p_preparation_id uuid, p_qty numeric)
returns table (ingredient_id uuid, qty numeric)
language sql stable set search_path = '' as $$
  select x.ingredient_id, sum(x.qty / (1 - g.waste_bp / 10000.0))
    from public.preparation_lines pl
    join public.ingredients p on p.restaurant_id = pl.restaurant_id and p.id = pl.preparation_id
    cross join lateral app.prep_tree(p_restaurant_id, pl.ingredient_id, p_qty * pl.qty / p.purchase_qty, true) x
    join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = x.ingredient_id
   where pl.restaurant_id = p_restaurant_id and pl.preparation_id = p_preparation_id
   group by x.ingredient_id
$$;

/** "Made today: 60 croissants." Ingredients out, the preparation in (its stock starts here if new). */
create or replace function public.production_record(p_ingredient_id uuid, p_qty numeric, p_note text default null, p_catering_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; b public.production_batches; dt date; u record; n int := 0;
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
  for u in select * from app.production_usage(r.id, g.id, p_qty) loop
    perform app.stock_apply(r.id, u.ingredient_id, 'production', -u.qty, dt, jsonb_build_object('production_id', b.id), g.name);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'id', b.id, 'ingredients', n, 'cost_cents', b.cost_cents,
                            'stock_qty', (select stock_qty from public.ingredients where id = g.id));
end $$;

/** A production noted by mistake: everything goes back. */
create or replace function public.production_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.production_batches; r public.restaurants; m record;
begin
  select * into b from public.production_batches where id = p_id;
  if b.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(b.restaurant_id, 'manager', true);
  if b.cancelled_at is not null then perform app.fail('already_cancelled'); end if;
  update public.production_batches set cancelled_at = now() where id = b.id;
  for m in select ingredient_id, sum(qty) q from public.stock_moves where restaurant_id = r.id and production_id = b.id group by 1 loop
    perform app.stock_apply(r.id, m.ingredient_id, 'adjust', -m.q, app.business_date(r), jsonb_build_object('production_id', b.id), 'Production annulée');
  end loop;
  return jsonb_build_object('ok', true);
end $$;

/** What to make today: per preparation made ahead, the stock, the average daily use (last 4 weeks, same
 *  weekday when there is enough history) and catering orders due; the suggestion = need - stock. */
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
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
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
  made as (
    select ingredient_id, sum(qty) qty from public.production_batches
     where restaurant_id = r.id and produced_on = dt and cancelled_at is null group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit, 'purchase_unit', g.purchase_unit, 'batch_qty', g.purchase_qty,
      'stock_qty', g.stock_qty, 'daily', round(coalesce(a.daily, 0), 3), 'made_today', coalesce(m.qty, 0),
      'catering', coalesce((select sum(c.qty) from app.catering_needs(r.id, dt) c where c.ingredient_id = g.id), 0),
      'suggested', greatest(0, round(coalesce(a.daily, 0)
                                     + coalesce((select sum(c.qty) from app.catering_needs(r.id, dt) c where c.ingredient_id = g.id), 0)
                                     - greatest(coalesce(g.stock_qty, 0), 0), 3)),
      'cost_cents', g.purchase_price_cents
    ) order by g.name), '[]'::jsonb)
    into items
    from public.ingredients g
    left join avg_use a on a.ingredient_id = g.id
    left join made m on m.ingredient_id = g.id
   where g.restaurant_id = r.id and g.active and g.is_preparation and g.made_ahead;
  return jsonb_build_object('date', dt, 'items', items);
end $$;

-- catering needs per preparation (the catering module redefines it; until then: none)
create or replace function app.catering_needs(p_restaurant_id uuid, p_date date)
returns table (ingredient_id uuid, qty numeric) language sql stable set search_path = '' as $$
  select null::uuid, 0::numeric where false
$$;

revoke all on function public.production_record(uuid, numeric, text, uuid) from public, anon;
revoke all on function public.production_cancel(uuid) from public, anon;
revoke all on function public.production_plan(uuid, date) from public, anon;
grant execute on function public.production_record(uuid, numeric, text, uuid) to authenticated;
grant execute on function public.production_cancel(uuid) to authenticated;
grant execute on function public.production_plan(uuid, date) to authenticated;

-- ------------------------------------------------------------ sales: preparations made on the spot
-- what an order (as billed) uses, per ingredient: dishes, sizes and options; a preparation made on the
-- spot is replaced by its ingredients, a made-ahead one comes out of its own stock
create or replace function app.order_usage(p_restaurant_id uuid, p_order_id uuid)
returns table (ingredient_id uuid, qty numeric) language sql stable security definer set search_path = '' as $$
  with l as (
    select menu_item_id, variant_id, quantity, modifiers,
           coalesce((select o.order_type = 'dine_in' from public.orders o where o.restaurant_id = p_restaurant_id and o.id = p_order_id), true) din
      from public.order_lines
     where restaurant_id = p_restaurant_id and order_id = p_order_id and menu_item_id is not null),
  u as (
    select rl.ingredient_id, l.quantity * rl.qty q
      from l join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.menu_item_id = l.menu_item_id
                                         and (rl.variant_id is null or rl.variant_id = l.variant_id)
                                         and (not rl.dine_in_only or l.din)
    union all
    select rl.ingredient_id, l.quantity * rl.qty
      from l cross join lateral jsonb_array_elements(l.modifiers) m
      join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.modifier_option_id = app.try_uuid(m ->> 'id')
                                         and (not rl.dine_in_only or l.din))
  select x.ingredient_id, sum(x.qty / (1 - g.waste_bp / 10000.0))
    from u
    cross join lateral app.prep_tree(p_restaurant_id, u.ingredient_id, u.q, true) x
    join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = x.ingredient_id
   group by x.ingredient_id
$$;

-- ------------------------------------------------------------ reports
-- Gaps between two counts: the theoretical use of raw ingredients goes through every preparation;
-- a preparation came in by production; the totals count raw ingredients only (no double count).
create or replace function public.stock_report(p_restaurant_id uuid, p_from uuid, p_to uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        public.restaurants;
  a        public.stock_counts;
  b        public.stock_counts;
  x        public.stock_counts;
  uses_pos boolean;
  rev_ht   bigint;
  items    jsonb;
  totals   jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  select * into a from public.stock_counts where restaurant_id = r.id and id = p_from;
  select * into b from public.stock_counts where restaurant_id = r.id and id = p_to;
  if a.id is null or b.id is null then raise exception 'unknown count' using errcode = '22023'; end if;
  if a.status <> 'closed' or b.status <> 'closed' then raise exception 'count not closed' using errcode = '22023'; end if;
  if a.counted_on > b.counted_on then x := a; a := b; b := x; end if;
  if a.counted_on = b.counted_on then raise exception 'same day' using errcode = '22023'; end if;
  uses_pos := 'pos' = any (r.products);

  select coalesce(sum(total_ht_cents), 0) into rev_ht
    from public.fiscal_documents where restaurant_id = r.id and business_date > a.counted_on and business_date <= b.counted_on;

  with
  o as (select ingredient_id, qty from public.stock_count_lines where restaurant_id = r.id and count_id = a.id),
  c as (select ingredient_id, qty from public.stock_count_lines where restaurant_id = r.id and count_id = b.id),
  buy as (
    select ingredient_id, sum(qty) qty, sum(total_cents) spent
      from public.stock_purchases
     where restaurant_id = r.id
       and (purchased_on > a.counted_on or (purchased_on = a.counted_on and after_count))
       and (purchased_on < b.counted_on or (purchased_on = b.counted_on and not after_count))
     group by 1),
  sold as (
    select l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and od.business_date > a.counted_on and od.business_date <= b.counted_on and l.menu_item_id is not null
     group by 1, 2, 3),
  -- recipe quantities are what ends up on the plate: add the waste back (peel, bones)
  -- through every preparation: the croissants sold stand for their butter and flour too
  theo as (
    select pt.ingredient_id, sum(pt.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
      cross join lateral app.prep_tree(r.id, rl.ingredient_id, s.qty * rl.qty, false) pt
      join public.ingredients g on g.restaurant_id = r.id and g.id = pt.ingredient_id
     group by 1),
  -- preparations come in by production, not by purchase
  made as (
    select ingredient_id, sum(qty) qty, sum(cost_cents) cost
      from public.production_batches
     where restaurant_id = r.id and cancelled_at is null and produced_on > a.counted_on and produced_on <= b.counted_on
     group by 1),
  base as (
    select g.id, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty,
           case when g.purchase_price_cents is not null then g.purchase_price_cents::numeric / g.purchase_qty end unit_cost,
           o.qty opening, c.qty closing, coalesce(buy.qty, 0) + coalesce(made.qty, 0) bought, buy.spent,
           g.is_preparation, coalesce(made.qty, 0) produced,
           case when uses_pos then coalesce(theo.qty, 0) end theo
      from public.ingredients g
      left join o on o.ingredient_id = g.id
      left join c on c.ingredient_id = g.id
      left join buy on buy.ingredient_id = g.id
      left join theo on theo.ingredient_id = g.id
      left join made on made.ingredient_id = g.id
     where g.restaurant_id = r.id
       and (o.qty is not null or c.qty is not null or buy.qty is not null or theo.qty is not null or made.qty is not null)),
  calc as (
    select *, (opening is not null and closing is not null) counted,
           case when opening is not null and closing is not null then opening + bought - closing end used
      from base),
  val as (
    select *, case when used is not null and theo is not null then used - theo end gap,
           round(used * unit_cost)::bigint used_cents,
           round(theo * unit_cost)::bigint theo_cents,
           round((used - theo) * unit_cost)::bigint gap_cents
      from calc)
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', id, 'name', name, 'name_ar', name_ar, 'category', category, 'base_unit', base_unit,
      'purchase_unit', purchase_unit, 'purchase_qty', purchase_qty, 'priced', unit_cost is not null,
      'counted', counted, 'opening', opening, 'bought', bought, 'closing', closing, 'used', used,
      'theoretical', theo, 'gap', gap, 'is_preparation', is_preparation, 'produced', produced,
      'used_cents', used_cents, 'theoretical_cents', theo_cents, 'gap_cents', gap_cents,
      -- more came out of the counts than went in: a purchase was not noted, or a count is wrong
      'negative', coalesce(used < 0, false)
    ) order by counted desc, coalesce(abs(gap_cents), 0) desc, coalesce(used_cents, 0) desc, name), '[]'::jsonb),
    jsonb_build_object(
      'used_cents', coalesce(sum(used_cents) filter (where counted and not is_preparation), 0),
      'theoretical_cents', case when uses_pos then coalesce(sum(theo_cents) filter (where counted and not is_preparation), 0) end,
      'gap_cents', case when uses_pos then coalesce(sum(gap_cents) filter (where counted and not is_preparation and gap_cents > 0), 0) end,
      'surplus_cents', case when uses_pos then coalesce(-sum(gap_cents) filter (where counted and not is_preparation and gap_cents < 0), 0) end,
      'purchases_cents', coalesce(sum(spent), 0),
      'counted', count(*) filter (where counted),
      'not_counted', count(*) filter (where not counted),
      'unpriced', count(*) filter (where counted and unit_cost is null),
      'negative', count(*) filter (where used < 0))
    into items, totals
    from val;

  return jsonb_build_object(
    'from', jsonb_build_object('id', a.id, 'counted_on', a.counted_on),
    'to', jsonb_build_object('id', b.id, 'counted_on', b.counted_on),
    'days', b.counted_on - a.counted_on,
    'uses_pos', uses_pos,
    'revenue_ht_cents', case when uses_pos then rev_ht end,
    -- real food cost of the period: what was really used / what was sold (excl. VAT)
    'real_food_cost_bp', case when uses_pos and rev_ht > 0 then round((totals ->> 'used_cents')::numeric * 10000 / rev_ht)::int end,
    'totals', totals,
    'items', items);
end $$;

-- What to buy: the use of raw ingredients through every preparation; preparations are made, not bought.
create or replace function public.stock_forecast(p_restaurant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r          public.restaurants;
  today      date;
  uses_pos   boolean;
  order_days int;
  sales_days int;
  items      jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := app.business_date(r);
  uses_pos := 'pos' = any (r.products);
  order_days := least(60, greatest(1, coalesce((r.profit_settings ->> 'order_days')::int, 7)));

  -- how many days of till history to average over (a new restaurant has less than 28)
  select least(28, today - min(o.business_date) + 1) into sales_days
    from public.orders o
   where o.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled'
     and o.business_date > today - 28 and o.business_date <= today;
  if not uses_pos then sales_days := null; end if;

  with
  -- what each dish sold per day uses, for every sale day we need
  sold as (
    select od.business_date d, l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where uses_pos and l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and l.menu_item_id is not null and od.business_date > today - 400 and od.business_date <= today
     group by 1, 2, 3, 4),
  use_by_day as (
    select s.d, pt.ingredient_id, sum(pt.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
      cross join lateral app.prep_tree(r.id, rl.ingredient_id, s.qty * rl.qty, false) pt
      join public.ingredients g on g.restaurant_id = r.id and g.id = pt.ingredient_id
     group by 1, 2),
  -- the last closed count of each ingredient
  last_count as (
    select distinct on (l.ingredient_id) l.ingredient_id, c.counted_on, l.qty
      from public.stock_count_lines l
      join public.stock_counts c on c.restaurant_id = l.restaurant_id and c.id = l.count_id
     where l.restaurant_id = r.id and c.status = 'closed' and c.counted_on <= today
     order by l.ingredient_id, c.counted_on desc, c.created_at desc),
  -- the count before that, for the use per day without a till
  prev_count as (
    select distinct on (l.ingredient_id) l.ingredient_id, c.counted_on, l.qty
      from public.stock_count_lines l
      join public.stock_counts c on c.restaurant_id = l.restaurant_id and c.id = l.count_id
      join last_count lc on lc.ingredient_id = l.ingredient_id and c.counted_on < lc.counted_on
     where l.restaurant_id = r.id and c.status = 'closed'
     order by l.ingredient_id, c.counted_on desc, c.created_at desc),
  base as (
    select g.id, g.is_preparation, g.stock_qty, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty, g.purchase_price_cents, g.supplier,
           lc.counted_on, lc.qty counted,
           (select coalesce(sum(p.qty), 0) from public.stock_purchases p
             where p.restaurant_id = r.id and p.ingredient_id = g.id and lc.counted_on is not null
               and (p.purchased_on > lc.counted_on or (p.purchased_on = lc.counted_on and p.after_count)))
           + (select coalesce(sum(pb.qty), 0) from public.production_batches pb
               where pb.restaurant_id = r.id and pb.ingredient_id = g.id and pb.cancelled_at is null
                 and lc.counted_on is not null and pb.produced_on > lc.counted_on) bought_since,
           (select sum(u.qty) from use_by_day u where u.ingredient_id = g.id and lc.counted_on is not null and u.d > lc.counted_on) sold_since,
           case when sales_days > 0 then
             (select sum(u.qty) from use_by_day u where u.ingredient_id = g.id and u.d > today - sales_days) / sales_days end sales_daily,
           case when pc.counted_on is not null then
             greatest(0, pc.qty
               + (select coalesce(sum(p.qty), 0) from public.stock_purchases p
                   where p.restaurant_id = r.id and p.ingredient_id = g.id
                     and (p.purchased_on > pc.counted_on or (p.purchased_on = pc.counted_on and p.after_count))
                     and (p.purchased_on < lc.counted_on or (p.purchased_on = lc.counted_on and not p.after_count)))
               - lc.qty) / (lc.counted_on - pc.counted_on) end count_daily
      from public.ingredients g
      left join last_count lc on lc.ingredient_id = g.id
      left join prev_count pc on pc.ingredient_id = g.id
     where g.restaurant_id = r.id and g.active),
  est as (
    select *,
           case when sales_daily > 0 then 'sales' when count_daily is not null then 'counts' end daily_source,
           coalesce(nullif(sales_daily, 0), count_daily) daily,
           case when stock_qty is not null then stock_qty   -- live stock
                when counted is null then null
                -- with the till: what the sales used since the count (sales-based use exists)
                when sales_daily > 0 then counted + bought_since - coalesce(sold_since, 0)
                when count_daily is not null then counted + bought_since - count_daily * (today - counted_on)
                else counted + bought_since end raw_estimate
      from base),
  fin as (
    select *, greatest(raw_estimate, 0) estimate,
           case when daily > 0 and raw_estimate is not null then greatest(raw_estimate, 0) / daily end days_left,
           -- a preparation is made in the kitchen, not bought: see the production plan
           case when daily > 0 and not is_preparation then greatest(0, daily * order_days - greatest(coalesce(raw_estimate, 0), 0)) end to_buy
      from est)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', id, 'is_preparation', is_preparation, 'name', name, 'name_ar', name_ar, 'category', category, 'base_unit', base_unit,
      'purchase_unit', purchase_unit, 'purchase_qty', purchase_qty, 'purchase_price_cents', purchase_price_cents, 'supplier', supplier,
      'counted_on', counted_on, 'counted', counted, 'bought_since', bought_since,
      'estimate', round(estimate, 3), 'live', stock_qty is not null, 'below_zero', coalesce(raw_estimate < 0, false),
      'daily', round(daily, 3), 'daily_source', daily_source,
      'days_left', round(days_left, 1),
      'to_buy', round(to_buy, 3),
      'to_buy_cents', case when to_buy > 0 and purchase_price_cents is not null then round(to_buy * purchase_price_cents / purchase_qty)::bigint end,
      'status', case when is_preparation then 'made'
                     when counted is null and stock_qty is null then 'not_counted'
                     when daily is null or daily = 0 then 'no_use'
                     when days_left < 2 then 'urgent'
                     when days_left < order_days then 'order'
                     else 'ok' end
    ) order by (counted is null), days_left nulls last, name), '[]'::jsonb)
    into items
    from fin;

  return jsonb_build_object('today', today, 'uses_pos', uses_pos, 'order_days', order_days, 'sales_days', sales_days, 'items', items);
end $$;
