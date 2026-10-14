-- =============================================================================
-- Selling by weight (pâtisserie: gâteaux secs, msemen, chocolats au kilo)
--
-- * menu_items.sold_by_weight: price_cents is then the price of 1 kg, and its recipe is for 1 kg.
-- * The till sends the weight of a line (order_lines.weight_g, in grams, typed from the scale): the
--   server prices it (price per kg x weight, after the takeaway / Glovo / happy hour rules) and writes
--   the weight in the name, so the ticket reads "Gâteaux secs · 0,450 kg". quantity stays a count
--   (2 boxes of 450 g = quantity 2, weight 450).
-- * order_lines.units = what was sold in recipe units: the quantity, or quantity x kg for a weighed
--   line. Every recipe calculation (stock out at the sale, theoretical use, forecast, production plan,
--   dish profit) now counts units instead of quantity.
-- * A weighed item cannot be ordered online or by QR (nobody weighs it there): refused clearly.
-- =============================================================================

alter table public.menu_items add column if not exists sold_by_weight boolean not null default false;
alter table public.order_lines add column if not exists weight_g integer check (weight_g between 1 and 100000);
alter table public.order_lines add column if not exists units numeric
  generated always as (case when weight_g is null then quantity::numeric else quantity * weight_g / 1000.0 end) stored;

-- "0,450 kg"
create or replace function app.fmt_kg(g integer)
returns text language sql immutable set search_path = '' as $$
  select replace(to_char(g / 1000.0, 'FM9990.000'), '.', ',') || ' kg'
$$;

-- ------------------------------------------------------------ the line price
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

-- ------------------------------------------------------------ splitting a bill keeps the weight
CREATE OR REPLACE FUNCTION public.pos_split_order(p_order_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  o  public.orders;
  n  public.orders;
  x  jsonb;
  l  public.order_lines;
  q  int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if exists (select 1 from public.payments where restaurant_id = o.restaurant_id and order_id = o.id) then
    perform app.fail('remove_payments_first');
  end if;
  if o.discount_cents > 0 then perform app.fail('remove_discount_first'); end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    perform app.fail('invalid_request', 'lines');
  end if;

  insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, table_id,
                             staff_id, status, customer_name, customer_phone)
  values (o.restaurant_id, gen_random_uuid(), o.business_date, 0, o.source, o.order_type, o.table_id,
          o.staff_id, o.status, o.customer_name, o.customer_phone)
  returning * into n;

  perform set_config('app.copy_line', 'on', true);
  for x in select value from jsonb_array_elements(p_lines) loop
    select * into l from public.order_lines
     where restaurant_id = o.restaurant_id and order_id = o.id and id = app.try_uuid(x ->> 'line_id') for update;
    q := case when (x ->> 'quantity') ~ '^[0-9]{1,3}$' then (x ->> 'quantity')::int end;
    if l.id is null or q is null or q < 1 or q > l.quantity then
      perform set_config('app.copy_line', '', true);
      perform app.fail('invalid_request', 'line');
    end if;
    if q = l.quantity then
      update public.order_lines set order_id = n.id where id = l.id;
    else
      update public.order_lines set quantity = quantity - q where id = l.id;
      insert into public.order_lines (restaurant_id, order_id, menu_item_id, variant_id, name, unit_price_cents, quantity,
                                      vat_bp, station, note, kitchen_sent_at, print_requested_at, staff_id, created_at, modifiers, weight_g)
      values (l.restaurant_id, n.id, l.menu_item_id, l.variant_id, l.name, l.unit_price_cents, q,
              l.vat_bp, l.station, l.note, l.kitchen_sent_at, l.print_requested_at, l.staff_id, l.created_at, l.modifiers, l.weight_g);
    end if;
  end loop;
  perform set_config('app.copy_line', '', true);

  -- everything moved: the old bill disappears (its guest tracking follows)
  if not exists (select 1 from public.order_lines where restaurant_id = o.restaurant_id and order_id = o.id) then
    insert into app.order_redirects (from_order_id, to_order_id) values (o.id, n.id)
    on conflict (from_order_id) do update set to_order_id = excluded.to_order_id;
    update app.order_redirects set to_order_id = n.id where to_order_id = o.id;
    delete from public.orders where id = o.id;
  end if;

  select * into n from public.orders where id = n.id;
  return jsonb_build_object('order_id', n.id, 'ticket_number', n.ticket_number, 'total_cents', n.total_cents);
end $function$;

