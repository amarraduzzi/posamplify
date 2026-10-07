-- =============================================================================
-- 0031 LIVE STOCK
-- =============================================================================
-- The stock of an ingredient is known live from the moment it is counted once
-- (a closed count, or "set the stock now" by a manager). From then on every
-- movement changes it right away and is written in a ledger:
--   sale      a paid ticket: recipe card x quantity (+ the recipes of the
--             chosen options, e.g. "extra cheese"), waste on peeling included
--   refund    a credit note on such a ticket puts it back
--   purchase  a purchase noted after the count
--   waste     a loss noted at the till (a dish) or in the back office
--   count     a count resets it: counted + what moved after that day
--   adjust    a manager sets the right quantity by hand
-- Ingredients never counted are not tracked (stock_qty is null).
--
-- Optional (profit_settings ->> 'auto_sold_out'): when an ingredient no longer
-- covers one portion, the dishes that need it are shown as sold out on the
-- till and the QR menu; when stock comes back they return by themselves. Only
-- on the crossing, so staff can still switch a dish back on by hand.
-- =============================================================================

-- ------------------------------------------------------------ data
alter table public.ingredients
  add column if not exists stock_qty numeric(16, 3),            -- live stock in the base unit; null = not tracked
  add column if not exists stock_since date,                    -- business day of the count it starts from
  add column if not exists stock_min numeric(14, 3) check (stock_min is null or (stock_min >= 0 and stock_min < 1000000000)),
  add column if not exists stock_updated_at timestamptz;

alter table public.menu_items
  add column if not exists sold_out_by_stock boolean not null default false;

-- options ("extra cheese", "large") can have a recipe card too
alter table public.recipe_lines alter column menu_item_id drop not null;
alter table public.recipe_lines add column if not exists modifier_option_id uuid;
alter table public.recipe_lines drop constraint if exists recipe_lines_option_fk;
alter table public.recipe_lines add constraint recipe_lines_option_fk
  foreign key (restaurant_id, modifier_option_id) references public.modifier_options (restaurant_id, id) on delete cascade;
alter table public.recipe_lines drop constraint if exists recipe_lines_one_owner;
alter table public.recipe_lines add constraint recipe_lines_one_owner
  check ((menu_item_id is null) <> (modifier_option_id is null) and (modifier_option_id is null or variant_id is null));
create index if not exists recipe_lines_option_idx on public.recipe_lines (restaurant_id, modifier_option_id) where modifier_option_id is not null;

