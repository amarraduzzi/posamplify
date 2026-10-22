-- =============================================================================
-- AMPLIFY AGENDA (8): the salon's website (module "Site du salon", product 'site' on a salon)
--
-- Same website service as the restaurants, its own page: the prestations and prices instead of a
-- menu, the team, before/after photos, the Google reviews link, the live wait of the Nouba and the
-- booking button. Before/after photos are only shown when the salon ticked that the client agreed
-- (site.before_after[].consent); without it a photo never leaves the back office.
-- =============================================================================

create or replace function app.is_salon(r public.restaurants)
returns boolean language sql immutable set search_path = '' as $$
  select 'agenda' = any (r.products) and not ('pos' = any (r.products) or 'profit' = any (r.products) or 'orders' = any (r.products))
$$;

create or replace function app.salon_site(r public.restaurants)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', 'salon',
    'restaurant', jsonb_build_object('slug', r.slug, 'name', r.name, 'city', r.city, 'address', r.address, 'phone', r.phone,
                                     'currency', r.currency, 'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding,
                                     'opening_hours', r.opening_hours),
    'site', (r.site - 'domain' - 'before_after') || jsonb_build_object('before_after', coalesce((
        select jsonb_agg(e - 'consent') from jsonb_array_elements(coalesce(r.site -> 'before_after', '[]'::jsonb)) e
         where coalesce((e ->> 'consent')::boolean, false) and e ->> 'before' like 'https://%' and e ->> 'after' like 'https://%'), '[]'::jsonb)),
    'domain', nullif(r.site ->> 'domain', ''),
    'noindex', not coalesce((r.site ->> 'enabled')::boolean, false),
    'booking', (app.agenda_cfg(r) ->> 'enabled')::boolean and app.is_writable(r),
    'nouba', (app.agenda_cfg(r) ->> 'queue')::boolean and app.is_writable(r),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'description', v.description, 'category', v.category,
        'duration_min', v.duration_min, 'price_cents', v.price_cents, 'price_from', v.price_from, 'online', v.online) order by v.sort_order, v.created_at)
      from public.agenda_services v where v.restaurant_id = r.id and v.active), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('name', s.name, 'color', s.agenda_color) order by s.agenda_sort, s.name)
      from public.staff s where s.restaurant_id = r.id and s.active and s.agenda), '[]'::jsonb))
$$;

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
  -- a salon: its own page, with the module "Site du salon"
  if app.is_salon(r) then
    if not 'site' = any (r.products) then return null; end if;
    if not app.is_writable(r) then
      return jsonb_build_object('paused', true, 'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'city', r.city));
    end if;
    return app.salon_site(r);
  end if;
  -- the website alone, not paid (trial over or suspended): a pause page
  if r.products = '{site}' and not app.is_writable(r) then
    return jsonb_build_object('paused', true, 'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'city', r.city));
  end if;
  m := public.get_menu(r.slug, null);
  if m is null then return null; end if;
  return m || jsonb_build_object(
    'site', r.site - 'domain',
    'domain', nullif(r.site ->> 'domain', ''),
    'noindex', not coalesce((r.site ->> 'enabled')::boolean, false),
    'booking', coalesce((r.booking ->> 'enabled')::boolean, false),
    'can_order', app.qr_ordering(r) and (r.accept_takeaway or r.accept_delivery),
    'site_plan', case when app.site_premium(r) then 'premium' else 'basic' end);
end $$;
revoke all on function public.get_site(text, text) from public;
grant execute on function public.get_site(text, text) to anon, authenticated;
revoke all on function app.salon_site(public.restaurants) from public, anon, authenticated;

-- the live wait on the salon's website (its own domain knows the host, not the slug)
create or replace function public.salon_wait(p_slug text, p_host text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; host text := lower(regexp_replace(coalesce(p_host, ''), '^www\.', '')); i jsonb;
begin
  if host <> '' then
    select * into r from public.restaurants where lower(regexp_replace(site ->> 'domain', '^www\.', '')) = host and status <> 'cancelled';
  else
    select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  end if;
  if r.id is null then return null; end if;
  i := public.nouba_info(r.slug);
  if i is null or not coalesce((i ->> 'enabled')::boolean, false) then return jsonb_build_object('enabled', false); end if;
  return jsonb_build_object('enabled', true, 'open', i -> 'open', 'wait_min', i -> 'wait_min', 'waiting', i -> 'waiting', 'remote', i -> 'remote');
end $$;
revoke all on function public.salon_wait(text, text) from public;
grant execute on function public.salon_wait(text, text) to anon, authenticated;

-- the salon's page counts its visits like the restaurant sites, plus the places taken in the Nouba
alter table public.site_events drop constraint if exists site_events_kind_check;
alter table public.site_events add constraint site_events_kind_check
  check (kind in ('view', 'menu', 'call', 'directions', 'wa_order', 'order', 'book', 'queue'));
create or replace function public.site_track(p_slug text, p_host text, p_kind text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; host text := lower(regexp_replace(coalesce(p_host, ''), '^www\.', ''));
begin
  if p_kind is null or p_kind not in ('view', 'menu', 'call', 'directions', 'wa_order', 'order', 'book', 'queue') then return; end if;
  if host <> '' then
    select * into r from public.restaurants where lower(regexp_replace(site ->> 'domain', '^www\.', '')) = host and status <> 'cancelled';
  else
    select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  end if;
  if r.id is null then return; end if;
  insert into public.site_events as e (restaurant_id, day, kind, n)
  values (r.id, (now() at time zone coalesce(nullif(r.timezone, ''), 'Africa/Casablanca'))::date, p_kind, 1)
  on conflict (restaurant_id, day, kind) do update set n = least(e.n + 1, 1000000);
end $$;
revoke all on function public.site_track(text, text, text) from public;
grant execute on function public.site_track(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
