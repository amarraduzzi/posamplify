-- =============================================================================
-- Restaurant websites
-- Each restaurant can switch on a website, rendered on the server for Google (Cloudflare),
-- at site.amplifygrowthstudio.com/<slug> or on its own domain.
-- restaurants.site: { enabled, theme, about {fr,ar,en}, gallery [urls], cuisine, price_range,
--   instagram, facebook, tiktok, maps_url, domain }
-- Logo, cover photo, tagline and colour stay in restaurants.branding.
-- get_site: the public data of a site, by slug or by domain. A site not switched on yet
-- can be previewed but is marked noindex (Google does not list it).
-- =============================================================================
alter table public.restaurants add column if not exists site jsonb not null default '{}'::jsonb
  check (jsonb_typeof(site) = 'object');
grant update (site) on public.restaurants to authenticated;
create unique index if not exists restaurants_site_domain_idx on public.restaurants (lower(site ->> 'domain')) where coalesce(site ->> 'domain', '') <> '';

create or replace function public.get_site(p_slug text, p_host text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; host text := lower(regexp_replace(coalesce(p_host, ''), '^www\.', '')); m jsonb;
begin
  if host <> '' then
    select * into r from public.restaurants where lower(regexp_replace(site ->> 'domain', '^www\.', '')) = host and status <> 'cancelled';
  else
    select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  end if;
  -- not switched on yet: still shown (to preview it), but hidden from Google
  if r.id is null then return null; end if;
  m := public.get_menu(r.slug, null);
  if m is null then return null; end if;
  return m || jsonb_build_object(
    'site', r.site - 'domain',
    'domain', nullif(r.site ->> 'domain', ''),
    'noindex', not coalesce((r.site ->> 'enabled')::boolean, false),
    'booking', coalesce((r.booking ->> 'enabled')::boolean, false),
    'can_order', app.qr_ordering(r) and (r.accept_takeaway or r.accept_delivery));
end $$;
revoke all on function public.get_site(text, text) from public;
grant execute on function public.get_site(text, text) to anon, authenticated;
