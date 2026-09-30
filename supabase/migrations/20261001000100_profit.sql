-- =============================================================================
-- 0014 AMPLIFY PROFIT (phase 1): ingredients, recipe cards, dish margins
-- =============================================================================
-- A second product on the same platform. A restaurant can have Amplify POS,
-- Amplify Profit, or both (restaurants.products). The dishes are the same
-- menu_items: a Profit-only customer imports his menu (photo/Excel) and never
-- uses the till or the QR menu. With POS too, real sales feed the margins.
--
-- Money in centimes, quantities in the ingredient's base unit (g, ml or pc).
-- Cost and margin are computed here, exactly, never in the browser.
-- Cost data is sensitive: managers and owners only (tills never see it).
-- =============================================================================

-- ------------------------------------------------------------ products / settings
alter table public.restaurants
  add column products text[] not null default '{pos,profit}'
    check (products <@ array['pos', 'profit']::text[] and cardinality(products) between 1 and 2),
  -- {"target_food_cost_bp": 3000}  (30.00 %: the food cost the owner aims for)
  add column profit_settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profit_settings) = 'object');
-- owners set their target; products are set at sign-up / by the platform (billing)
grant update (profit_settings) on public.restaurants to authenticated;

-- ------------------------------------------------------------ ingredients
create table public.ingredients (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,
  name                 text not null check (length(btrim(name)) between 1 and 80),
  name_ar              text check (length(name_ar) <= 80),
  category             text not null default 'autre' check (category in
                         ('legumes', 'fruits', 'viande', 'poisson', 'laitier', 'epicerie',
                          'boissons', 'boulangerie', 'emballage', 'autre')),
  -- unit used in recipes: grams, millilitres or pieces
  base_unit            text not null check (base_unit in ('g', 'ml', 'pc')),
  -- how it is bought: label ("kg", "caisse", "botte") and how many base units that is
  purchase_unit        text not null default 'kg' check (length(btrim(purchase_unit)) between 1 and 20),
  purchase_qty         numeric(14, 3) not null check (purchase_qty > 0 and purchase_qty < 100000000),
  purchase_price_cents bigint check (purchase_price_cents between 0 and 100000000), -- null = not known yet
  -- part that is lost (peeling, bones, trimming): 1500 = 15 %
  waste_bp             integer not null default 0 check (waste_bp between 0 and 9000),
  -- price estimated by the AI: shown as "prix estimé" until the owner or an invoice sets it
  price_estimated      boolean not null default false,
  supplier             text check (length(supplier) <= 80),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (restaurant_id, id)
);
create unique index ingredients_name_idx on public.ingredients (restaurant_id, lower(btrim(name)));
create trigger ingredients_touch before update on public.ingredients
  for each row execute function app.touch_updated_at();
create trigger ingredients_same_tenant before update on public.ingredients
  for each row execute function app.forbid_restaurant_change();

-- price history (for price alerts and "what did tomatoes cost in June")
create table public.ingredient_prices (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,
  ingredient_id        uuid not null,
  purchase_price_cents bigint not null,
  purchase_qty         numeric(14, 3) not null,
  source               text not null default 'manual' check (source in ('manual', 'invoice', 'import', 'ai')),
  recorded_by          uuid default auth.uid(),
  recorded_at          timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create index ingredient_prices_idx on public.ingredient_prices (restaurant_id, ingredient_id, recorded_at desc);

create or replace function app.ingredient_price_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.purchase_price_cents is not null and (tg_op = 'INSERT'
     or new.purchase_price_cents is distinct from old.purchase_price_cents
     or new.purchase_qty is distinct from old.purchase_qty) then
    insert into public.ingredient_prices (restaurant_id, ingredient_id, purchase_price_cents, purchase_qty, source)
    values (new.restaurant_id, new.id, new.purchase_price_cents, new.purchase_qty,
            coalesce(nullif(current_setting('app.price_source', true), ''), 'manual'));
  end if;
  return null;
end $$;
create trigger ingredients_price_history after insert or update on public.ingredients
  for each row execute function app.ingredient_price_history();

-- a price typed by the owner (or read from an invoice) is no longer an estimate
create or replace function app.ingredient_price_confirmed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.purchase_price_cents is distinct from old.purchase_price_cents
     and coalesce(current_setting('app.price_source', true), '') <> 'ai' then
    new.price_estimated := false;
  end if;
  return new;
end $$;
create trigger ingredients_price_confirmed before update on public.ingredients
  for each row execute function app.ingredient_price_confirmed();

-- ------------------------------------------------------------ recipe cards
-- Lines without variant apply to every size; lines with a variant only to it
-- (Thé: base = tea + mint + sugar; "Théière" adds more of each).
create table public.recipe_lines (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_item_id  uuid not null,
  variant_id    uuid,
  ingredient_id uuid not null,
  qty           numeric(14, 3) not null check (qty > 0 and qty < 1000000),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, menu_item_id) references public.menu_items (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, variant_id) references public.item_variants (restaurant_id, id) on delete cascade,
  -- an ingredient used in a recipe cannot be deleted by accident (hide it instead)
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete no action
);
create index recipe_lines_item_idx on public.recipe_lines (restaurant_id, menu_item_id, sort_order);
create index recipe_lines_ingredient_idx on public.recipe_lines (restaurant_id, ingredient_id);
create trigger recipe_lines_same_tenant before update on public.recipe_lines
  for each row execute function app.forbid_restaurant_change();