-- ------------------------------------------------------------ app.order_usage: units instead of quantity
CREATE OR REPLACE FUNCTION app.order_usage(p_restaurant_id uuid, p_order_id uuid)
 RETURNS TABLE(ingredient_id uuid, qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with l as (
    select menu_item_id, variant_id, units quantity, modifiers,
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
                                         and (not rl.dine_in_only or l.din)
    union all
    select cl.ingredient_id, cl.qty::numeric
      from public.catering_orders c
      join public.catering_lines cl on cl.restaurant_id = c.restaurant_id and cl.catering_id = c.id
     where c.restaurant_id = p_restaurant_id and c.order_id = p_order_id and cl.ingredient_id is not null)
  select x.ingredient_id, sum(x.qty / (1 - g.waste_bp / 10000.0))
    from u
    cross join lateral app.prep_tree(p_restaurant_id, u.ingredient_id, u.q, true) x
    join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = x.ingredient_id
   group by x.ingredient_id
$function$;

-- ------------------------------------------------------------ public.stock_report: units instead of quantity
CREATE OR REPLACE FUNCTION public.stock_report(p_restaurant_id uuid, p_from uuid, p_to uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.units) qty
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
end $function$;

-- ------------------------------------------------------------ public.stock_forecast: units instead of quantity
CREATE OR REPLACE FUNCTION public.stock_forecast(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select od.business_date d, l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.units) qty
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
end $function$;

-- ------------------------------------------------------------ public.profit_dishes: units instead of quantity
CREATE OR REPLACE FUNCTION public.profit_dishes(p_restaurant_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
           i.price_cents, coalesce(i.vat_bp, r.default_vat_bp) vat_bp, i.sort_order, i.image_url, i.sold_by_weight
      from public.menu_items i
     where i.restaurant_id = r.id and i.active
       and not exists (select 1 from public.item_variants v where v.restaurant_id = r.id and v.menu_item_id = i.id and v.active)
    union all
    select i.id, v.id, i.name, v.name, i.category_id,
           v.price_cents, coalesce(i.vat_bp, r.default_vat_bp), i.sort_order * 1000 + v.sort_order, i.image_url, i.sold_by_weight
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
    select l.menu_item_id item_id, l.variant_id, sum(l.units) qty
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
           'item_id', item_id, 'variant_id', variant_id, 'name', name, 'variant_name', variant_name, 'sold_by_weight', sold_by_weight,
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
end $function$;

-- ------------------------------------------------------------ public.production_plan: units instead of quantity
CREATE OR REPLACE FUNCTION public.production_plan(p_restaurant_id uuid, p_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; dt date; items jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  dt := coalesce(p_date, app.business_date(r));
  with
  sold as (
    select od.business_date d, l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.units) qty
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
     where restaurant_id = r.id and produced_on = dt and cancelled_at is null group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit, 'purchase_unit', g.purchase_unit, 'batch_qty', g.purchase_qty,
      'stock_qty', g.stock_qty, 'daily', round(coalesce(a.daily, 0), 3), 'made_today', coalesce(m.qty, 0),
      'catering', round(coalesce(c.qty, 0), 3),
      'suggested', greatest(0, round(coalesce(a.daily, 0) + coalesce(c.qty, 0) - greatest(coalesce(g.stock_qty, 0), 0), 3)),
      'cost_cents', g.purchase_price_cents
    ) order by g.name), '[]'::jsonb)
    into items
    from public.ingredients g
    left join avg_use a on a.ingredient_id = g.id
    left join cat c on c.ingredient_id = g.id
    left join made m on m.ingredient_id = g.id
   where g.restaurant_id = r.id and g.active and g.is_preparation and g.made_ahead;
  return jsonb_build_object('date', dt, 'items', items);
end $function$;

