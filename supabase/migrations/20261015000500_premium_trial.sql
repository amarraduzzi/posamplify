-- =============================================================================
-- Premium websites can be tried for free
-- * During the free trial a restaurant can use the premium styles (Maison, Signature) and their request
--   form, to fill in its story before paying. Once the trial is over, only a paid premium site
--   (site_plan = 'premium', set by Amplify) keeps them; otherwise the site shows the Moderne style.
-- =============================================================================

create or replace function app.site_premium(r public.restaurants)
returns boolean language sql stable set search_path = '' as $$
  select r.site_plan = 'premium' or (r.status = 'trial' and (r.trial_ends_at is null or r.trial_ends_at > now()));
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
    -- premium styles also during the free trial (to try them before paying)
    'site_plan', case when app.site_premium(r) then 'premium' else 'basic' end);
end $$;
revoke all on function public.get_site(text, text) from public;
grant execute on function public.get_site(text, text) to anon, authenticated;

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
  if r.id is null or not app.site_premium(r) or not app.is_writable(r) then perform app.fail('not_found'); end if;
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
