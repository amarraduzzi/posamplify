-- One shared QR for the whole restaurant (optional, off by default).
--
-- A restaurant can choose between
--   * a QR code per table (as before: the code identifies the table), and
--   * one QR code for the restaurant: the guest types the table number.
-- restaurants.qr_shared switches the second on. Scanning a table QR still
-- works in both cases and never asks for a number. An order whose table number
-- was typed by the guest is flagged (orders.table_by_guest) so the till can show it.
-- Safe to run on a live database: nothing changes while qr_shared stays false.

alter table public.restaurants add column if not exists qr_shared boolean not null default false;
grant update (qr_shared) on public.restaurants to authenticated;

alter table public.orders add column if not exists table_by_guest boolean not null default false;

-- ------------------------------------------------------------ place_order
create or replace function public.place_order(p_slug text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.restaurants;
  t          public.dining_tables;
  o          public.orders;
  it         public.menu_items;
  v          public.item_variants;
  line       jsonb;
  v_client   uuid;
  v_type     text;
  v_qty      int;
  v_item_id  uuid;
  v_var_id   uuid;
  v_name     text;
  v_phone    text;
  v_address  text;
  v_note     text;
  has_variants boolean;
  v_wanted   timestamptz;
  v_loc      jsonb;
  v_fee      bigint;
  v_kiosk    boolean;
  v_by_guest boolean := false;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    perform app.fail('invalid_request');
  end if;

  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then
    perform app.fail('restaurant_not_found');
  end if;
  if not app.is_writable(r) then
    perform app.fail('ordering_unavailable');
  end if;
  if not app.qr_ordering(r) then
    perform app.fail('qr_ordering_off');
  end if;

  v_client := app.try_uuid(p_order ->> 'client_id');
  if v_client is null then
    perform app.fail('invalid_request', 'client_id');
  end if;

  -- Idempotency: the same client_id always returns the same order.
  select * into o from public.orders where restaurant_id = r.id and client_id = v_client;
  if o.id is not null then
    return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                              'total_cents', o.total_cents, 'status', o.status, 'duplicate', true);
  end if;

  v_type    := p_order ->> 'order_type';
  -- the restaurant's own ordering kiosk (secret token): no table, no phone
  v_kiosk   := r.kiosk_token is not null and coalesce(p_order ->> 'kiosk', '') = r.kiosk_token;
  v_name    := nullif(btrim(p_order #>> '{customer,name}'), '');
  v_phone   := nullif(btrim(p_order #>> '{customer,phone}'), '');
  v_address := nullif(btrim(p_order #>> '{customer,address}'), '');
  v_note    := nullif(btrim(p_order ->> 'note'), '');

  if v_type = 'dine_in' then
    if not r.accept_dine_in and not v_kiosk then perform app.fail('order_type_unavailable'); end if;
    if not v_kiosk then
      select * into t from public.dining_tables
       where restaurant_id = r.id and qr_token = (p_order ->> 'table_token') and active;
      -- one shared QR (restaurants.qr_shared): the guest typed the table number
      if t.id is null and r.qr_shared and nullif(btrim(p_order ->> 'table_number'), '') is not null then
        if length(btrim(p_order ->> 'table_number')) > 30 then perform app.fail('invalid_table'); end if;
        select * into t from public.dining_tables
         where restaurant_id = r.id and active and lower(btrim(label)) = lower(btrim(p_order ->> 'table_number'))
         order by sort_order, id limit 1;
        v_by_guest := t.id is not null;
      end if;
      if t.id is null then perform app.fail('invalid_table'); end if;
    end if;
  elsif v_type = 'takeaway' then
    if not r.accept_takeaway and not v_kiosk then perform app.fail('order_type_unavailable'); end if;
    if (v_name is null or v_phone is null) and not v_kiosk then perform app.fail('customer_required'); end if;
  elsif v_type = 'delivery' then
    if not r.accept_delivery or v_kiosk then perform app.fail('order_type_unavailable'); end if;
    if v_name is null or v_phone is null or v_address is null then perform app.fail('customer_required'); end if;
  else
    perform app.fail('invalid_request', 'order_type');
  end if;

  -- online orders (take-away and delivery, no table): pause, opening hours, a time asked for
  if t.id is null and not v_kiosk then
    if coalesce((r.online ->> 'paused_until')::timestamptz > now(), false) then perform app.fail('online_paused'); end if;
    if nullif(p_order ->> 'wanted_at', '') is not null then
      begin v_wanted := (p_order ->> 'wanted_at')::timestamptz;
      exception when others then perform app.fail('invalid_request', 'wanted_at'); end;
      if v_wanted < now() + make_interval(mins => app.online_prep(r) - 5) or v_wanted > now() + interval '7 days'
         or not coalesce((r.online ->> 'schedule')::boolean, true) then
        perform app.fail('invalid_request', 'wanted_at');
      end if;
      if not app.open_at(r, v_wanted) then perform app.fail('closed'); end if;
    elsif not app.open_at(r, now()) then
      perform app.fail('closed');
    end if;
    if v_type = 'delivery' and jsonb_typeof(p_order -> 'location') = 'object' then
      if (p_order #>> '{location,lat}') ~ '^-?[0-9]{1,2}(\.[0-9]+)?$' and (p_order #>> '{location,lng}') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
        v_loc := jsonb_build_object('lat', round((p_order #>> '{location,lat}')::numeric, 6), 'lng', round((p_order #>> '{location,lng}')::numeric, 6));
      end if;
    end if;
    -- the same phone cannot flood the restaurant
    if (select count(*) from public.orders where restaurant_id = r.id and source = 'qr' and table_id is null
          and customer_phone = v_phone and created_at > now() - interval '10 minutes') >= 4 then
      perform app.fail('rate_limited');
    end if;
  end if;
  if length(v_note) > 300 or length(v_name) > 60 or length(v_phone) > 30 or length(v_address) > 300 then
    perform app.fail('invalid_request', 'too_long');
  end if;
  if jsonb_typeof(p_order -> 'items') <> 'array'
     or jsonb_array_length(p_order -> 'items') not between 1 and 50 then
    perform app.fail('invalid_request', 'items');
  end if;

  -- Basic abuse protection for a public endpoint.
  if t.id is not null and (
       select count(*) from public.orders
        where restaurant_id = r.id and table_id = t.id and source = 'qr'
          and created_at > now() - interval '10 minutes') >= 8 then
    perform app.fail('rate_limited');
  end if;
  if (select count(*) from public.orders
       where restaurant_id = r.id and source = 'qr'
         and created_at > now() - interval '10 minutes') >= 150 then
    perform app.fail('rate_limited');
  end if;

  insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source,
                             order_type, table_id, customer_name, customer_phone,
                             delivery_address, note, wanted_at, delivery_location, external_ref, table_by_guest)
  values (r.id, v_client, current_date, 0, 'qr', v_type, t.id, v_name, v_phone,
          case when v_type = 'delivery' then v_address end, v_note, v_wanted, v_loc, case when v_kiosk then 'borne' end, v_by_guest)
  returning * into o;

  for line in select * from jsonb_array_elements(p_order -> 'items') loop
    v_item_id := app.try_uuid(line ->> 'item_id');
    v_var_id  := app.try_uuid(line ->> 'variant_id');
    v_qty     := case when (line ->> 'quantity') ~ '^[0-9]{1,3}$' then (line ->> 'quantity')::int end;

    if v_qty is null or v_qty not between 1 and 20 then
      perform app.fail('invalid_request', 'quantity');
    end if;
    if length(line ->> 'note') > 200 then
      perform app.fail('invalid_request', 'too_long');
    end if;

    select i.* into it from public.menu_items i
      join public.categories c on c.restaurant_id = i.restaurant_id and c.id = i.category_id
     where i.restaurant_id = r.id and i.id = v_item_id and i.active and c.active and app.category_open(c, r, coalesce(v_wanted, now()));
    if it.id is null then
      perform app.fail('item_unavailable', coalesce(v_item_id::text, ''));
    end if;
    if not it.available then
      perform app.fail('item_sold_out', it.id::text);
    end if;

    select exists (select 1 from public.item_variants
                    where restaurant_id = r.id and menu_item_id = it.id and active)
      into has_variants;
    if has_variants then
      select * into v from public.item_variants
       where restaurant_id = r.id and menu_item_id = it.id and id = v_var_id and active;
      if v.id is null then
        perform app.fail('variant_required', it.id::text);
      end if;
    elsif v_var_id is not null then
      perform app.fail('invalid_request', 'variant');
    end if;

    -- name / price / vat / station are filled from the menu by the line trigger
    if line ? 'modifiers' and (jsonb_typeof(line -> 'modifiers') <> 'array' or jsonb_array_length(line -> 'modifiers') > 30) then
      perform app.fail('invalid_request', 'modifiers');
    end if;
    -- options are checked and priced by the line trigger (never the browser's prices)
    insert into public.order_lines (restaurant_id, order_id, menu_item_id, variant_id,
                                    name, unit_price_cents, quantity, vat_bp, note, modifiers)
    values (r.id, o.id, it.id, case when has_variants then v.id end,
            '-', 0, v_qty, 0, nullif(btrim(line ->> 'note'), ''),
            coalesce((select jsonb_agg(jsonb_build_object('id', x)) from jsonb_array_elements_text(line -> 'modifiers') x), '[]'::jsonb));
  end loop;

  select * into o from public.orders where id = o.id;
  -- delivery: a minimum order and a fee (free from an amount), the fee is a line of the ticket
  if v_type = 'delivery' then
    if o.subtotal_cents < coalesce((r.online ->> 'delivery_min_cents')::bigint, 0) then
      perform app.fail('below_minimum', (r.online ->> 'delivery_min_cents'));
    end if;
    v_fee := coalesce((r.online ->> 'delivery_fee_cents')::bigint, 0);
    if v_fee > 0 and (nullif(r.online ->> 'delivery_free_from_cents', '') is null
                      or o.subtotal_cents < (r.online ->> 'delivery_free_from_cents')::bigint) then
      insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, station, kitchen_sent_at, ready_at)
      values (r.id, o.id, null, 'Livraison', v_fee, 1, 2000, 'kitchen', now(), now());
      select * into o from public.orders where id = o.id;
    end if;
  end if;
  -- a promo code typed by the guest (checked and priced here)
  if nullif(btrim(p_order ->> 'promo_code'), '') is not null then
    perform app.apply_promo_code(o.id, p_order ->> 'promo_code', 'online');
    select * into o from public.orders where id = o.id;
  end if;
  return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'status', o.status, 'duplicate', false);
end $$;

-- ------------------------------------------------------------ get_menu
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