create table if not exists public.stock_moves (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  ingredient_id uuid not null,
  kind          text not null check (kind in ('sale', 'refund', 'purchase', 'waste', 'count', 'adjust')),
  qty           numeric(16, 3) not null,          -- + in, - out (base unit)
  stock_after   numeric(16, 3) not null,
  business_date date not null,
  after_count   boolean not null default false,   -- a purchase received after that day's count
  order_id      uuid,
  document_id   uuid,
  doc_number    text,
  purchase_id   uuid,
  count_id      uuid,
  menu_item_id  uuid,
  note          text check (length(note) <= 200),
  staff_id      uuid,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create index if not exists stock_moves_ing_idx on public.stock_moves (restaurant_id, ingredient_id, created_at desc);
create index if not exists stock_moves_day_idx on public.stock_moves (restaurant_id, business_date);
create index if not exists stock_moves_purchase_idx on public.stock_moves (purchase_id) where purchase_id is not null;

alter table public.stock_moves enable row level security;
grant select on public.stock_moves to authenticated;
drop policy if exists stock_moves_select on public.stock_moves;
create policy stock_moves_select on public.stock_moves for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- ------------------------------------------------------------ guards
-- the live stock only moves through the server
create or replace function app.ingredients_stock_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client() then
    if tg_op = 'INSERT' then
      new.stock_qty := null; new.stock_since := null; new.stock_updated_at := null;
    elsif new.stock_qty is distinct from old.stock_qty or new.stock_since is distinct from old.stock_since then
      raise exception 'stock can only change through counts, sales and purchases' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists ingredients_stock_guard on public.ingredients;
create trigger ingredients_stock_guard before insert or update on public.ingredients
  for each row execute function app.ingredients_stock_guard();

-- a dish switched on or off by hand is no longer "sold out by stock"
create or replace function app.menu_items_stock_flag()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client() then
    if tg_op = 'INSERT' then new.sold_out_by_stock := false;
    elsif new.available is distinct from old.available then new.sold_out_by_stock := false;
    else new.sold_out_by_stock := old.sold_out_by_stock;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists menu_items_stock_flag on public.menu_items;
create trigger menu_items_stock_flag before insert or update on public.menu_items
  for each row execute function app.menu_items_stock_flag();

-- ------------------------------------------------------------ the engine
-- what one portion of a dish needs per ingredient (lines for every size only)
create or replace view app.dish_needs as
  select rl.restaurant_id, rl.menu_item_id, rl.ingredient_id,
         sum(rl.qty / (1 - g.waste_bp / 10000.0)) need
    from public.recipe_lines rl
    join public.ingredients g on g.restaurant_id = rl.restaurant_id and g.id = rl.ingredient_id
   where rl.menu_item_id is not null and rl.variant_id is null
   group by 1, 2, 3;
revoke all on app.dish_needs from public, anon, authenticated;

-- hide or bring back the dishes of one ingredient when its stock crosses one portion
create or replace function app.stock_availability(p_restaurant_id uuid, p_ingredient_id uuid, p_old numeric, p_new numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare d record;
begin
  if not coalesce((select (profit_settings ->> 'auto_sold_out')::boolean from public.restaurants where id = p_restaurant_id), false) then
    return;
  end if;
  for d in select n.menu_item_id, n.need from app.dish_needs n
            where n.restaurant_id = p_restaurant_id and n.ingredient_id = p_ingredient_id and n.need > 0 loop
    if coalesce(p_old, 'infinity'::numeric) >= d.need and p_new < d.need then
      update public.menu_items set available = false, sold_out_by_stock = true
       where restaurant_id = p_restaurant_id and id = d.menu_item_id and available;
    elsif p_old is not null and p_old < d.need and p_new >= d.need then
      update public.menu_items set available = true, sold_out_by_stock = false
       where restaurant_id = p_restaurant_id and id = d.menu_item_id and sold_out_by_stock
         and not exists (select 1 from app.dish_needs o
                           join public.ingredients g on g.restaurant_id = o.restaurant_id and g.id = o.ingredient_id
                          where o.restaurant_id = p_restaurant_id and o.menu_item_id = d.menu_item_id
                            and g.stock_qty is not null and g.stock_qty < o.need);
    end if;
  end loop;
end $$;

-- one movement of a tracked ingredient (untracked ones are skipped)
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
                                  order_id, document_id, doc_number, purchase_id, menu_item_id, note, staff_id)
  values (p_restaurant_id, p_ingredient_id, p_kind, p_qty, new_q, p_date, coalesce((p_refs ->> 'after_count')::boolean, false),
          app.try_uuid(p_refs ->> 'order_id'), app.try_uuid(p_refs ->> 'document_id'), p_refs ->> 'doc_number',
          app.try_uuid(p_refs ->> 'purchase_id'), app.try_uuid(p_refs ->> 'menu_item_id'),
          nullif(left(btrim(coalesce(p_note, '')), 200), ''), p_staff_id);
  perform app.stock_availability(p_restaurant_id, p_ingredient_id, old_q, new_q);
  return new_q;
end $$;

-- what an order (as billed) uses, per ingredient: dishes, sizes and options
create or replace function app.order_usage(p_restaurant_id uuid, p_order_id uuid)
returns table (ingredient_id uuid, qty numeric) language sql stable security definer set search_path = '' as $$
  with l as (
    select menu_item_id, variant_id, quantity, modifiers from public.order_lines
     where restaurant_id = p_restaurant_id and order_id = p_order_id and menu_item_id is not null),
  u as (
    select rl.ingredient_id, l.quantity * rl.qty q
      from l join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.menu_item_id = l.menu_item_id
                                         and (rl.variant_id is null or rl.variant_id = l.variant_id)
    union all
    select rl.ingredient_id, l.quantity * rl.qty
      from l cross join lateral jsonb_array_elements(l.modifiers) m
      join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.modifier_option_id = app.try_uuid(m ->> 'id'))
  select u.ingredient_id, sum(u.q / (1 - g.waste_bp / 10000.0))
    from u join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = u.ingredient_id
   group by u.ingredient_id
$$;

-- a ticket takes it out, a credit note puts it back
create or replace function app.fiscal_documents_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare u record; sgn int;
begin
  if new.order_id is null then return null; end if;
  sgn := case when new.doc_type = 'credit_note' then 1 else -1 end;
  for u in select * from app.order_usage(new.restaurant_id, new.order_id) loop
    perform app.stock_apply(new.restaurant_id, u.ingredient_id, case when sgn > 0 then 'refund' else 'sale' end, sgn * u.qty,
                            new.business_date, jsonb_build_object('order_id', new.order_id, 'document_id', new.id, 'doc_number', new.doc_number),
                            null, new.staff_id);
  end loop;
  return null;
end $$;
drop trigger if exists fiscal_documents_stock on public.fiscal_documents;
create trigger fiscal_documents_stock after insert on public.fiscal_documents
  for each row execute function app.fiscal_documents_stock();

-- purchases: in when received after the count the stock starts from; undone when deleted or changed
create or replace function app.stock_purchases_live()
returns trigger language plpgsql security definer set search_path = '' as $$
declare done numeric; g public.ingredients;
begin
  if app.purging() then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select coalesce(sum(qty), 0) into done from public.stock_moves where purchase_id = old.id;
    if done <> 0 and exists (select 1 from public.ingredients where restaurant_id = old.restaurant_id and id = old.ingredient_id) then
      perform app.stock_apply(old.restaurant_id, old.ingredient_id, 'purchase', -done, old.purchased_on,
                              jsonb_build_object('purchase_id', old.id, 'after_count', old.after_count), 'Achat modifié ou supprimé', null);
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select * into g from public.ingredients where restaurant_id = new.restaurant_id and id = new.ingredient_id;
    if g.stock_qty is not null and g.stock_since is not null
       and (new.purchased_on > g.stock_since or (new.purchased_on = g.stock_since and new.after_count)) then
      perform app.stock_apply(new.restaurant_id, new.ingredient_id, 'purchase', new.qty, new.purchased_on,
                              jsonb_build_object('purchase_id', new.id, 'after_count', new.after_count), new.supplier, null);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists stock_purchases_live on public.stock_purchases;
create trigger stock_purchases_live after insert or update or delete on public.stock_purchases
  for each row execute function app.stock_purchases_live();

-- set the level of one ingredient (a count or a manager), starting tracking if needed
create or replace function app.stock_reset(
  p_restaurant_id uuid, p_ingredient_id uuid, p_qty numeric, p_since date, p_kind text, p_count_id uuid, p_note text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare old_q numeric; target numeric; after_q numeric;
begin
  select stock_qty into old_q from public.ingredients where restaurant_id = p_restaurant_id and id = p_ingredient_id for update;
  -- what already moved after that day (sales, purchases, losses since)
  select coalesce(sum(qty), 0) into after_q from public.stock_moves
   where restaurant_id = p_restaurant_id and ingredient_id = p_ingredient_id and kind not in ('count', 'adjust')
     and (business_date > p_since or (business_date = p_since and after_count));
  target := p_qty + case when old_q is null then 0 else after_q end;
  update public.ingredients set stock_qty = target, stock_since = p_since, stock_updated_at = now()
   where restaurant_id = p_restaurant_id and id = p_ingredient_id;
  insert into public.stock_moves (restaurant_id, ingredient_id, kind, qty, stock_after, business_date, count_id, note)
  values (p_restaurant_id, p_ingredient_id, p_kind, target - coalesce(old_q, 0), target, p_since, p_count_id,
          nullif(left(btrim(coalesce(p_note, '')), 200), ''));
  perform app.stock_availability(p_restaurant_id, p_ingredient_id, old_q, target);
  return target;
end $$;

-- a closed count is the new starting point (an older count than the current one changes nothing)
create or replace function app.stock_counts_live()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l record;
begin
  if not (old.status = 'open' and new.status = 'closed') then return null; end if;
  for l in select cl.ingredient_id, cl.qty, g.stock_since from public.stock_count_lines cl
             join public.ingredients g on g.restaurant_id = cl.restaurant_id and g.id = cl.ingredient_id
            where cl.restaurant_id = new.restaurant_id and cl.count_id = new.id loop
    if l.stock_since is null or new.counted_on >= l.stock_since then
      perform app.stock_reset(new.restaurant_id, l.ingredient_id, l.qty, new.counted_on, 'count', new.id, null);
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists stock_counts_live on public.stock_counts;
create trigger stock_counts_live after update on public.stock_counts
  for each row execute function app.stock_counts_live();

-- ------------------------------------------------------------ actions
-- Manager: "this is what I have now" (also the quick way to start live stock).
create or replace function public.stock_set(p_ingredient_id uuid, p_qty numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants; q numeric;
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if p_qty is null or p_qty < 0 or p_qty >= 1000000000 then perform app.fail('invalid_request', 'qty'); end if;
  if g.stock_qty is null then
    -- start: this is the stock now, so every move from today on counts (the day before is the starting point)
    update public.ingredients set stock_qty = p_qty, stock_since = app.business_date(r) - 1, stock_updated_at = now() where id = g.id;
    insert into public.stock_moves (restaurant_id, ingredient_id, kind, qty, stock_after, business_date, note)
    values (r.id, g.id, 'adjust', p_qty, p_qty, app.business_date(r), coalesce(nullif(left(btrim(coalesce(p_note, '')), 200), ''), 'Début du stock en direct'));
    perform app.stock_availability(r.id, g.id, null, p_qty);
  else
    perform app.stock_apply(r.id, g.id, 'adjust', p_qty - g.stock_qty, app.business_date(r), '{}'::jsonb, coalesce(p_note, 'Stock réel saisi'), null);
  end if;
  return jsonb_build_object('ok', true, 'stock_qty', (select stock_qty from public.ingredients where id = g.id));
end $$;

-- Manager: a loss of one ingredient (in its base unit).
create or replace function public.stock_waste(p_ingredient_id uuid, p_qty numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.ingredients; r public.restaurants;
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(g.restaurant_id, 'manager', true);
  if p_qty is null or p_qty <= 0 or p_qty >= 1000000000 then perform app.fail('invalid_request', 'qty'); end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform app.fail('reason_required'); end if;
  if g.stock_qty is null then perform app.fail('stock_not_tracked'); end if;
  perform app.stock_apply(r.id, g.id, 'waste', -p_qty, app.business_date(r), '{}'::jsonb, p_reason, null);
  return jsonb_build_object('ok', true, 'stock_qty', (select stock_qty from public.ingredients where id = g.id));
end $$;

-- Till: a dish that went to waste (dropped, burnt, sent back), with who and why.
create or replace function public.pos_stock_waste(
  p_restaurant_id uuid, p_menu_item_id uuid, p_variant_id uuid, p_qty integer, p_reason text, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; it public.menu_items; u record; n int := 0; val numeric := 0; dt date;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  select * into it from public.menu_items where restaurant_id = r.id and id = p_menu_item_id;
  if it.id is null then perform app.fail('not_found'); end if;
  if p_qty is null or p_qty not between 1 and 100 then perform app.fail('invalid_request', 'qty'); end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then perform app.fail('reason_required'); end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where restaurant_id = r.id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  dt := app.business_date(r);
  for u in
    select rl.ingredient_id, sum(p_qty * rl.qty / (1 - g.waste_bp / 10000.0)) q,
           max(case when g.purchase_price_cents is not null then g.purchase_price_cents / g.purchase_qty end) unit
      from public.recipe_lines rl join public.ingredients g on g.restaurant_id = rl.restaurant_id and g.id = rl.ingredient_id
     where rl.restaurant_id = r.id and rl.menu_item_id = it.id and (rl.variant_id is null or rl.variant_id = p_variant_id)
     group by 1 loop
    val := val + coalesce(u.q * u.unit, 0);
    if app.stock_apply(r.id, u.ingredient_id, 'waste', -u.q, dt, jsonb_build_object('menu_item_id', it.id),
                       format('%s x %s : %s', p_qty, app.i18n_first(it.name, array['fr', 'ar', 'en']), btrim(p_reason)), p_staff_id) is not null then
      n := n + 1;
    end if;
  end loop;
  if n = 0 then perform app.fail('no_recipe'); end if;
  return jsonb_build_object('ok', true, 'ingredients', n, 'cost_cents', round(val)::bigint);
end $$;

-- Till: dishes with few portions left, and the ones sold out by stock (the till greys them out at once).
create or replace function public.pos_stock_levels(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  return jsonb_build_object(
    'low', (select coalesce(jsonb_object_agg(menu_item_id::text, portions), '{}'::jsonb) from (
              select n.menu_item_id, floor(min(greatest(g.stock_qty, 0) / n.need))::int portions
                from app.dish_needs n join public.ingredients g on g.restaurant_id = n.restaurant_id and g.id = n.ingredient_id
               where n.restaurant_id = r.id and n.need > 0 and g.stock_qty is not null
               group by n.menu_item_id) x where portions <= 10),
    'sold_out', (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.menu_items
                  where restaurant_id = r.id and active and not available));
end $$;

-- Manager: the live picture, per tracked ingredient.
create or replace function public.stock_live(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; dt date;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  dt := app.business_date(r);
  return jsonb_build_object(
    'today', dt,
    'auto_sold_out', coalesce((r.profit_settings ->> 'auto_sold_out')::boolean, false),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'ingredient_id', g.id, 'name', g.name, 'name_ar', g.name_ar, 'category', g.category, 'base_unit', g.base_unit,
        'purchase_unit', g.purchase_unit, 'purchase_qty', g.purchase_qty, 'purchase_price_cents', g.purchase_price_cents,
        'stock_qty', g.stock_qty, 'stock_min', g.stock_min, 'stock_since', g.stock_since, 'updated_at', g.stock_updated_at,
        'value_cents', case when g.purchase_price_cents is not null and g.stock_qty > 0 then round(g.stock_qty * g.purchase_price_cents / g.purchase_qty)::bigint end,
        'sold_today', (select coalesce(-sum(m.qty), 0) from public.stock_moves m where m.restaurant_id = r.id and m.ingredient_id = g.id and m.business_date = dt and m.kind in ('sale', 'refund')),
        'waste_today', (select coalesce(-sum(m.qty), 0) from public.stock_moves m where m.restaurant_id = r.id and m.ingredient_id = g.id and m.business_date = dt and m.kind = 'waste'),
        'status', case when g.stock_qty <= 0 then 'out' when g.stock_min is not null and g.stock_qty <= g.stock_min then 'low' else 'ok' end,
        'dishes', (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'name', mi.name, 'available', mi.available, 'sold_out_by_stock', mi.sold_out_by_stock,
                                                                'portions', floor(greatest(g.stock_qty, 0) / n.need)::int) order by mi.sort_order), '[]'::jsonb)
                     from app.dish_needs n join public.menu_items mi on mi.restaurant_id = n.restaurant_id and mi.id = n.menu_item_id
                    where n.restaurant_id = r.id and n.ingredient_id = g.id and n.need > 0 and mi.active)
      ) order by case when g.stock_qty <= 0 then 0 when g.stock_min is not null and g.stock_qty <= g.stock_min then 1 else 2 end, g.name), '[]'::jsonb)
      from public.ingredients g where g.restaurant_id = r.id and g.active and g.stock_qty is not null),
    'untracked', (select count(*) from public.ingredients g where g.restaurant_id = r.id and g.active and g.stock_qty is null),
    'waste_today_cents', (select coalesce(round(sum(-m.qty * g.purchase_price_cents / g.purchase_qty)), 0)::bigint
                            from public.stock_moves m join public.ingredients g on g.id = m.ingredient_id
                           where m.restaurant_id = r.id and m.business_date = dt and m.kind = 'waste' and g.purchase_price_cents is not null),
    'value_cents', (select coalesce(round(sum(g.stock_qty * g.purchase_price_cents / g.purchase_qty)), 0)::bigint
                      from public.ingredients g where g.restaurant_id = r.id and g.active and g.stock_qty > 0 and g.purchase_price_cents is not null));
