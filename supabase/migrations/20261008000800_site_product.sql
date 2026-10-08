-- =============================================================================
-- Amplify Site: the restaurant website sold on its own
-- * restaurants.products may now hold 'site'. A restaurant with POS or Profit has the website
--   included; products = {site} is a restaurant that only has the website (and its menu).
-- * signup_restaurant: a sign-up from the website page "Site web" (?produit=site) creates a
--   site-only restaurant with its website switched on, 14 days free.
-- * admin_create_restaurant: the platform can pick the products and the style, for example to
--   prepare a demo website before visiting a restaurant (not on Google until switched on).
-- * get_site: a site-only restaurant whose trial ended or that is suspended shows a pause page
--   (restaurants with POS keep their site, like their menu).
-- =============================================================================
alter table public.restaurants drop constraint if exists restaurants_products_check;
alter table public.restaurants add constraint restaurants_products_check
  check (products <@ array['pos', 'profit', 'site']::text[] and cardinality(products) between 1 and 3);

create or replace function public.signup_restaurant(p_name text, p_slug text, p_city text default null,
                                                    p_products text[] default '{pos,profit}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); rid uuid; prods text[];
begin
  if uid is null or app.is_anonymous() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 3 then
    perform app.fail('too_many_restaurants');
  end if;
  if nullif(btrim(p_name), '') is null then perform app.fail('name_required'); end if;
  if not public.slug_available(p_slug) then perform app.fail('slug_taken'); end if;
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site'));
  -- the website alone, or POS / Profit (the website is included with those)
  if prods is null or cardinality(prods) = 0 then prods := '{pos,profit}';
  elsif 'site' = any (prods) and cardinality(prods) > 1 then prods := array_remove(prods, 'site');
  end if;

  insert into public.restaurants (slug, name, city, status, trial_ends_at, timezone, languages,
                                  accept_dine_in, accept_takeaway, branding, products, site)
  values (lower(p_slug), left(btrim(p_name), 80), nullif(btrim(p_city), ''), 'trial', app.trial_end(),
          'UTC', '{fr,ar,en}', true, true,
          -- site only: no colour, the style's own colours look best (the owner can still pick one)
          case when prods = '{site}' then '{"theme":"light"}'::jsonb else '{"primary_color":"#C2410C","theme":"light"}'::jsonb end, prods,
          case when prods = '{site}' then '{"enabled":true,"theme":"riad"}'::jsonb else '{}'::jsonb end)
  returning id into rid;
  insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  return rid;
end $$;
revoke all on function public.signup_restaurant(text, text, text, text[]) from public, anon;
grant execute on function public.signup_restaurant(text, text, text, text[]) to authenticated;

create or replace function public.admin_set_products(p_restaurant_id uuid, p_products text[], p_pos_plan text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prods text[]; r public.restaurants;
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site'));
  if prods is null then perform app.fail('invalid_request', 'products'); end if;
  if 'site' = any (prods) and cardinality(prods) > 1 then prods := array_remove(prods, 'site'); end if;
  if p_pos_plan is not null and p_pos_plan not in ('essentiel', 'restaurant') then perform app.fail('invalid_request', 'plan'); end if;
  update public.restaurants set products = prods, pos_plan = coalesce(p_pos_plan, pos_plan)
   where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('products', r.products, 'pos_plan', r.pos_plan,
    'devices', (select count(*) from public.memberships where restaurant_id = r.id and role = 'device'));
end $$;
revoke all on function public.admin_set_products(uuid, text[], text) from public, anon;
grant execute on function public.admin_set_products(uuid, text[], text) to authenticated;

drop function if exists public.admin_create_restaurant(text, text, text, boolean);
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
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site'));
  if prods is null then prods := '{pos,profit}'; end if;
  if 'site' = any (prods) and cardinality(prods) > 1 then prods := array_remove(prods, 'site'); end if;
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

create or replace function public.get_site(p_slug text, p_host text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; host text := lower(regexp_replace(coalesce(p_host, ''), '^www\.', '')); m jsonb;
begin
  if host <> '' then
    select * into r from public.restaurants where lower(regexp_replace(site ->> 'domain', '^www\.', '')) = host and status <> 'cancelled';
  else
    select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  end if;
  if r.id is null then return null; end if;
  -- the website alone, not paid (trial over or suspended): a pause page
  if r.products = '{site}' and not app.is_writable(r) then
    return jsonb_build_object('paused', true, 'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'city', r.city));
  end if;
  m := public.get_menu(r.slug, null);
  if m is null then return null; end if;
  return m || jsonb_build_object(
    'site', r.site - 'domain',
    'domain', nullif(r.site ->> 'domain', ''),
    -- not on Google until switched on
    'noindex', not coalesce((r.site ->> 'enabled')::boolean, false),
    'booking', coalesce((r.booking ->> 'enabled')::boolean, false),
    'can_order', app.qr_ordering(r) and (r.accept_takeaway or r.accept_delivery));
end $$;
revoke all on function public.get_site(text, text) from public;
grant execute on function public.get_site(text, text) to anon, authenticated;
