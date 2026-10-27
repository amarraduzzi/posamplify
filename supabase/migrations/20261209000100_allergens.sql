-- =============================================================================
-- ALLERGENS: per ingredient, passed on through preparations and recipes to every product
--
-- * ingredients.allergens: the allergens an ingredient contains. NULL = not filled in yet (unknown);
--   an empty list = checked, none. ingredients.may_contain: traces ("peut contenir").
-- * Nothing is stored per product: the allergens of a product are CALCULATED from its recipe, through
--   every preparation (a preparation inside a preparation, up to 6 levels), so changing one ingredient
--   changes every product that uses it. There is no copy that can get out of date.
-- * menu_items.allergens_add / allergens_remove: the owner's manual correction of the result
--   (a supplier change, a product without recipe). menu_items.allergens_confirmed: "I checked this
--   product by hand" (for items without a recipe: a bottled drink, a bought-in biscuit).
-- * A product is "complete" only when every raw ingredient of its recipe has been filled in (or the owner
--   confirmed it by hand). The guest menu NEVER shows "no allergens" for a product that is not complete.
-- * restaurants.show_allergens: the owner decides when the guest menu starts showing them (default off).
-- Codes: the 14 allergens of the EU list + almonds apart (very common in Moroccan pâtisserie; 'nuts' = the
-- other tree nuts: walnut, hazelnut, pistachio, cashew...).
-- =============================================================================

create or replace function app.allergen_codes()
returns text[] language sql immutable set search_path = '' as $$
  select array['gluten', 'eggs', 'milk', 'almonds', 'nuts', 'peanuts', 'sesame', 'soy', 'fish',
               'crustaceans', 'molluscs', 'sulphites', 'celery', 'mustard', 'lupin']::text[]
$$;

alter table public.ingredients
  add column if not exists allergens   text[] check (allergens is null or allergens <@ app.allergen_codes()),
  add column if not exists may_contain text[] not null default '{}' check (may_contain <@ app.allergen_codes());

alter table public.menu_items
  add column if not exists allergens_add       text[]  not null default '{}' check (allergens_add <@ app.allergen_codes()),
  add column if not exists allergens_remove    text[]  not null default '{}' check (allergens_remove <@ app.allergen_codes()),
  add column if not exists allergens_confirmed boolean not null default false;

alter table public.restaurants add column if not exists show_allergens boolean not null default false;
grant update (show_allergens) on public.restaurants to authenticated;

-- ------------------------------------------------------------ helpers
create or replace function app.array_union(a text[], b text[])
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct x order by x), '{}'::text[]) from unnest(coalesce(a, '{}'::text[]) || coalesce(b, '{}'::text[])) x
$$;

create or replace function app.array_minus(a text[], b text[])
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x order by x), '{}'::text[]) from unnest(coalesce(a, '{}'::text[])) x where not (x = any (coalesce(b, '{}'::text[])))
$$;

-- ------------------------------------------------------------ one ingredient (or preparation), everything inside it
-- complete = every raw ingredient inside has been filled in (a preparation itself needs no own entry).
create or replace function app.ingredient_allergens(p_restaurant_id uuid, p_ingredient_id uuid)
returns table (allergens text[], may_contain text[], complete boolean)
language sql stable set search_path = '' as $$
  with nodes as (
    select g.allergens, g.may_contain, g.is_preparation
      from app.prep_tree(p_restaurant_id, p_ingredient_id, 1, false) t
      join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = t.ingredient_id
  )
  select coalesce((select array_agg(distinct x order by x) from nodes n, unnest(coalesce(n.allergens, '{}'::text[])) x), '{}'::text[]),
         coalesce((select array_agg(distinct x order by x) from nodes n, unnest(n.may_contain) x), '{}'::text[]),
         not exists (select 1 from nodes n where not n.is_preparation and n.allergens is null)
$$;

-- ------------------------------------------------------------ one product
-- state: 'complete' (shown to guests) or 'incomplete' (something is not filled in: never shown as "none")
create or replace function app.item_allergens(p_restaurant_id uuid, p_item_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  it public.menu_items;
  calc text[] := '{}'; tr text[] := '{}'; ok boolean := true; has_recipe boolean := false;
  rec record; fin text[]; ids uuid[];
begin
  select * into it from public.menu_items where restaurant_id = p_restaurant_id and id = p_item_id;
  if not found then return null; end if;
  select array_agg(distinct rl.ingredient_id) into ids from public.recipe_lines rl
   where rl.restaurant_id = p_restaurant_id and rl.menu_item_id = p_item_id;
  if ids is not null then
    has_recipe := true;
    for rec in select x.* from unnest(ids) i cross join lateral app.ingredient_allergens(p_restaurant_id, i) x loop
      calc := app.array_union(calc, rec.allergens);
      tr := app.array_union(tr, rec.may_contain);
      ok := ok and rec.complete;
    end loop;
  end if;
  fin := app.array_minus(app.array_union(calc, it.allergens_add), it.allergens_remove);
  return jsonb_build_object(
    'item_id', it.id,
    'allergens', to_jsonb(fin),
    'may_contain', to_jsonb(app.array_minus(app.array_minus(tr, fin), it.allergens_remove)),
    'has_recipe', has_recipe,
    'state', case when it.allergens_confirmed or (has_recipe and ok) then 'complete' else 'incomplete' end,
    'confirmed', it.allergens_confirmed,
    'calculated', to_jsonb(calc),
    'add', to_jsonb(it.allergens_add),
    'remove', to_jsonb(it.allergens_remove));
end $$;

-- ------------------------------------------------------------ for the back office (managers)
-- items: every product with its result; preparations: the same for every preparation;
-- missing: the raw ingredients not filled in yet (what to do first).
create or replace function public.allergen_overview(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'show_allergens', r.show_allergens,
    'items', coalesce((select jsonb_agg(app.item_allergens(r.id, m.id) order by m.sort_order, m.created_at)
                         from public.menu_items m where m.restaurant_id = r.id and m.active), '[]'::jsonb),
    'preparations', coalesce((select jsonb_agg(jsonb_build_object('ingredient_id', g.id, 'allergens', to_jsonb(x.allergens),
                                       'may_contain', to_jsonb(x.may_contain), 'complete', x.complete) order by g.name)
                         from public.ingredients g cross join lateral app.ingredient_allergens(r.id, g.id) x
                        where g.restaurant_id = r.id and g.is_preparation and g.active), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(g.id order by g.name) from public.ingredients g
                          where g.restaurant_id = r.id and g.active and not g.is_preparation and g.allergens is null), '[]'::jsonb));
end $$;
revoke all on function public.allergen_overview(uuid) from public, anon;
grant execute on function public.allergen_overview(uuid) to authenticated;

-- ------------------------------------------------------------ for the guest menu
-- Only while the owner switched it on. Per product: ok = complete. A product that is not ok shows nothing
-- (the app tells the guest to ask the staff). Names of ingredients never leave the database.
create or replace function public.get_menu_allergens(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if not found or not r.show_allergens then return null; end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_object_agg(m.id::text, jsonb_build_object('ok', (a->>'state') = 'complete', 'a', a->'allergens', 'm', a->'may_contain'))
      from public.menu_items m cross join lateral app.item_allergens(r.id, m.id) a
     where m.restaurant_id = r.id and m.active), '{}'::jsonb));
end $$;
revoke all on function public.get_menu_allergens(text) from public;
grant execute on function public.get_menu_allergens(text) to anon, authenticated;
