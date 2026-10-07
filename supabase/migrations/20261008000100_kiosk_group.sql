-- Kiosk (the restaurant's own ordering screen), the customer display needs nothing here (it runs
-- on a realtime broadcast), and groups: an owner with several restaurants compares them and copies
-- the menu from one to another.

-- ------------------------------------------------------------ kiosk
alter table public.restaurants add column if not exists kiosk_token text
  check (kiosk_token is null or kiosk_token ~ '^[A-Za-z0-9]{16,40}$');
grant update (kiosk_token) on public.restaurants to authenticated;

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
                             delivery_address, note, wanted_at, delivery_location, external_ref)
  values (r.id, v_client, current_date, 0, 'qr', v_type, t.id, v_name, v_phone,
          case when v_type = 'delivery' then v_address end, v_note, v_wanted, v_loc, case when v_kiosk then 'borne' end)
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


-- ------------------------------------------------------------ groups
-- Figures per restaurant over a period, for every restaurant the caller owns (or manages).
create or replace function public.group_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('not_allowed'); end if;
  if p_to < p_from or p_to - p_from > 366 then perform app.fail('invalid_request'); end if;
  return (select coalesce(jsonb_agg(x order by x.revenue_cents desc), '[]'::jsonb) from (
    select r.id, r.name, r.slug, r.city,
      coalesce((select sum(d.total_ttc_cents) from public.fiscal_documents d where d.restaurant_id = r.id and d.business_date between p_from and p_to), 0) revenue_cents,
      (select count(*) from public.fiscal_documents d where d.restaurant_id = r.id and d.business_date between p_from and p_to and d.doc_type <> 'credit_note') tickets,
      coalesce((select sum(d.discount_cents) from public.fiscal_documents d where d.restaurant_id = r.id and d.business_date between p_from and p_to), 0) discounts_cents,
      coalesce((select sum(-d.total_ttc_cents) from public.fiscal_documents d where d.restaurant_id = r.id and d.business_date between p_from and p_to and d.doc_type = 'credit_note'), 0) credit_notes_cents,
      (select count(*) from public.orders o where o.restaurant_id = r.id and o.business_date between p_from and p_to and o.status = 'cancelled') cancelled,
      (select count(*) from public.orders o where o.restaurant_id = r.id and o.business_date between p_from and p_to and o.source = 'qr' and o.status <> 'cancelled') guest_orders,
      coalesce((select sum(z.cash_diff_cents) from public.day_closures z where z.restaurant_id = r.id and z.business_date between p_from and p_to), 0) cash_gap_cents
    from public.restaurants r
    where r.status <> 'cancelled' and exists (select 1 from public.memberships m where m.restaurant_id = r.id and m.user_id = auth.uid() and m.role in ('owner', 'manager'))
  ) x);
end $$;

-- Copies the menu of one restaurant to another of the same owner: missing categories, dishes,
-- sizes and options are added, existing ones (same French name) are updated. Nothing is deleted.
-- Prices are copied only when asked (a food court is often more expensive).
create or replace function public.menu_copy(p_from uuid, p_to uuid, p_prices boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; it record; v record; g record; op record; tc uuid; ti uuid; tg uuid;
  n_cat int := 0; n_new int := 0; n_upd int := 0;
begin
  perform app.require_role(p_from, 'owner', false);
  perform app.require_role(p_to, 'owner', true);
  if p_from = p_to then perform app.fail('invalid_request'); end if;
  -- option groups first (dishes link to them)
  for g in select * from public.modifier_groups where restaurant_id = p_from and active loop
    select id into tg from public.modifier_groups where restaurant_id = p_to and lower(name ->> 'fr') = lower(g.name ->> 'fr') limit 1;
    if tg is null then
      insert into public.modifier_groups (restaurant_id, name, min_select, max_select, sort_order)
      values (p_to, g.name, g.min_select, g.max_select, g.sort_order) returning id into tg;
    else
      update public.modifier_groups set name = g.name, min_select = g.min_select, max_select = g.max_select, active = true where id = tg;
    end if;
    for op in select * from public.modifier_options where group_id = g.id and active loop
      update public.modifier_options set name = op.name, active = true, price_cents = case when p_prices then op.price_cents else price_cents end
       where group_id = tg and lower(name ->> 'fr') = lower(op.name ->> 'fr');
      if not found then
        insert into public.modifier_options (restaurant_id, group_id, name, price_cents, sort_order) values (p_to, tg, op.name, op.price_cents, op.sort_order);
      end if;
    end loop;
  end loop;
  for c in select * from public.categories where restaurant_id = p_from and active order by sort_order loop
    select id into tc from public.categories where restaurant_id = p_to and lower(name ->> 'fr') = lower(c.name ->> 'fr') limit 1;
    if tc is null then
      insert into public.categories (restaurant_id, name, icon, station, sort_order, schedule)
      values (p_to, c.name, c.icon, c.station, c.sort_order, c.schedule) returning id into tc;
      n_cat := n_cat + 1;
    else
      update public.categories set name = c.name, icon = c.icon, active = true where id = tc;
    end if;
    for it in select * from public.menu_items where category_id = c.id and active loop
      select id into ti from public.menu_items where restaurant_id = p_to and lower(name ->> 'fr') = lower(it.name ->> 'fr') limit 1;
      if ti is null then
        insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, vat_bp, station, tags, sort_order)
        values (p_to, tc, it.name, it.description, it.price_cents, it.image_url, it.vat_bp, it.station, it.tags, it.sort_order) returning id into ti;
        n_new := n_new + 1;
      else
        update public.menu_items set category_id = tc, name = it.name, description = it.description, image_url = coalesce(it.image_url, image_url),
               vat_bp = it.vat_bp, tags = it.tags, active = true, price_cents = case when p_prices then it.price_cents else price_cents end
         where id = ti;
        n_upd := n_upd + 1;
      end if;
      for v in select * from public.item_variants where menu_item_id = it.id and active loop
        update public.item_variants set name = v.name, active = true, price_cents = case when p_prices then v.price_cents else price_cents end
         where menu_item_id = ti and lower(name ->> 'fr') = lower(v.name ->> 'fr');
        if not found then
          insert into public.item_variants (restaurant_id, menu_item_id, name, price_cents, sort_order) values (p_to, ti, v.name, v.price_cents, v.sort_order);
        end if;
      end loop;
      insert into public.item_modifier_groups (restaurant_id, menu_item_id, group_id, sort_order)
      select p_to, ti, tg2.id, l.sort_order from public.item_modifier_groups l
        join public.modifier_groups sg on sg.id = l.group_id
        join public.modifier_groups tg2 on tg2.restaurant_id = p_to and lower(tg2.name ->> 'fr') = lower(sg.name ->> 'fr')
       where l.menu_item_id = it.id
         and not exists (select 1 from public.item_modifier_groups x where x.menu_item_id = ti and x.group_id = tg2.id);
    end loop;
  end loop;
  return jsonb_build_object('categories', n_cat, 'added', n_new, 'updated', n_upd);
end $$;
revoke all on function public.group_overview(date, date) from public, anon;
revoke all on function public.menu_copy(uuid, uuid, boolean) from public, anon;
grant execute on function public.group_overview(date, date) to authenticated;
grant execute on function public.menu_copy(uuid, uuid, boolean) to authenticated;
