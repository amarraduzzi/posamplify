-- =============================================================================
-- AMPLIFY MAÎTRE: the fine dining package, switched on per restaurant (products 'maitre', with POS)
--
-- In the package: the guest profile at the till (VIP, preferences, favourite dishes, the sheet),
-- Le Briefing, the booking deposit (acompte) and the occasion, the rhythm of the evening.
-- Always for everyone: the floor plan, and the allergies of a guest on the kitchen bon (safety first).
-- A deposit already received stays usable, refundable or kept when the package is switched off.
-- =============================================================================

alter table public.restaurants drop constraint if exists restaurants_products_check;
alter table public.restaurants add constraint restaurants_products_check
  check (products <@ array['pos', 'profit', 'site', 'orders', 'loyalty', 'maitre'] and cardinality(products) between 1 and 6);

create or replace function app.has_maitre(r public.restaurants)
returns boolean language sql stable set search_path = '' as $$
  select 'pos' = any (r.products) and 'maitre' = any (r.products)
$$;

-- the deposit rule of online bookings only works with the package
create or replace function app.deposit_for(r public.restaurants, p_party int)
returns bigint language sql stable set search_path = '' as $$
  select case when app.has_maitre(r)
               and coalesce((r.booking ->> 'deposit_party')::int, 0) between 1 and p_party
               and coalesce((r.booking ->> 'deposit_cents')::bigint, 0) > 0
              then least(100000000, p_party * (r.booking ->> 'deposit_cents')::bigint) end
$$;

CREATE OR REPLACE FUNCTION public.admin_create_restaurant(p_slug text, p_name text, p_owner_email text DEFAULT NULL::text, p_is_demo boolean DEFAULT false, p_products text[] DEFAULT '{pos,profit}'::text[], p_city text DEFAULT NULL::text, p_theme text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rid uuid; uid uuid; prods text[];
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders', 'loyalty', 'maitre'));
  if prods is null then prods := '{pos,profit}'; end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) and loyalty are included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if 'loyalty' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'loyalty'); end if;
  -- Amplify Maître is an option of the till
  if 'maitre' = any (prods) and not 'pos' = any (prods) then prods := array_remove(prods, 'maitre'); end if;
  if p_theme is not null and p_theme not in ('nuit', 'riad', 'moderne', 'atelier') then perform app.fail('invalid_request', 'theme'); end if;
  insert into public.restaurants (slug, name, is_demo, products, city, site)
  values (lower(p_slug), left(btrim(p_name), 80), p_is_demo, prods, nullif(btrim(p_city), ''),
          case when p_theme is null then '{}'::jsonb else jsonb_build_object('theme', p_theme) end)
  returning id into rid;
  if p_owner_email is not null then
    select id into uid from auth.users where lower(email) = lower(p_owner_email);
    if uid is null then perform app.fail('user_not_found', p_owner_email); end if;
    insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  end if;
  return rid;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_set_products(p_restaurant_id uuid, p_products text[], p_pos_plan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prods text[]; r public.restaurants;
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders', 'loyalty', 'maitre'));
  if prods is null then perform app.fail('invalid_request', 'products'); end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) and loyalty are included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if 'loyalty' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'loyalty'); end if;
  -- Amplify Maître is an option of the till
  if 'maitre' = any (prods) and not 'pos' = any (prods) then prods := array_remove(prods, 'maitre'); end if;
  if p_pos_plan is not null and p_pos_plan not in ('essentiel', 'restaurant') then perform app.fail('invalid_request', 'plan'); end if;
  update public.restaurants set products = prods, pos_plan = coalesce(p_pos_plan, pos_plan)
   where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('products', r.products, 'pos_plan', r.pos_plan,
    'devices', (select count(*) from public.memberships where restaurant_id = r.id and role = 'device'));
end $function$;