end $$;

revoke all on function public.stock_set(uuid, numeric, text) from public, anon;
revoke all on function public.stock_waste(uuid, numeric, text) from public, anon;
revoke all on function public.pos_stock_waste(uuid, uuid, uuid, integer, text, uuid) from public, anon;
revoke all on function public.pos_stock_levels(uuid) from public, anon;
revoke all on function public.stock_live(uuid) from public, anon;
grant execute on function public.stock_set(uuid, numeric, text) to authenticated;
grant execute on function public.stock_waste(uuid, numeric, text) to authenticated;
grant execute on function public.pos_stock_waste(uuid, uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.pos_stock_levels(uuid) to authenticated;
grant execute on function public.stock_live(uuid) to authenticated;
revoke all on function app.stock_apply(uuid, uuid, text, numeric, date, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function app.stock_reset(uuid, uuid, numeric, date, text, uuid, text) from public, anon, authenticated;
revoke all on function app.stock_availability(uuid, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function app.order_usage(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ the forecast uses the live stock
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
    select od.business_date d, l.menu_item_id, l.variant_id, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where uses_pos and l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled'
       and l.menu_item_id is not null and od.business_date > today - 400 and od.business_date <= today
     group by 1, 2, 3),
  use_by_day as (
    select s.d, rl.ingredient_id, sum(s.qty * rl.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
      join public.ingredients g on g.restaurant_id = r.id and g.id = rl.ingredient_id
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
    select g.id, g.stock_qty, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty, g.purchase_price_cents, g.supplier,
           lc.counted_on, lc.qty counted,
           (select coalesce(sum(p.qty), 0) from public.stock_purchases p
             where p.restaurant_id = r.id and p.ingredient_id = g.id and lc.counted_on is not null
               and (p.purchased_on > lc.counted_on or (p.purchased_on = lc.counted_on and p.after_count))) bought_since,
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
           case when daily > 0 then greatest(0, daily * order_days - greatest(coalesce(raw_estimate, 0), 0)) end to_buy
      from est)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', id, 'name', name, 'name_ar', name_ar, 'category', category, 'base_unit', base_unit,
      'purchase_unit', purchase_unit, 'purchase_qty', purchase_qty, 'purchase_price_cents', purchase_price_cents, 'supplier', supplier,
      'counted_on', counted_on, 'counted', counted, 'bought_since', bought_since,
      'estimate', round(estimate, 3), 'live', stock_qty is not null, 'below_zero', coalesce(raw_estimate < 0, false),
      'daily', round(daily, 3), 'daily_source', daily_source,
      'days_left', round(days_left, 1),
      'to_buy', round(to_buy, 3),
      'to_buy_cents', case when to_buy > 0 and purchase_price_cents is not null then round(to_buy * purchase_price_cents / purchase_qty)::bigint end,
      'status', case when counted is null and stock_qty is null then 'not_counted'
                     when daily is null or daily = 0 then 'no_use'
                     when days_left < 2 then 'urgent'
                     when days_left < order_days then 'order'
                     else 'ok' end
    ) order by (counted is null), days_left nulls last, name), '[]'::jsonb)
    into items
    from fin;

  return jsonb_build_object('today', today, 'uses_pos', uses_pos, 'order_days', order_days, 'sales_days', sales_days, 'items', items);
end $$;
revoke all on function public.stock_forecast(uuid) from public, anon;
grant execute on function public.stock_forecast(uuid) to authenticated;


-- Realtime: the back office follows the stock while the till sells.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'ingredients') then
    alter publication supabase_realtime add table public.ingredients;
  end if;
end $$;
