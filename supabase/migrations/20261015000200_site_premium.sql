-- =============================================================================
-- Premium websites (Maison, Signature)
-- * restaurants.site_plan: 'basic' (the four styles) or 'premium' (also Maison and Signature). Only the
--   platform sets it, once the premium site is paid; the owner cannot change it (no column grant).
-- * A request from the website (a group, a private event, catering): it arrives as a catering quote
--   marked "from the website", for the restaurant to answer. Protected against abuse: a hidden field,
--   valid phone and date, at most 3 requests per phone and 30 per restaurant per day.
-- =============================================================================

alter table public.restaurants add column if not exists site_plan text not null default 'basic' check (site_plan in ('basic', 'premium'));

create or replace function public.admin_set_site_plan(p_restaurant_id uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if p_plan not in ('basic', 'premium') then perform app.fail('invalid_request', 'plan'); end if;
  update public.restaurants set site_plan = p_plan where id = p_restaurant_id;
  if not found then perform app.fail('not_found'); end if;
  return jsonb_build_object('ok', true, 'site_plan', p_plan);
end $$;
revoke all on function public.admin_set_site_plan(uuid, text) from public, anon;
grant execute on function public.admin_set_site_plan(uuid, text) to authenticated;

alter table public.catering_orders add column if not exists source text not null default 'manual' check (source in ('manual', 'site'));
alter table public.catering_orders add column if not exists kind text check (kind in ('group', 'private', 'catering', 'other'));

create or replace function public.site_request(
  p_slug text, p_host text, p_name text, p_phone text, p_date date, p_guests integer, p_kind text, p_message text, p_trap text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; host text := lower(regexp_replace(coalesce(p_host, ''), '^www\.', '')); ph text; c public.catering_orders;
begin
  -- a robot fills the hidden field: say yes, keep nothing
  if coalesce(p_trap, '') <> '' then return jsonb_build_object('ok', true); end if;
  if host <> '' then
    select * into r from public.restaurants where lower(regexp_replace(site ->> 'domain', '^www\.', '')) = host and status <> 'cancelled';
  else
    select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  end if;
  if r.id is null or r.site_plan <> 'premium' or not app.is_writable(r) then perform app.fail('not_found'); end if;
  if coalesce((r.site ->> 'request')::boolean, true) = false then perform app.fail('not_found'); end if;
  if length(btrim(coalesce(p_name, ''))) not between 2 and 80 then perform app.fail('invalid_request', 'name'); end if;
  ph := regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g');
  if ph !~ '^\+?[0-9]{9,15}$' then perform app.fail('invalid_request', 'phone'); end if;
  if p_date is null or p_date < app.business_date(r) or p_date > app.business_date(r) + 400 then perform app.fail('invalid_request', 'date'); end if;
  if p_guests is not null and p_guests not between 1 and 5000 then perform app.fail('invalid_request', 'guests'); end if;
  if p_kind not in ('group', 'private', 'catering', 'other') then perform app.fail('invalid_request', 'kind'); end if;
  if length(coalesce(p_message, '')) > 800 then perform app.fail('invalid_request', 'message'); end if;
  if (select count(*) from public.catering_orders where restaurant_id = r.id and source = 'site' and created_at > now() - interval '1 day') >= 30
     or (select count(*) from public.catering_orders where restaurant_id = r.id and source = 'site' and customer_phone = ph and created_at > now() - interval '1 day') >= 3 then
    perform app.fail('too_many_requests');
  end if;
  insert into public.catering_orders (restaurant_id, number, status, source, kind, customer_name, customer_phone, event_date, guests, note)
  values (r.id, 0, 'quote', 'site', p_kind, left(btrim(p_name), 80), ph, p_date, p_guests, nullif(left(btrim(coalesce(p_message, '')), 800), ''))
  returning * into c;
  return jsonb_build_object('ok', true, 'number', c.number);
end $$;
revoke all on function public.site_request(text, text, text, text, date, integer, text, text, text) from public;
grant execute on function public.site_request(text, text, text, text, date, integer, text, text, text) to anon, authenticated;

-- the website receives its plan (premium styles)
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
    'can_order', app.qr_ordering(r) and (r.accept_takeaway or r.accept_delivery),
    'site_plan', r.site_plan);
end $$;
revoke all on function public.get_site(text, text) from public;
grant execute on function public.get_site(text, text) to anon, authenticated;
