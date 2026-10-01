-- =============================================================================
-- 0025 SPLIT THE BILL BY ITEMS
-- =============================================================================
-- "This one pays the two coffees and the croissant": the chosen lines (or part
-- of a line's quantity) move to a new open order on the same table, which is
-- paid on its own and gets its own fiscal ticket. Lines keep their exact name
-- and price (copied, never re-read from today's menu).
-- =============================================================================

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



create or replace function public.pos_split_order(p_order_id uuid, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
                                      vat_bp, station, note, kitchen_sent_at, print_requested_at, staff_id, created_at, modifiers)
      values (l.restaurant_id, n.id, l.menu_item_id, l.variant_id, l.name, l.unit_price_cents, q,
              l.vat_bp, l.station, l.note, l.kitchen_sent_at, l.print_requested_at, l.staff_id, l.created_at, l.modifiers);
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
end $$;
revoke all on function public.pos_split_order(uuid, jsonb) from public, anon;
grant execute on function public.pos_split_order(uuid, jsonb) to authenticated;
