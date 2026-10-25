-- =============================================================================
-- Options: when every option of a group is ticked, write "Légumes : tout"
--
-- The line name used to end with every chosen option ("+ Tomate, Oignon, Salade, ..."), cut at 120
-- characters, on the till, the ticket and the bon. Now a group with at least 3 options that are ALL
-- ticked is written as "<group> : tout". Prices are untouched. The chosen options stay in
-- order_lines.modifiers (each now also carries group_name and all=true/false) so the kitchen bon can
-- group them too. Lines already saved keep their old name.
-- =============================================================================

create or replace function app.mods_summary(p_restaurant uuid, p_lang text, p_mods jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  m jsonb;
  gid uuid;
  gname text;
  n_all int;
  n_pick int;
  lst text;
  full_ boolean;
  word text := case p_lang when 'ar' then 'الكل' when 'en' then 'all' else 'tout' end;
  seen uuid[] := '{}';
  info jsonb := '{}'::jsonb;
  parts text[] := '{}';
  out_mods jsonb := '[]'::jsonb;
begin
  for m in select value from jsonb_array_elements(p_mods) loop
    gid := (m ->> 'group_id')::uuid;
    if gid = any (seen) then continue; end if;
    seen := seen || gid;
    select coalesce(g.name ->> p_lang, g.name ->> 'fr', (select value #>> '{}' from jsonb_each(g.name) limit 1))
      into gname
      from public.modifier_groups g where g.restaurant_id = p_restaurant and g.id = gid;
    select count(*) into n_all
      from public.modifier_options o where o.restaurant_id = p_restaurant and o.group_id = gid and o.active;
    select count(*), string_agg(x.value ->> 'name', ', ' order by x.ord)
      into n_pick, lst
      from jsonb_array_elements(p_mods) with ordinality x(value, ord)
     where (x.value ->> 'group_id')::uuid = gid;
    full_ := gname is not null and n_pick >= 3 and n_pick >= n_all;
    parts := parts || case when full_ then gname || ' : ' || word else lst end;
    info := info || jsonb_build_object(gid::text, jsonb_build_object('name', gname, 'all', full_));
  end loop;
  for m in select value from jsonb_array_elements(p_mods) loop
    out_mods := out_mods || (m || jsonb_build_object(
      'group_name', info -> (m ->> 'group_id') ->> 'name',
      'all', coalesce((info -> (m ->> 'group_id') ->> 'all')::boolean, false)));
  end loop;
  return jsonb_build_object('mods', out_mods, 'names', array_to_string(parts, ', '));
end $$;

-- ------------------------------------------------------------ the line price (same as before + the summary)
CREATE OR REPLACE FUNCTION app.order_lines_before_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  it public.menu_items;
  mods jsonb;
  add_price bigint;
  n_found int;
  n_asked int;
  names text;
  sm jsonb;
  g record;
  v  public.item_variants;
  c  public.categories;
  r  public.restaurants;
  lang text;
  hh record;
  otype text;
  osrc text;
  glovo boolean;
begin
  if tg_op = 'DELETE' then
    if app.purging() then
      return old;
    end if;
    if app.is_client() then
      perform app.assert_order_open(old.restaurant_id, old.order_id);
    else
      -- server functions and cascades: only block when the order still exists and is closed
      perform 1 from public.orders o
       where o.restaurant_id = old.restaurant_id and o.id = old.order_id and o.closed_at is not null;
      if found then
        raise exception 'order is closed' using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  perform app.assert_order_open(new.restaurant_id, new.order_id);

  if tg_op = 'UPDATE' then
    -- server functions (pos_merge_orders) may move a line to another open
    -- order of the same restaurant; clients never can
    if new.order_id <> old.order_id and app.is_client() then
      raise exception 'only quantity, note, station and kitchen status can change on a line'
        using errcode = '42501';
    end if;
    if new.order_id <> old.order_id then
      perform app.assert_order_open(old.restaurant_id, old.order_id);
    end if;
    if new.restaurant_id <> old.restaurant_id
       or new.menu_item_id is distinct from old.menu_item_id
       or new.variant_id is distinct from old.variant_id
       or new.unit_price_cents <> old.unit_price_cents
       or new.name <> old.name or new.vat_bp <> old.vat_bp
       or new.modifiers is distinct from old.modifiers
       or new.created_at <> old.created_at
       or new.weight_g is distinct from old.weight_g then
      raise exception 'only quantity, note, station and kitchen status can change on a line'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT
  -- a server function copying an existing line (splitting a bill) keeps its exact name and price
  if not app.is_client() and coalesce(current_setting('app.copy_line', true), '') = 'on' then
    return new;
  end if;
  select * into r from public.restaurants where id = new.restaurant_id;
  lang := r.languages[1];
  if new.menu_item_id is not null then
    select * into it from public.menu_items
     where restaurant_id = new.restaurant_id and id = new.menu_item_id;
    select * into c from public.categories
     where restaurant_id = new.restaurant_id and id = it.category_id;
    new.name := coalesce(it.name ->> lang, it.name ->> 'fr', (select value #>> '{}' from jsonb_each(it.name) limit 1), 'Article');
    select o.order_type, o.source into otype, osrc from public.orders o where o.restaurant_id = new.restaurant_id and o.id = new.order_id;
    glovo := osrc = 'glovo';
    new.unit_price_cents := case when glovo then app.glovo_price(it.price_cents, it.glovo_price_cents, r.glovo_markup_bp) else it.price_cents end;
    new.vat_bp := coalesce(it.vat_bp, r.default_vat_bp);
    new.station := coalesce(it.station, c.station, 'kitchen');
    if new.variant_id is not null then
      select * into v from public.item_variants
       where restaurant_id = new.restaurant_id and id = new.variant_id and menu_item_id = it.id;
      if v.id is null then
        raise exception 'variant does not belong to item' using errcode = '23503';
      end if;
      new.name := new.name || ' (' || coalesce(v.name ->> lang, v.name ->> 'fr', '') || ')';
      new.unit_price_cents := case when glovo then app.glovo_price(v.price_cents, v.glovo_price_cents, r.glovo_markup_bp) else v.price_cents end;
    end if;
    -- takeaway: the price of the dish (or its size) minus the takeaway reduction of the dish or its category
    if otype = 'takeaway' then
      new.unit_price_cents := greatest(0, new.unit_price_cents - app.takeaway_off(it, c));
    end if;
    -- extras and menu choices: only options of groups linked to this dish, priced here
    if jsonb_typeof(new.modifiers) <> 'array' then new.modifiers := '[]'::jsonb; end if;
    select count(distinct x ->> 'id') into n_asked from jsonb_array_elements(new.modifiers) x;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group_id', o.group_id,
                     'name', coalesce(o.name ->> lang, o.name ->> 'fr', (select value #>> '{}' from jsonb_each(o.name) limit 1)),
                     'price_cents', case when glovo then app.glovo_price(o.price_cents, o.glovo_price_cents, r.glovo_markup_bp) else o.price_cents end) order by ig.sort_order, gr.sort_order, o.sort_order, o.created_at), '[]'::jsonb),
           coalesce(sum(case when glovo then app.glovo_price(o.price_cents, o.glovo_price_cents, r.glovo_markup_bp) else o.price_cents end), 0), count(*),
           string_agg(coalesce(o.name ->> lang, o.name ->> 'fr', (select value #>> '{}' from jsonb_each(o.name) limit 1)), ', '
                      order by ig.sort_order, gr.sort_order, o.sort_order, o.created_at)
      into mods, add_price, n_found, names
      from (select distinct app.try_uuid(x ->> 'id') id from jsonb_array_elements(new.modifiers) x) s
      join public.modifier_options o on o.restaurant_id = new.restaurant_id and o.id = s.id and o.active
      join public.modifier_groups gr on gr.restaurant_id = new.restaurant_id and gr.id = o.group_id and gr.active
      join public.item_modifier_groups ig on ig.restaurant_id = new.restaurant_id and ig.group_id = gr.id and ig.menu_item_id = it.id;
    if n_found <> n_asked then
      raise exception 'modifier not available' using errcode = '23503';
    end if;
    for g in select gr.id, gr.min_select, gr.max_select,
                    (select count(*) from jsonb_array_elements(mods) m where (m ->> 'group_id')::uuid = gr.id) chosen
               from public.item_modifier_groups ig
               join public.modifier_groups gr on gr.restaurant_id = new.restaurant_id and gr.id = ig.group_id and gr.active
              where ig.restaurant_id = new.restaurant_id and ig.menu_item_id = it.id
                and exists (select 1 from public.modifier_options o where o.restaurant_id = new.restaurant_id and o.group_id = gr.id and o.active) loop
      if g.chosen < g.min_select or (g.max_select is not null and g.chosen > g.max_select) then
        raise exception 'modifier choice required' using errcode = '23514';
      end if;
    end loop;
    -- a group with everything ticked reads "Légumes : tout" instead of every option (till, ticket, kitchen bon)
    if n_found > 0 then
      sm := app.mods_summary(new.restaurant_id, lang, mods);
      mods := sm -> 'mods';
      names := sm ->> 'names';
    end if;
    new.modifiers := mods;
    -- happy hour: a percentage off the dish (options keep their price); never on Glovo, whose prices are set in the Glovo app
    select * into hh from app.happy_hour_for(r, it, now());
    if hh.id is not null and not glovo then
      new.list_price_cents := new.unit_price_cents + add_price;
      new.promo_id := hh.id;
      new.unit_price_cents := new.unit_price_cents - round(new.unit_price_cents * hh.value / 10000.0)::bigint;
    end if;
    new.unit_price_cents := new.unit_price_cents + add_price;
    if names is not null then
      new.name := left(new.name || ' + ' || names, 120);
    end if;
    -- sold by weight: the price of the weight (the price above is for 1 kg)
    if it.sold_by_weight then
      if new.weight_g is null then
        raise exception 'weight required' using errcode = '23514', hint = 'weighed_item';
      end if;
      new.unit_price_cents := round(new.unit_price_cents * new.weight_g / 1000.0)::bigint;
      if new.list_price_cents is not null then
        new.list_price_cents := round(new.list_price_cents * new.weight_g / 1000.0)::bigint;
      end if;
      new.name := left(new.name || ' · ' || app.fmt_kg(new.weight_g), 120);
    else
      new.weight_g := null;
    end if;
  else
    new.weight_g := null;
    new.modifiers := '[]'::jsonb;
    if new.variant_id is not null then
      raise exception 'variant without item' using errcode = '23503';
    end if;
    if new.vat_bp is null then
      new.vat_bp := r.default_vat_bp;
    end if;
  end if;
  if app.is_client() then
    new.created_at := now();
    new.kitchen_sent_at := null;
  end if;
  return new;
end $function$;
