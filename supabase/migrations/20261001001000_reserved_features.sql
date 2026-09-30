-- =============================================================================
-- 0023 RESERVED ADDRESS: /fonctionnalites is the "all features" page of the website
-- =============================================================================
create or replace function public.slug_available(p_slug text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select lower(p_slug) ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and lower(p_slug) <> all (array['profit', 'pos', 'admin', 'app', 'api', 'www', 'login', 'inscription',
                                      'tarifs', 'prix', 'pricing', 'demo', 'aide', 'help', 'contact', 'blog', 'caisse', 'kassa',
                                      'fonctionnalites', 'features', 'serveur'])
     and not exists (select 1 from public.restaurants where slug = lower(p_slug))
$$;
