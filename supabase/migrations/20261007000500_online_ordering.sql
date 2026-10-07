-- =============================================================================
-- 0034 ONLINE ORDERING (own channel, no commission)
-- =============================================================================
-- The menu link (menu.../<restaurant>) without a table is the restaurant's own
-- ordering channel: take-away and delivery, shared on WhatsApp, Instagram,
-- Google. Settings in restaurants.online:
--   prep_minutes, delivery_fee_cents, delivery_min_cents, delivery_free_from_cents,
--   delivery_area (text), schedule (order for later), paused_until
-- Orders respect the opening hours (or ask for a later time), the till accepts
-- them with a ready time, the guest follows it live.
-- =============================================================================

alter table public.restaurants
  add column if not exists online jsonb not null default '{}'::jsonb check (jsonb_typeof(online) = 'object');
grant update (online) on public.restaurants to authenticated;

alter table public.orders
  add column if not exists wanted_at timestamptz,        -- the guest asked for this time
  add column if not exists eta_at timestamptz,           -- the till said: ready / delivered around
  add column if not exists delivery_location jsonb;      -- {lat, lng} shared by the guest

create or replace function app.online_prep(r public.restaurants)
returns int language sql immutable set search_path = '' as $$
  select least(240, greatest(5, coalesce((r.online ->> 'prep_minutes')::int, 20)))
$$;

-- open at a moment, from opening_hours {"mon": [["08:00","23:30"]], ...} (local time;
-- a range past midnight like ["18:00","02:00"] runs into the next day). No hours = always open.
create or replace function app.open_at(r public.restaurants, at_time timestamptz)
returns boolean language plpgsql stable set search_path = '' as $$
declare loc timestamp := at_time at time zone r.timezone; d text; prev text; rng jsonb; s time; e time; t time := loc::time;
begin
  if r.opening_hours is null or r.opening_hours = '{}'::jsonb then return true; end if;
  d := lower(to_char(loc, 'dy')); prev := lower(to_char(loc - interval '1 day', 'dy'));
  for rng in select * from jsonb_array_elements(coalesce(r.opening_hours -> d, '[]')) loop
    s := (rng ->> 0)::time; e := (rng ->> 1)::time;
    if (e > s and t >= s and t < e) or (e <= s and t >= s) then return true; end if;
  end loop;
  for rng in select * from jsonb_array_elements(coalesce(r.opening_hours -> prev, '[]')) loop
    s := (rng ->> 0)::time; e := (rng ->> 1)::time;
    if e <= s and t < e then return true; end if;
  end loop;
  return false;
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
    'table', case when t.id is not null
                  then jsonb_build_object('label', t.label, 'token', t.qr_token) end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon) order by c.sort_order, c.created_at, c.id)
      from public.categories c
      where c.restaurant_id = r.id and c.active
        and exists (select 1 from public.menu_items i
                    where i.restaurant_id = r.id and i.category_id = c.id and i.active)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category_id', i.category_id, 'name', i.name,
        'description', i.description, 'price_cents', i.price_cents,
        'image_url', i.image_url, 'tags', i.tags, 'available', i.available,
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
      where i.restaurant_id = r.id and i.active and c.active
    ), '[]'::jsonb)
  );
end $$;

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
  v_name    := nullif(btrim(p_order #>> '{customer,name}'), '');
  v_phone   := nullif(btrim(p_order #>> '{customer,phone}'), '');
  v_address := nullif(btrim(p_order #>> '{customer,address}'), '');
  v_note    := nullif(btrim(p_order ->> 'note'), '');

  if v_type = 'dine_in' then
    if not r.accept_dine_in then perform app.fail('order_type_unavailable'); end if;
    select * into t from public.dining_tables
     where restaurant_id = r.id and qr_token = (p_order ->> 'table_token') and active;
    if t.id is null then perform app.fail('invalid_table'); end if;
  elsif v_type = 'takeaway' then
    if not r.accept_takeaway then perform app.fail('order_type_unavailable'); end if;
    if v_name is null or v_phone is null then perform app.fail('customer_required'); end if;
  elsif v_type = 'delivery' then
    if not r.accept_delivery then perform app.fail('order_type_unavailable'); end if;
    if v_name is null or v_phone is null or v_address is null then perform app.fail('customer_required'); end if;
  else
    perform app.fail('invalid_request', 'order_type');
  end if;

  -- online orders (take-away and delivery, no table): pause, opening hours, a time asked for
  if t.id is null then
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
                             delivery_address, note, wanted_at, delivery_location)
  values (r.id, v_client, current_date, 0, 'qr', v_type, t.id, v_name, v_phone,
          case when v_type = 'delivery' then v_address end, v_note, v_wanted, v_loc)
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
     where i.restaurant_id = r.id and i.id = v_item_id and i.active and c.active;
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
  return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'status', o.status, 'duplicate', false);
end $$;

-- the guest's tracking page: also the type, the ready time and how to reach the restaurant
create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', o.status, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'created_at', o.created_at,
                            'order_type', o.order_type, 'eta_at', o.eta_at, 'wanted_at', o.wanted_at,
                            'restaurant_phone', (select phone from public.restaurants where id = o.restaurant_id))
  from public.orders o
  where o.id = coalesce((select to_order_id from app.order_redirects where from_order_id = p_order_id), p_order_id)
    and o.created_at > now() - interval '24 hours'
    and (o.source = 'qr' or exists (select 1 from app.order_redirects r where r.from_order_id = p_order_id))
$$;
revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated;

-- Pause online orders when the kitchen is overloaded: from the till or the back office.
-- p_minutes null or 0 = take orders again.
create or replace function public.online_pause(p_restaurant_id uuid, p_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; until timestamptz;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if p_minutes is not null and p_minutes not between 0 and 2880 then perform app.fail('invalid_request', 'minutes'); end if;
  until := case when coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end;
  update public.restaurants
     set online = case when until is null then online - 'paused_until' else online || jsonb_build_object('paused_until', until) end
   where id = r.id;
  return jsonb_build_object('paused_until', until);
end $$;
revoke all on function public.online_pause(uuid, integer) from public, anon;
grant execute on function public.online_pause(uuid, integer) to authenticated;
