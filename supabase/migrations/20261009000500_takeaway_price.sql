-- =============================================================================
-- Takeaway price and "dine-in only" in the recipe card
-- * categories.takeaway_discount_cents: so much less per dish when the order is takeaway
--   (all drinks 1 DH less). A dish can override it (menu_items.takeaway_discount_cents, null =
--   the category's, 0 = no reduction). Applied by the database when a line is written, like
--   the happy hour, so the till, the QR menu and online orders all charge the same.
-- * recipe_lines.dine_in_only: this ingredient only goes with dine-in orders (the small water
--   bottle served with a coffee at the table). Live stock, the stock report and the forecast
--   leave it out for takeaway and delivery.
-- =============================================================================
alter table public.categories add column if not exists takeaway_discount_cents bigint not null default 0
  check (takeaway_discount_cents between 0 and 100000000);
alter table public.menu_items add column if not exists takeaway_discount_cents bigint
  check (takeaway_discount_cents is null or takeaway_discount_cents between 0 and 100000000);
alter table public.recipe_lines add column if not exists dine_in_only boolean not null default false;

create or replace function app.takeaway_off(it public.menu_items, c public.categories)
returns bigint language sql immutable set search_path = '' as $$
  select coalesce(it.takeaway_discount_cents, c.takeaway_discount_cents, 0)::bigint
$$;

create or replace function app.order_lines_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
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
       or new.created_at <> old.created_at then
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
    new.unit_price_cents := it.price_cents;
    new.vat_bp := coalesce(it.vat_bp, r.default_vat_bp);
    new.station := coalesce(it.station, c.station, 'kitchen');
    if new.variant_id is not null then
      select * into v from public.item_variants
       where restaurant_id = new.restaurant_id and id = new.variant_id and menu_item_id = it.id;
      if v.id is null then
        raise exception 'variant does not belong to item' using errcode = '23503';
      end if;
      new.name := new.name || ' (' || coalesce(v.name ->> lang, v.name ->> 'fr', '') || ')';
      new.unit_price_cents := v.price_cents;
    end if;
    -- takeaway: the price of the dish (or its size) minus the takeaway reduction of the dish or its category
    select o.order_type into otype from public.orders o where o.restaurant_id = new.restaurant_id and o.id = new.order_id;
    if otype = 'takeaway' then
      new.unit_price_cents := greatest(0, new.unit_price_cents - app.takeaway_off(it, c));
    end if;
    -- extras and menu choices: only options of groups linked to this dish, priced here
    if jsonb_typeof(new.modifiers) <> 'array' then new.modifiers := '[]'::jsonb; end if;
    select count(distinct x ->> 'id') into n_asked from jsonb_array_elements(new.modifiers) x;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group_id', o.group_id,
                     'name', coalesce(o.name ->> lang, o.name ->> 'fr', (select value #>> '{}' from jsonb_each(o.name) limit 1)),
                     'price_cents', o.price_cents) order by ig.sort_order, gr.sort_order, o.sort_order, o.created_at), '[]'::jsonb),
           coalesce(sum(o.price_cents), 0), count(*),
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
    -- happy hour: a percentage off the dish (options keep their price)
    select * into hh from app.happy_hour_for(r, it, now());
    if hh.id is not null then
      new.list_price_cents := new.unit_price_cents + add_price;
      new.promo_id := hh.id;
      new.unit_price_cents := new.unit_price_cents - round(new.unit_price_cents * hh.value / 10000.0)::bigint;
    end if;
    new.unit_price_cents := new.unit_price_cents + add_price;
    if names is not null then
      new.name := left(new.name || ' + ' || names, 120);
    end if;
  else
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
end $$;

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
  select u.ingredient_id, sum(u.q / (1 - g.waste_bp / 10000.0))
    from u join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = u.ingredient_id
   group by u.ingredient_id
$$;

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
  theo as (
    select rl.ingredient_id, sum(s.qty * rl.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
      join public.ingredients g on g.restaurant_id = r.id and g.id = rl.ingredient_id
     group by 1),
  base as (
    select g.id, g.name, g.name_ar, g.category, g.base_unit, g.purchase_unit, g.purchase_qty,
           case when g.purchase_price_cents is not null then g.purchase_price_cents::numeric / g.purchase_qty end unit_cost,
           o.qty opening, c.qty closing, coalesce(buy.qty, 0) bought, buy.spent,
           case when uses_pos then coalesce(theo.qty, 0) end theo
      from public.ingredients g
      left join o on o.ingredient_id = g.id
      left join c on c.ingredient_id = g.id
      left join buy on buy.ingredient_id = g.id
      left join theo on theo.ingredient_id = g.id
     where g.restaurant_id = r.id
       and (o.qty is not null or c.qty is not null or buy.qty is not null or theo.qty is not null)),
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
      'theoretical', theo, 'gap', gap,
      'used_cents', used_cents, 'theoretical_cents', theo_cents, 'gap_cents', gap_cents,
      -- more came out of the counts than went in: a purchase was not noted, or a count is wrong
      'negative', coalesce(used < 0, false)
    ) order by counted desc, coalesce(abs(gap_cents), 0) desc, coalesce(used_cents, 0) desc, name), '[]'::jsonb),
    jsonb_build_object(
      'used_cents', coalesce(sum(used_cents) filter (where counted), 0),
      'theoretical_cents', case when uses_pos then coalesce(sum(theo_cents) filter (where counted), 0) end,
      'gap_cents', case when uses_pos then coalesce(sum(gap_cents) filter (where counted and gap_cents > 0), 0) end,
      'surplus_cents', case when uses_pos then coalesce(-sum(gap_cents) filter (where counted and gap_cents < 0), 0) end,
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
    select s.d, rl.ingredient_id, sum(s.qty * rl.qty / (1 - g.waste_bp / 10000.0)) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
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

create or replace function public.get_menu(p_slug text, p_table_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
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
        'description', i.description, 'price_cents', i.price_cents,
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
end $$;