-- ------------------------------------------------------------ security
alter table public.ingredients       enable row level security;
alter table public.ingredient_prices enable row level security;
alter table public.recipe_lines      enable row level security;
grant select, insert, update, delete on public.ingredients  to authenticated;
grant select, insert, update, delete on public.recipe_lines to authenticated;
grant select                         on public.ingredient_prices to authenticated;

do $$
declare t text;
begin
  foreach t in array array['ingredients', 'recipe_lines'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
    $f$, t);
  end loop;
end $$;
create policy ingredient_prices_select on public.ingredient_prices for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

create trigger audit_ingredients after insert or update or delete on public.ingredients
  for each row execute function app.audit();
create trigger audit_recipe_lines after insert or update or delete on public.recipe_lines
  for each row execute function app.audit();

-- ------------------------------------------------------------ margins per dish
-- One row per dish (and per size when the dish has sizes):
-- price, price excl. VAT, cost of the recipe, food cost %, margin, and when the
-- restaurant uses Amplify POS: quantity sold and profit over the last p_days.
create or replace function public.profit_dishes(p_restaurant_id uuid, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r      public.restaurants;
  target integer;
  since  date;
  rows_  jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  target := coalesce((r.profit_settings ->> 'target_food_cost_bp')::int, 3000);
  since := app.business_date(r) - greatest(1, least(coalesce(p_days, 30), 366));

  with dish as (
    -- dishes without sizes, and every active size of dishes with sizes
    select i.id item_id, null::uuid variant_id, i.name, null::jsonb variant_name, i.category_id,
           i.price_cents, coalesce(i.vat_bp, r.default_vat_bp) vat_bp, i.sort_order, i.image_url
      from public.menu_items i
     where i.restaurant_id = r.id and i.active
       and not exists (select 1 from public.item_variants v where v.restaurant_id = r.id and v.menu_item_id = i.id and v.active)
    union all
    select i.id, v.id, i.name, v.name, i.category_id,
           v.price_cents, coalesce(i.vat_bp, r.default_vat_bp), i.sort_order * 1000 + v.sort_order, i.image_url
      from public.menu_items i
      join public.item_variants v on v.restaurant_id = r.id and v.menu_item_id = i.id and v.active
     where i.restaurant_id = r.id and i.active
  ),
  cost as (
    select d.item_id, d.variant_id,
           count(l.id) n_lines,
           count(l.id) filter (where g.purchase_price_cents is null) n_unpriced,
           count(l.id) filter (where g.price_estimated) n_estimated,
           sum(l.qty * g.purchase_price_cents / (g.purchase_qty * (1 - g.waste_bp / 10000.0))) cost
      from dish d
      join public.recipe_lines l on l.restaurant_id = r.id and l.menu_item_id = d.item_id
                                 and (l.variant_id is null or l.variant_id = d.variant_id)
      join public.ingredients g on g.restaurant_id = r.id and g.id = l.ingredient_id
     group by d.item_id, d.variant_id
  ),
  sold as (
    select l.menu_item_id item_id, l.variant_id, sum(l.quantity) qty
      from public.order_lines l
      join public.orders o on o.restaurant_id = l.restaurant_id and o.id = l.order_id
     where l.restaurant_id = r.id and o.closed_at is not null and o.status <> 'cancelled'
       and o.business_date > since and l.menu_item_id is not null
     group by 1, 2
  ),
  calc as (
    select d.*, c.name cat_name, c.sort_order cat_sort,
           round(d.price_cents * 10000.0 / (10000 + d.vat_bp))::bigint price_ht,
           coalesce(k.n_lines, 0) n_lines, coalesce(k.n_unpriced, 0) n_unpriced, coalesce(k.n_estimated, 0) n_estimated,
           case when k.n_lines > 0 then round(coalesce(k.cost, 0))::bigint end cost_cents,
           coalesce(s.qty, 0) sold_qty
      from dish d
      join public.categories c on c.restaurant_id = r.id and c.id = d.category_id
      left join cost k on k.item_id = d.item_id and k.variant_id is not distinct from d.variant_id
      left join sold s on s.item_id = d.item_id and s.variant_id is not distinct from d.variant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_id', item_id, 'variant_id', variant_id, 'name', name, 'variant_name', variant_name,
           'category', cat_name, 'image_url', image_url,
           'price_cents', price_cents, 'vat_bp', vat_bp, 'price_ht_cents', price_ht,
           'lines', n_lines, 'unpriced', n_unpriced, 'estimated', n_estimated, 'cost_cents', cost_cents,
           'food_cost_bp', case when cost_cents is not null and price_ht > 0 then round(cost_cents * 10000.0 / price_ht)::int end,
           'margin_cents', case when cost_cents is not null then price_ht - cost_cents end,
           -- selling price (incl. VAT) that would hit the target food cost, rounded up to 1 DH
           'suggested_price_cents', case when cost_cents is not null and cost_cents > 0
             then (ceil(cost_cents * 10000.0 / target * (10000 + vat_bp) / 10000 / 100) * 100)::bigint end,
           'sold_qty', sold_qty,
           'profit_cents', case when cost_cents is not null then sold_qty * (price_ht - cost_cents) end
         ) order by cat_sort, sort_order), '[]'::jsonb)
    into rows_
    from calc;

  return jsonb_build_object(
    'target_food_cost_bp', target,
    'days', greatest(1, least(coalesce(p_days, 30), 366)),
    'uses_pos', 'pos' = any (r.products),
    'dishes', rows_);
