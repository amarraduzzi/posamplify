-- =============================================================================
-- Website: a fourth style, "atelier" (pâtisserie, boulangerie, traiteur). The style itself lives in the
-- site renderer; here the platform can create a site demo with it.
-- =============================================================================

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
end $$;
revoke all on function public.admin_create_restaurant(text, text, text, boolean, text[], text, text) from public, anon;
grant execute on function public.admin_create_restaurant(text, text, text, boolean, text[], text, text) to authenticated;
