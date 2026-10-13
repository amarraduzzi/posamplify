-- Amplify Commandes: guest orders land on a web page (no till needed).
--
-- * restaurants.products may now hold 'orders'. A restaurant with POS has it included.
--   A restaurant with 'orders' takes guest orders from the QR menu / its online ordering
--   and handles them on the "Commandes" page of the back office.
-- * Guests can order when the restaurant has POS (restaurant plan) or Commandes.
-- * inbox_refuse: refuse an order that has not been prepared yet (no staff PIN: the page is
--   used by the owner or a manager of the restaurant).
-- Accepting and the next steps are plain status updates the owner/manager may already make.
-- Safe to run on a live database: no restaurant has the new product until the platform sets it.

alter table public.restaurants drop constraint if exists restaurants_products_check;
alter table public.restaurants add constraint restaurants_products_check
  check (products <@ array['pos', 'profit', 'site', 'orders']::text[] and cardinality(products) between 1 and 4);

create or replace function app.qr_ordering(r public.restaurants)
returns boolean language sql stable set search_path = '' as $$
  select app.is_writable(r)
     and (('pos' = any (r.products) and r.pos_plan <> 'essentiel') or 'orders' = any (r.products))
$$;

-- ------------------------------------------------------------ platform functions
create or replace function public.admin_set_products(p_restaurant_id uuid, p_products text[], p_pos_plan text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prods text[]; r public.restaurants;
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders'));
  if prods is null then perform app.fail('invalid_request', 'products'); end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) is included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if p_pos_plan is not null and p_pos_plan not in ('essentiel', 'restaurant') then perform app.fail('invalid_request', 'plan'); end if;
  update public.restaurants set products = prods, pos_plan = coalesce(p_pos_plan, pos_plan)
   where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('products', r.products, 'pos_plan', r.pos_plan,
    'devices', (select count(*) from public.memberships where restaurant_id = r.id and role = 'device'));
end $$;
revoke all on function public.admin_set_products(uuid, text[], text) from public, anon;
grant execute on function public.admin_set_products(uuid, text[], text) to authenticated;

drop function if exists public.admin_create_restaurant(text, text, text, boolean, text[], text, text);
create or replace function public.admin_create_restaurant(
  p_slug text, p_name text, p_owner_email text default null, p_is_demo boolean default false,
  p_products text[] default '{pos,profit}', p_city text default null, p_theme text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare rid uuid; uid uuid; prods text[];
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders'));
  if prods is null then prods := '{pos,profit}'; end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) is included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if p_theme is not null and p_theme not in ('nuit', 'riad', 'moderne') then perform app.fail('invalid_request', 'theme'); end if;
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
end $$;
revoke all on function public.admin_create_restaurant(text, text, text, boolean, text[], text, text) from public, anon;
grant execute on function public.admin_create_restaurant(text, text, text, boolean, text[], text, text) to authenticated;

-- ------------------------------------------------------------ refuse an order
create or replace function public.inbox_refuse(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'manager', true);
  if o.source <> 'qr' then perform app.fail('invalid_request', 'source'); end if;
  if o.closed_at is not null then perform app.fail('order_closed_use_credit_note'); end if;
  if o.status = 'cancelled' then return jsonb_build_object('ok', true); end if;
  if o.status not in ('new', 'preparing') then perform app.fail('invalid_request', 'status'); end if;
  if exists (select 1 from public.payments where restaurant_id = o.restaurant_id and order_id = o.id) then
    perform app.fail('remove_payments_first');
  end if;
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200)
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.inbox_refuse(uuid, text) from public, anon;
grant execute on function public.inbox_refuse(uuid, text) to authenticated;