end $$;

revoke all on function public.profit_dishes(uuid, integer) from public, anon;
grant execute on function public.profit_dishes(uuid, integer) to authenticated;

-- ------------------------------------------------------------ sign-up per product
-- The website sends ?produit=profit for "Amplify Profit only"; default: everything
-- (during the trial the owner can try both).
drop function if exists public.signup_restaurant(text, text, text);
create or replace function public.signup_restaurant(p_name text, p_slug text, p_city text default null,
                                                    p_products text[] default '{pos,profit}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); rid uuid; prods text[];
begin
  if uid is null or app.is_anonymous() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 3 then
    perform app.fail('too_many_restaurants');
  end if;
  if nullif(btrim(p_name), '') is null then perform app.fail('name_required'); end if;
  if not public.slug_available(p_slug) then perform app.fail('slug_taken'); end if;
  prods := coalesce((select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit')), '{pos,profit}');
  if cardinality(prods) = 0 then prods := '{pos,profit}'; end if;

  insert into public.restaurants (slug, name, city, status, trial_ends_at, timezone, languages,
                                  accept_dine_in, accept_takeaway, branding, products)
  values (lower(p_slug), left(btrim(p_name), 80), nullif(btrim(p_city), ''), 'trial', now() + interval '30 days',
          'UTC', '{fr,ar,en}', true, true, '{"primary_color":"#C2410C","theme":"light"}', prods)
  returning id into rid;
  insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  return rid;
end $$;
revoke all on function public.signup_restaurant(text, text, text, text[]) from public, anon;
grant execute on function public.signup_restaurant(text, text, text, text[]) to authenticated;

-- ------------------------------------------------------------ AI recipe suggestions
-- The owner checked the AI proposals; this saves them in one go:
--   * only dishes (or sizes) that have no recipe yet get lines (never overwrite work),
--   * ingredients are matched by name (case-insensitive) or created,
--   * AI prices are stored as estimates, and only where no price is known yet.
-- p_items: [{item_id, variant_id?, lines: [{name, name_ar?, category?, base_unit,
--            qty, purchase_unit?, purchase_qty?, price_cents?}]}]
create or replace function public.apply_recipe_suggestions(p_restaurant_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.restaurants;
  it       jsonb;
  ln       jsonb;
  item_id  uuid;
  var_id   uuid;
  g        public.ingredients;
  nm       text;
  bu       text;
  n_dishes int := 0;
  n_lines  int := 0;
  n_new    int := 0;
  sortn    int;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    raise exception 'invalid suggestions' using errcode = '22023';
  end if;
  perform set_config('app.price_source', 'ai', true);

  for it in select value from jsonb_array_elements(p_items) loop
    item_id := (it ->> 'item_id')::uuid;
    var_id := nullif(it ->> 'variant_id', '')::uuid;
    if not exists (select 1 from public.menu_items where restaurant_id = r.id and id = item_id) then
      raise exception 'unknown dish' using errcode = '22023';
    end if;
    if var_id is not null and not exists (select 1 from public.item_variants where restaurant_id = r.id and id = var_id and menu_item_id = item_id) then
      raise exception 'unknown size' using errcode = '22023';
    end if;
    -- this dish/size already has a recipe: keep the owner's work
    if exists (select 1 from public.recipe_lines l where l.restaurant_id = r.id and l.menu_item_id = item_id
                 and l.variant_id is not distinct from var_id) then
      continue;
    end if;
    n_dishes := n_dishes + 1;
    sortn := 0;

    for ln in select value from jsonb_array_elements(coalesce(it -> 'lines', '[]'::jsonb)) loop
      nm := left(btrim(coalesce(ln ->> 'name', '')), 80);
      bu := ln ->> 'base_unit';
      if nm = '' or bu not in ('g', 'ml', 'pc') or coalesce((ln ->> 'qty')::numeric, 0) <= 0 then continue; end if;

      select * into g from public.ingredients where restaurant_id = r.id and lower(btrim(name)) = lower(nm);
      if g.id is null then
        insert into public.ingredients (restaurant_id, name, name_ar, category, base_unit, purchase_unit, purchase_qty,
                                        purchase_price_cents, price_estimated)
        values (r.id, nm, nullif(left(btrim(coalesce(ln ->> 'name_ar', '')), 80), ''),
                case when ln ->> 'category' in ('legumes', 'fruits', 'viande', 'poisson', 'laitier', 'epicerie',
                                                 'boissons', 'boulangerie', 'emballage', 'autre') then ln ->> 'category' else 'autre' end,
                bu,
                coalesce(nullif(left(btrim(coalesce(ln ->> 'purchase_unit', '')), 20), ''), case bu when 'g' then 'kg' when 'ml' then 'litre' else 'pièce' end),
                coalesce(nullif((ln ->> 'purchase_qty')::numeric, 0), case bu when 'pc' then 1 else 1000 end),
                case when (ln ->> 'price_cents')::bigint between 1 and 100000000 then (ln ->> 'price_cents')::bigint end,
                (ln ->> 'price_cents')::bigint between 1 and 100000000)
        returning * into g;
        n_new := n_new + 1;
      elsif g.purchase_price_cents is null and (ln ->> 'price_cents')::bigint between 1 and 100000000 and g.base_unit = bu then
        update public.ingredients set purchase_price_cents = (ln ->> 'price_cents')::bigint,
               purchase_qty = coalesce(nullif((ln ->> 'purchase_qty')::numeric, 0), purchase_qty), price_estimated = true
         where id = g.id;
      end if;
      -- a unit mismatch with an existing ingredient (g vs pc): skip rather than guess
      if g.base_unit <> bu then continue; end if;

      sortn := sortn + 10;
      insert into public.recipe_lines (restaurant_id, menu_item_id, variant_id, ingredient_id, qty, sort_order)
      values (r.id, item_id, var_id, g.id, least((ln ->> 'qty')::numeric, 999999), sortn);
      n_lines := n_lines + 1;
    end loop;
  end loop;

  perform set_config('app.price_source', '', true);
  return jsonb_build_object('dishes', n_dishes, 'lines', n_lines, 'ingredients', n_new);
end $$;
revoke all on function public.apply_recipe_suggestions(uuid, jsonb) from public, anon;
grant execute on function public.apply_recipe_suggestions(uuid, jsonb) to authenticated;
