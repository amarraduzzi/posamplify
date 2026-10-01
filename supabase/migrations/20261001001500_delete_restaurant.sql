-- Platform: delete a client restaurant for good, with everything in it.
-- Safety: platform admins only, the restaurant must be suspended (or cancelled) first,
-- and the slug must be typed again. The till logins of that restaurant go too.
-- Fiscal tickets are deleted with it: export the sales first (Ventes > CSV).
create or replace function public.admin_delete_restaurant(p_restaurant_id uuid, p_confirm_slug text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; tickets int; devices uuid[];
begin
  perform app.require_platform_admin();
  select * into r from public.restaurants where id = p_restaurant_id for update;
  if r.id is null then perform app.fail('not_found'); end if;
  if lower(btrim(coalesce(p_confirm_slug, ''))) <> r.slug then perform app.fail('confirm_slug_mismatch'); end if;
  if not r.is_demo and r.status not in ('paused', 'cancelled') then perform app.fail('suspend_first'); end if;
  select count(*)::int into tickets from public.fiscal_documents where restaurant_id = r.id;
  -- till accounts that belong to this restaurant only
  select coalesce(array_agg(m.user_id), '{}') into devices from public.memberships m
   where m.restaurant_id = r.id and m.role = 'device'
     and not exists (select 1 from public.memberships x where x.user_id = m.user_id and x.restaurant_id <> r.id)
     and not exists (select 1 from public.platform_admins p where p.user_id = m.user_id);
  perform set_config('app.purge', 'on', true);
  delete from public.restaurants where id = r.id;
  perform set_config('app.purge', 'off', true);
  delete from auth.users where id = any (devices);
  return jsonb_build_object('ok', true, 'slug', r.slug, 'tickets_deleted', tickets, 'till_logins_deleted', coalesce(array_length(devices, 1), 0));
end $$;
revoke all on function public.admin_delete_restaurant(uuid, text) from public, anon;
grant execute on function public.admin_delete_restaurant(uuid, text) to authenticated;
