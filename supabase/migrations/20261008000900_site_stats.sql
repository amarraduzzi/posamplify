-- =============================================================================
-- Website statistics, without cookies
-- * site_events: per restaurant, per day and per kind, a counter. Nothing about the visitor is
--   kept (no IP, no cookie, no id): only "12 visits and 3 calls on Tuesday".
-- * site_track (anon): the website adds one to a counter (it calls this through its own server).
-- * site_stats: the owner's figures for the last N days, with the N days before to compare.
-- * admin_site_leads: for Amplify, the restaurants whose website brings guests, warmest first
--   (WhatsApp orders, then visits): who to call about the till.
-- Kinds: view (a page of the site), menu (the menu page), call, directions, wa_order (a basket
-- sent on WhatsApp), order (to online ordering), book (to the booking page).
-- =============================================================================
create table if not exists public.site_events (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  day           date not null,
  kind          text not null check (kind in ('view', 'menu', 'call', 'directions', 'wa_order', 'order', 'book')),
  n             int not null default 0 check (n >= 0),
  primary key (restaurant_id, day, kind)
);
alter table public.site_events enable row level security;
grant select on public.site_events to authenticated;
drop policy if exists site_events_select on public.site_events;
create policy site_events_select on public.site_events for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

create or replace function public.site_track(p_slug text, p_host text, p_kind text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; host text := lower(regexp_replace(coalesce(p_host, ''), '^www\.', ''));
begin
  if p_kind is null or p_kind not in ('view', 'menu', 'call', 'directions', 'wa_order', 'order', 'book') then return; end if;
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

create or replace function public.site_stats(p_restaurant_id uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; today date; d int := greatest(1, least(coalesce(p_days, 30), 366));
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  today := (now() at time zone coalesce(nullif(r.timezone, ''), 'Africa/Casablanca'))::date;
  return jsonb_build_object(
    'days', d, 'today', today,
    'totals', (select coalesce(jsonb_object_agg(kind, s), '{}'::jsonb) from (
                 select kind, sum(n) s from public.site_events where restaurant_id = r.id and day > today - d group by kind) x),
    'previous', (select coalesce(jsonb_object_agg(kind, s), '{}'::jsonb) from (
                 select kind, sum(n) s from public.site_events where restaurant_id = r.id and day > today - 2 * d and day <= today - d group by kind) x),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', g::date, 'views', coalesce(v.n, 0)) order by g), '[]'::jsonb)
                from generate_series(today - d + 1, today, interval '1 day') g
                left join (select day, sum(n) n from public.site_events where restaurant_id = r.id and kind in ('view', 'menu') group by day) v on v.day = g::date)
  );
end $$;
revoke all on function public.site_stats(uuid, int) from public, anon;
grant execute on function public.site_stats(uuid, int) to authenticated;

create or replace function public.admin_site_leads(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d int := greatest(1, least(coalesce(p_days, 30), 366));
begin
  perform app.require_platform_admin();
  return (select coalesce(jsonb_agg(x order by x.wa_order desc, x.views desc), '[]'::jsonb) from (
    select r.id, r.name, r.slug, r.city, r.phone, r.owner_whatsapp, r.products, r.status, r.trial_ends_at,
           coalesce(sum(e.n) filter (where e.kind in ('view', 'menu')), 0) views,
           coalesce(sum(e.n) filter (where e.kind = 'wa_order'), 0) wa_order,
           coalesce(sum(e.n) filter (where e.kind = 'call'), 0) calls,
           coalesce(sum(e.n) filter (where e.kind = 'directions'), 0) directions,
           coalesce(sum(e.n) filter (where e.kind in ('order', 'book')), 0) online
      from public.restaurants r
      join public.site_events e on e.restaurant_id = r.id and e.day > current_date - d
     where r.status <> 'cancelled' and not r.is_demo
     group by r.id
  ) x);
end $$;
revoke all on function public.admin_site_leads(int) from public, anon;
grant execute on function public.admin_site_leads(int) to authenticated;