CREATE OR REPLACE FUNCTION public.pos_guests(p_restaurant_id uuid, p_ids uuid[] DEFAULT '{}'::uuid[], p_phones text[] DEFAULT '{}'::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  -- the guest profile is part of Amplify Maître
  if not app.has_maitre(r) then return '[]'::jsonb; end if;
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then return '[]'::jsonb; end if;
  if coalesce(cardinality(p_ids), 0) > 200 or coalesce(cardinality(p_phones), 0) > 200 then perform app.fail('invalid_request', 'too_many'); end if;
  return coalesce((
    select jsonb_agg(app.guest_brief(c))
      from public.customers c
     where c.restaurant_id = r.id
       and (c.id = any (coalesce(p_ids, '{}'))
            or c.phone = any (select app.norm_phone(x) from unnest(coalesce(p_phones, '{}')) x))
  ), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.pos_guest(p_restaurant_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; c public.customers; ph text := app.norm_phone(p_phone);
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not app.has_maitre(r) then perform app.fail('maitre_off'); end if;
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  if p_customer_id is not null then
    select * into c from public.customers where restaurant_id = r.id and id = p_customer_id;
  elsif ph is not null then
    select * into c from public.customers where restaurant_id = r.id and phone = ph;
  end if;
  if c.id is null then return null; end if;
  return app.guest_brief(c) || jsonb_build_object(
    'favorites', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'qty', qty) order by qty desc, name)
        from (select l.name, sum(l.quantity)::int qty
                from public.order_lines l join public.orders o on o.id = l.order_id
               where o.restaurant_id = r.id and o.customer_id = c.id and o.status <> 'cancelled'
                 and l.unit_price_cents > 0
               group by l.name order by 2 desc, 1 limit 5) f), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('at', v.created_at, 'total_cents', v.total_cents, 'table', v.label) order by v.created_at desc)
        from (select o.created_at, o.total_cents, t.label
                from public.orders o left join public.dining_tables t on t.id = o.table_id
               where o.restaurant_id = r.id and o.customer_id = c.id and o.status <> 'cancelled' and o.closed_at is not null
               order by o.created_at desc limit 6) v), '[]'::jsonb),
    'bookings', (select jsonb_build_object('seated', count(*) filter (where status = 'seated'),
                                           'no_shows', count(*) filter (where status = 'no_show'),
                                           'cancelled', count(*) filter (where status = 'cancelled'))
                   from public.reservations where restaurant_id = r.id and phone = c.phone));
end $function$;

