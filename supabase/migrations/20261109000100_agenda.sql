-- =============================================================================
-- AMPLIFY AGENDA (1): salons, the foundation
--
-- A new product of the platform, for hair salons, barbers and beauty institutes: appointments per
-- staff member. Same accounts, same back office, same languages; switched on per business from the
-- platform (products 'agenda'). This first part: what the salon offers and who works when.
--   agenda_services   the prestations: name (fr/ar/en), category, duration, price, bookable online
--   staff             a member takes appointments (agenda), works these hours, does these prestations
--   agenda_time_off   a day off, a holiday, a closed salon (staff_id null)
-- =============================================================================

alter table public.restaurants drop constraint if exists restaurants_products_check;
alter table public.restaurants add constraint restaurants_products_check
  check (products <@ array['pos', 'profit', 'site', 'orders', 'loyalty', 'maitre', 'agenda'] and cardinality(products) between 1 and 7);

create or replace function app.has_agenda(r public.restaurants)
returns boolean language sql stable set search_path = '' as $$ select 'agenda' = any (r.products) $$;

-- weekly hours, the same days as the opening hours: {"mon": [["09:00","13:00"], ["14:00","19:00"]], ...},
-- at most 3 periods a day, never past midnight (a salon does not work the night)
create or replace function app.valid_week_hours(h jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(h) = 'object'
     and not exists (
       select 1 from jsonb_each(h) d
        where d.key not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') or jsonb_typeof(d.value) <> 'array' or jsonb_array_length(d.value) > 3
           or exists (select 1 from jsonb_array_elements(d.value) p
                       where jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2
                          or (p ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (p ->> 1) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$'
                          or (p ->> 0) >= (p ->> 1)))
$$;

create table if not exists public.agenda_services (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null check (jsonb_typeof(name) = 'object' and length(coalesce(name ->> 'fr', name ->> 'ar', name ->> 'en', '')) between 1 and 60),
  description   jsonb not null default '{}'::jsonb check (jsonb_typeof(description) = 'object' and length(description::text) <= 1200),
  category      text check (length(category) <= 30),
  duration_min  integer not null default 30 check (duration_min between 5 and 600),
  -- time to clean and prepare after the appointment, not shown to the client
  buffer_min    integer not null default 0 check (buffer_min between 0 and 120),
  price_cents   bigint not null default 0 check (price_cents between 0 and 10000000),
  -- "à partir de": the price depends on the hair, the length...
  price_from    boolean not null default false,
  online        boolean not null default true,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
create index if not exists agenda_services_idx on public.agenda_services (restaurant_id, active, sort_order);
drop trigger if exists agenda_services_same_tenant on public.agenda_services;
create trigger agenda_services_same_tenant before update on public.agenda_services
  for each row execute function app.forbid_restaurant_change();
alter table public.agenda_services enable row level security;
grant select, insert, update, delete on public.agenda_services to authenticated;
drop policy if exists agenda_services_select on public.agenda_services;
drop policy if exists agenda_services_write on public.agenda_services;
create policy agenda_services_select on public.agenda_services for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy agenda_services_write on public.agenda_services for all to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

-- the staff of the salon: who takes appointments, when, for what
alter table public.staff
  add column if not exists agenda boolean not null default false,
  add column if not exists agenda_hours jsonb not null default '{}'::jsonb,
  -- empty: every prestation
  add column if not exists agenda_services uuid[] not null default '{}',
  add column if not exists agenda_color text check (agenda_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists agenda_sort integer not null default 0;
alter table public.staff drop constraint if exists staff_agenda_hours_check;
alter table public.staff add constraint staff_agenda_hours_check check (app.valid_week_hours(agenda_hours));

create table if not exists public.agenda_time_off (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  -- null: the whole salon is closed
  staff_id      uuid,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  reason        text check (length(reason) <= 80),
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '120 days'),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete cascade
);
create index if not exists agenda_time_off_idx on public.agenda_time_off (restaurant_id, starts_at);
alter table public.agenda_time_off enable row level security;
grant select, insert, update, delete on public.agenda_time_off to authenticated;
drop policy if exists agenda_time_off_select on public.agenda_time_off;
drop policy if exists agenda_time_off_write on public.agenda_time_off;
create policy agenda_time_off_select on public.agenda_time_off for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy agenda_time_off_write on public.agenda_time_off for all to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

-- the platform creates and switches the product like the others
CREATE OR REPLACE FUNCTION public.admin_create_restaurant(p_slug text, p_name text, p_owner_email text DEFAULT NULL::text, p_is_demo boolean DEFAULT false, p_products text[] DEFAULT '{pos,profit}'::text[], p_city text DEFAULT NULL::text, p_theme text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rid uuid; uid uuid; prods text[];
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders', 'loyalty', 'maitre', 'agenda'));
  if prods is null then prods := '{pos,profit}'; end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) and loyalty are included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if 'loyalty' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'loyalty'); end if;
  -- Amplify Maître is an option of the till
  if 'maitre' = any (prods) and not 'pos' = any (prods) then prods := array_remove(prods, 'maitre'); end if;
  if prods = '{}' or prods is null then prods := '{pos,profit}'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.admin_set_products(p_restaurant_id uuid, p_products text[], p_pos_plan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prods text[]; r public.restaurants;
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders', 'loyalty', 'maitre', 'agenda'));
  if prods is null then perform app.fail('invalid_request', 'products'); end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) and loyalty are included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if 'loyalty' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'loyalty'); end if;
  -- Amplify Maître is an option of the till
  if 'maitre' = any (prods) and not 'pos' = any (prods) then prods := array_remove(prods, 'maitre'); end if;
  if prods = '{}' then perform app.fail('invalid_request', 'products'); end if;
  if p_pos_plan is not null and p_pos_plan not in ('essentiel', 'restaurant') then perform app.fail('invalid_request', 'plan'); end if;
  update public.restaurants set products = prods, pos_plan = coalesce(p_pos_plan, pos_plan)
   where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('products', r.products, 'pos_plan', r.pos_plan,
    'devices', (select count(*) from public.memberships where restaurant_id = r.id and role = 'device'));
end $function$;

notify pgrst, 'reload schema';
