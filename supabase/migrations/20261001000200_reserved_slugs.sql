-- =============================================================================
-- 0015 RESERVED ADDRESSES
-- =============================================================================
-- Restaurants live at posamplify.pages.dev/<slug>. Some addresses belong to the
-- website itself (/profit is the Amplify Profit page), so no restaurant may take them.
-- =============================================================================
create or replace function public.slug_available(p_slug text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select lower(p_slug) ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and lower(p_slug) <> all (array['profit', 'pos', 'admin', 'app', 'api', 'www', 'login', 'inscription',
                                      'tarifs', 'prix', 'pricing', 'demo', 'aide', 'help', 'contact', 'blog', 'caisse', 'kassa'])
     and not exists (select 1 from public.restaurants where slug = lower(p_slug))
$$;