CREATE OR REPLACE FUNCTION public.pos_guest_save(p_restaurant_id uuid, p_customer_id uuid, p_phone text, p_name text, p_note text, p_allergies text, p_tags text[], p_birthday date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; cid uuid := p_customer_id; tg text[]; al text;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if not app.has_maitre(r) then perform app.fail('maitre_off'); end if;
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  if length(coalesce(p_name, '')) > 60 or length(coalesce(p_note, '')) > 300 or length(coalesce(p_allergies, '')) > 200
     or coalesce(cardinality(p_tags), 0) > 8 then perform app.fail('invalid_request', 'too_long'); end if;
  select coalesce(array_agg(x order by min_i), '{}') into tg
    from (select btrim(x) x, min(i) min_i from unnest(coalesce(p_tags, '{}')) with ordinality u(x, i)
           where btrim(x) <> '' group by btrim(x)) s;
  if exists (select 1 from unnest(tg) x where length(x) > 20) then perform app.fail('invalid_request', 'tag'); end if;
  if p_birthday is not null and (p_birthday > current_date or p_birthday < date '1900-01-01') then perform app.fail('invalid_request', 'birthday'); end if;
  if cid is null then
    cid := app.customer_for(r.id, p_phone, p_name);
    if cid is null then perform app.fail('invalid_phone'); end if;
  elsif not exists (select 1 from public.customers where restaurant_id = r.id and id = cid) then
    perform app.fail('not_found');
  end if;
  al := nullif(btrim(coalesce(p_allergies, '')), '');
  update public.customers set
         name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         allergies = al, tags = tg,
         birthday = coalesce(p_birthday, birthday)
   where restaurant_id = r.id and id = cid;
  return public.pos_guest(r.id, cid, null);
end $function$;

CREATE OR REPLACE FUNCTION public.pos_briefing(p_restaurant_id uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; d date; t0 timestamptz; files boolean;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not app.has_maitre(r) then perform app.fail('maitre_off'); end if;
  d := coalesce(p_day, (now() at time zone r.timezone)::date);
  if d < current_date - 400 or d > current_date + 400 then perform app.fail('invalid_request', 'day'); end if;
  t0 := d::timestamp at time zone r.timezone;
  files := coalesce((r.loyalty ->> 'customers')::boolean, false);
  return jsonb_build_object(
    'day', d,
    'files', files,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'starts_at', b.starts_at, 'status', b.status, 'source', b.source,
          'party_size', b.party_size, 'name', b.name, 'phone', b.phone, 'note', b.note,
          'table', t.label, 'occasion', b.occasion,
          'deposit_cents', b.deposit_cents, 'deposit_state', b.deposit_state, 'deposit_left', app.deposit_left(r.id, b.id),
          'guest', case when files and c.id is not null then app.guest_brief(c) end,
          'no_shows', (select count(*) from public.reservations x
                        where x.restaurant_id = r.id and b.phone is not null and x.phone = b.phone and x.status = 'no_show'),
          -- days until the birthday (0 = today), only within the coming week
          'birthday_in', case when files and c.birthday is not null then (
              select n from (select case when bd >= d then bd - d else (bd + interval '1 year')::date - d end n
                               from (select (c.birthday + make_interval(years => (extract(year from d) - extract(year from c.birthday))::int))::date bd) y) z
               where n between 0 and 6) end
        ) order by b.starts_at, b.name)
        from public.reservations b
        left join public.dining_tables t on t.restaurant_id = r.id and t.id = b.table_id
        left join public.customers c on c.restaurant_id = r.id and c.phone = b.phone
       where b.restaurant_id = r.id and b.kind = 'booking'
         and b.status in ('requested', 'confirmed', 'seated')
         and b.starts_at >= t0 and b.starts_at < t0 + interval '1 day'
    ), '[]'::jsonb)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.pos_deposit_receive(p_reservation_id uuid, p_amount_cents bigint, p_method text, p_ref text DEFAULT NULL::text, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x public.reservations; r public.restaurants;
begin
  select * into x from public.reservations where id = p_reservation_id for update;
  if x.id is null or x.kind <> 'booking' then perform app.fail('not_found'); end if;
  r := app.require_role(x.restaurant_id, 'device', true);
  -- a new deposit needs the package; one already received can always be used, refunded or kept
  if not app.has_maitre(r) then perform app.fail('maitre_off'); end if;
  if x.status in ('cancelled', 'no_show') then perform app.fail('booking_closed'); end if;
  if p_method not in ('cash', 'card', 'transfer') or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000
     or length(coalesce(p_ref, '')) > 64 then perform app.fail('invalid_request'); end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where restaurant_id = r.id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  insert into public.reservation_deposits (restaurant_id, reservation_id, kind, amount_cents, method, ref, staff_id, business_date)
  values (r.id, x.id, 'in', p_amount_cents, p_method, nullif(btrim(coalesce(p_ref, '')), ''), p_staff_id, app.business_date(r));
  update public.reservations
     set deposit_cents = coalesce(deposit_cents, p_amount_cents), deposit_state = 'paid',
         status = case when status = 'requested' then 'confirmed' else status end
   where id = x.id returning * into x;
  return jsonb_build_object('ok', true, 'left_cents', app.deposit_left(r.id, x.id), 'status', x.status);
end $function$;

notify pgrst, 'reload schema';