-- ------------------------------------------------------------ the guest menu: weighed items are shown, not orderable
CREATE OR REPLACE FUNCTION public.get_menu(p_slug text, p_table_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.restaurants;
  t public.dining_tables;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then
    return null;
  end if;

  if p_table_token is not null then
    select * into t from public.dining_tables
     where restaurant_id = r.id and qr_token = p_table_token and active;
  end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'name', r.name, 'languages', r.languages,
      'currency', r.currency, 'branding', r.branding, 'opening_hours', r.opening_hours,
      'timezone', r.timezone, 'phone', r.phone, 'address', r.address, 'city', r.city,
      'accept_dine_in', r.accept_dine_in, 'accept_takeaway', r.accept_takeaway,
      'accept_delivery', r.accept_delivery
    ),
    'ordering_enabled', app.qr_ordering(r),
    'table_entry', r.qr_shared,
    'table_numeric', not exists (select 1 from public.dining_tables d where d.restaurant_id = r.id and d.active and d.label !~ '^[0-9]+$'),
    'online', jsonb_build_object(
      'prep_minutes', app.online_prep(r),
      'delivery_fee_cents', coalesce((r.online ->> 'delivery_fee_cents')::bigint, 0),
      'delivery_min_cents', coalesce((r.online ->> 'delivery_min_cents')::bigint, 0),
      'delivery_free_from_cents', (r.online ->> 'delivery_free_from_cents')::bigint,
      'delivery_area', r.online ->> 'delivery_area',
      'schedule', coalesce((r.online ->> 'schedule')::boolean, true),
      'paused', coalesce((r.online ->> 'paused_until')::timestamptz > now(), false),
      'paused_until', case when (r.online ->> 'paused_until')::timestamptz > now() then r.online ->> 'paused_until' end,
      'open_now', app.open_at(r, now())),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'value', p.value, 'until', p.end_time) order by p.value desc), '[]'::jsonb)
                     from public.promotions p where p.restaurant_id = r.id and p.kind = 'happy_hour' and app.promo_live(p, r, now())),
    'codes', exists (select 1 from public.promotions p where p.restaurant_id = r.id and p.kind = 'code' and p.active and 'online' = any (p.channels)),
    'table', case when t.id is not null
                  then jsonb_build_object('label', t.label, 'token', t.qr_token) end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon) order by c.sort_order, c.created_at, c.id)
      from public.categories c
      where c.restaurant_id = r.id and c.active and app.category_open(c, r, now())
        and exists (select 1 from public.menu_items i
                    where i.restaurant_id = r.id and i.category_id = c.id and i.active)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category_id', i.category_id, 'name', i.name,
        'description', i.description, 'price_cents', i.price_cents, 'sold_by_weight', i.sold_by_weight,
        'image_url', i.image_url, 'tags', i.tags, 'available', i.available,
        'promo_bp', (select p.value from app.happy_hour_for(r, i, now()) p),
        'takeaway_off_cents', app.takeaway_off(i, (select c2 from public.categories c2 where c2.restaurant_id = r.id and c2.id = i.category_id)),
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_cents', v.price_cents)
                           order by v.sort_order, v.price_cents, v.id)
          from public.item_variants v
          where v.restaurant_id = r.id and v.menu_item_id = i.id and v.active
        ), '[]'::jsonb),
        'modifier_groups', coalesce((
          select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
                   'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)
                                                order by o.sort_order, o.created_at), '[]'::jsonb)
                                 from public.modifier_options o where o.restaurant_id = r.id and o.group_id = g.id and o.active))
                 order by ig.sort_order, g.sort_order, g.created_at)
          from public.item_modifier_groups ig
          join public.modifier_groups g on g.restaurant_id = r.id and g.id = ig.group_id and g.active
          where ig.restaurant_id = r.id and ig.menu_item_id = i.id
            and exists (select 1 from public.modifier_options o where o.restaurant_id = r.id and o.group_id = g.id and o.active)
        ), '[]'::jsonb)
      ) order by c.sort_order, c.created_at, i.sort_order, i.created_at, i.id)
      from public.menu_items i
      join public.categories c on c.restaurant_id = i.restaurant_id and c.id = i.category_id
      where i.restaurant_id = r.id and i.active and c.active and app.category_open(c, r, now())
    ), '[]'::jsonb)
  );
end $function$;

-- ------------------------------------------------------------ the demo pâtisserie (if it exists): gâteaux secs au kilo
do $$
declare rid uuid; c uuid; prep uuid; it uuid;
  g_farine uuid; g_beurre uuid; g_sucre uuid; g_amandes uuid; g_oeufs uuid; g_fleur uuid;
begin
  select id into rid from public.restaurants where slug = 'patisserie-demo';
  if rid is null or exists (select 1 from public.menu_items where restaurant_id = rid and sold_by_weight) then return; end if;
  select id into c from public.categories where restaurant_id = rid and name ->> 'fr' = 'Gâteaux marocains';
  select id into g_farine from public.ingredients where restaurant_id = rid and name = 'Farine T55';
  select id into g_beurre from public.ingredients where restaurant_id = rid and name = 'Beurre doux';
  select id into g_sucre from public.ingredients where restaurant_id = rid and name = 'Sucre';
  select id into g_amandes from public.ingredients where restaurant_id = rid and name = 'Amandes émondées';
  select id into g_oeufs from public.ingredients where restaurant_id = rid and name = 'Oeufs';
  select id into g_fleur from public.ingredients where restaurant_id = rid and name = 'Eau de fleur d''oranger';
  if c is null or g_farine is null then return; end if;
  insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, is_preparation, made_ahead, category, stock_qty, stock_since)
  values (rid, 'Gâteaux secs assortis', 'g', 'fournée', 3000, true, true, 'preparation', 0, app.business_date((select r from public.restaurants r where r.id = rid)) - 1)
  returning id into prep;
  insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty, sort_order) values
    (rid, prep, g_farine, 1200, 0), (rid, prep, g_beurre, 600, 1), (rid, prep, g_sucre, 500, 2),
    (rid, prep, g_amandes, 700, 3), (rid, prep, g_oeufs, 6, 4), (rid, prep, g_fleur, 50, 5);
  insert into public.menu_items (restaurant_id, category_id, name, price_cents, sold_by_weight, sort_order)
  values (rid, c, '{"fr":"Gâteaux secs assortis"}', 12000, true, 0) returning id into it;
  insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values (rid, it, prep, 1000);
end $$;
