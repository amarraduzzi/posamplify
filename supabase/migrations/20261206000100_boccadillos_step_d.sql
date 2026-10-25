-- Boccadillos mode (stap D): no table question. The guest orders "sur place" on a fixed table called
-- "Sur place" (one per restaurant). Restaurants with the mode off are not affected: place_order is NOT
-- changed, the new function returns null for them and the guest app keeps asking for a table as before.

-- ------------------------------------------------------------ the fixed table
create or replace function app.ensure_boccadillos_table(p_restaurant_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.dining_tables (restaurant_id, label, sort_order)
  values (p_restaurant_id, 'Sur place', 9999)
  on conflict (restaurant_id, label) do nothing
$$;
revoke all on function app.ensure_boccadillos_table(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ platform switch: create the table when switching on
create or replace function public.admin_set_boccadillos(p_restaurant_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants;
begin
  perform app.require_platform_admin();
  if p_on is null then perform app.fail('invalid_request', 'on'); end if;
  update public.restaurants set boccadillos = p_on where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  if p_on then perform app.ensure_boccadillos_table(r.id); end if;
  return jsonb_build_object('boccadillos', r.boccadillos);
end $$;
revoke all on function public.admin_set_boccadillos(uuid, boolean) from public, anon;
grant execute on function public.admin_set_boccadillos(uuid, boolean) to authenticated;

-- restaurants that already have the mode on (also the ones switched on with a plain update)
select app.ensure_boccadillos_table(id) from public.restaurants where boccadillos;

-- ------------------------------------------------------------ public: the code of that table for the guest app
-- Only returns something while the mode is on and the table exists and is active. The code is the one
-- printed on a table QR anyway; place_order checks it like any other table code.
create or replace function public.get_boccadillos_table(p_slug text)
returns text language sql stable security definer set search_path = '' as $$
  select t.qr_token
    from public.restaurants r
    join public.dining_tables t on t.restaurant_id = r.id and t.label = 'Sur place' and t.active
   where r.slug = lower(p_slug) and r.status <> 'cancelled' and r.boccadillos
   limit 1
$$;
revoke all on function public.get_boccadillos_table(text) from public;
grant execute on function public.get_boccadillos_table(text) to anon, authenticated;
