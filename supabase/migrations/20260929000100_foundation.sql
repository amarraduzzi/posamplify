-- =============================================================================
-- 0001 FOUNDATION: tenants, users, roles, staff, tables, counters
-- =============================================================================
-- Principles used throughout all migrations:
--   * Every tenant table has restaurant_id NOT NULL plus UNIQUE (restaurant_id, id).
--     Child tables reference parents with COMPOSITE foreign keys
--     (restaurant_id, parent_id), so a row of restaurant A can never point to a
--     row of restaurant B, even if someone guesses a UUID.
--   * Row level security is enabled on EVERY table. Supabase grants anon and
--     authenticated full table privileges by default, RLS is the real wall.
--   * Money is stored as integer centimes (bigint). Never floats.
--   * Internal helpers live in schema "app", which is NOT exposed through the
--     Supabase API. Only functions in "public" are callable from the browser.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.restaurant_status as enum ('trial', 'active', 'paused', 'cancelled');
create type public.member_role       as enum ('device', 'manager', 'owner');
create type public.staff_role        as enum ('staff', 'manager');

-- -----------------------------------------------------------------------------
-- Generic helpers (no table dependencies)
-- -----------------------------------------------------------------------------

-- Current Supabase user id, or null for anon.
create or replace function app.uid()
returns uuid
language sql stable
set search_path = ''
as $$ select auth.uid() $$;

-- True when the current statement runs directly on behalf of a browser client
-- (PostgREST switches to role anon / authenticated). Inside a SECURITY DEFINER
-- function current_user is the function owner, so this is false there. Triggers
-- use it to protect columns that only server functions may change.
create or replace function app.is_client()
returns boolean
language sql stable
set search_path = ''
as $$ select current_user in ('anon', 'authenticated') $$;

-- URL-safe random token, used for QR table codes.
create or replace function app.random_token(len int default 10)
returns text
language plpgsql volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789'; -- no 0/o/1/l
  bytes bytea := extensions.gen_random_bytes(len);
  result text := '';
begin
  for i in 0 .. len - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end $$;

-- Validates a translated text object like {"fr": "...", "en": "...", "ar": "..."}.
create or replace function app.valid_i18n(v jsonb, max_len int default 200)
returns boolean
language sql immutable
set search_path = ''
as $$
  select v is not null
     and jsonb_typeof(v) = 'object'
     and not exists (
       select 1 from jsonb_each(v) e
       where e.key !~ '^[a-z]{2}$'
          or jsonb_typeof(e.value) <> 'string'
          or length(e.value #>> '{}') > max_len
     )
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$ begin new.updated_at := now(); return new; end $$;

-- Rows may never move between restaurants.
create or replace function app.forbid_restaurant_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'restaurant_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Restaurants (the tenant)
-- -----------------------------------------------------------------------------
create table public.restaurants (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name            text not null check (length(name) between 1 and 80),

  -- lifecycle / billing (only platform admins can change these)
  status          public.restaurant_status not null default 'trial',
  trial_ends_at   timestamptz default (now() + interval '30 days'),
  is_demo         boolean not null default false,

  -- localisation
  timezone        text not null default 'Africa/Casablanca', -- changed to 'UTC' in 0008
  currency        text not null default 'MAD' check (currency ~ '^[A-Z]{3}$'),
  languages       text[] not null default '{fr,en,ar}'
                  check (cardinality(languages) between 1 and 5),
  -- sales after midnight until this hour count for the previous business day
  day_cutoff_hour smallint not null default 5 check (day_cutoff_hour between 0 and 12),

  -- look and feel: {logo_url, cover_url, primary_color, accent_color, tagline:{fr,en,ar}}
  branding        jsonb not null default '{}'::jsonb check (jsonb_typeof(branding) = 'object'),
  -- {"mon":[["08:00","23:00"]], ...}
  opening_hours   jsonb not null default '{}'::jsonb check (jsonb_typeof(opening_hours) = 'object'),

  -- which order channels the customer QR site offers
  accept_dine_in  boolean not null default true,
  accept_takeaway boolean not null default false,
  accept_delivery boolean not null default false,

  -- fiscal identity (Morocco), printed on every fiscal document
  legal_name      text,
  ice             text check (ice ~ '^[0-9]{15}$'),
  tax_id          text,            -- Identifiant Fiscal (IF)
  rc              text,            -- Registre de Commerce
  address         text,
  city            text,
  phone           text,
  default_vat_bp  integer not null default 1000 check (default_vat_bp between 0 and 10000), -- 1000 = 10.00 %

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger restaurants_touch before update on public.restaurants
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Platform admins (you): full access to every restaurant
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Memberships: which login (auth user) may access which restaurant, with which role.
--   owner   = restaurant owner: everything inside the restaurant
--   manager = menu, staff, reports
--   device  = a till / tablet login: take orders, payments, kitchen screen
-- -----------------------------------------------------------------------------
create table public.memberships (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  role          public.member_role not null,
  created_at    timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

-- -----------------------------------------------------------------------------
-- Staff: people working the till. They do not have their own login, they pick
-- their name on the till and enter a PIN. The PIN identifies WHO did something
-- and authorises manager actions (discount, cancel) server side.
-- -----------------------------------------------------------------------------
create table public.staff (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants (id) on delete cascade,
  name                text not null check (length(name) between 1 and 40),
  role                public.staff_role not null default 'staff',
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, name)
);

-- PIN hashes live outside the API schema: no client can ever read them,
-- not even the restaurant owner (a 4 digit hash is trivial to brute force).
create table app.staff_pins (
  staff_id            uuid primary key references public.staff (id) on delete cascade,
  pin_hash            text not null,
  failed_attempts     smallint not null default 0,
  locked_until        timestamptz
);
revoke all on app.staff_pins from public, anon, authenticated;
create trigger staff_touch before update on public.staff
  for each row execute function app.touch_updated_at();
create trigger staff_same_tenant before update on public.staff
  for each row execute function app.forbid_restaurant_change();

-- -----------------------------------------------------------------------------
-- Dining tables with their QR token. The QR code encodes the token, never the
-- table number, so a guest cannot put orders on another table by editing a URL.
-- -----------------------------------------------------------------------------
create table public.dining_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null check (length(label) between 1 and 20),
  zone          text check (length(zone) <= 30),
  qr_token      text not null unique default app.random_token(10),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, label)
);
create trigger dining_tables_same_tenant before update on public.dining_tables
  for each row execute function app.forbid_restaurant_change();

-- -----------------------------------------------------------------------------
-- Gapless counters (ticket numbers per day, fiscal numbers per year).
-- Incremented inside the same transaction as the document that uses the number,
-- so a rollback also rolls back the number: no gaps, no duplicates.
-- -----------------------------------------------------------------------------
create table app.counters (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  key           text not null,
  value         bigint not null default 0,
  primary key (restaurant_id, key)
);
revoke all on app.counters from public, anon, authenticated;

create or replace function app.next_counter(p_restaurant_id uuid, p_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v bigint;
begin
  insert into app.counters as c (restaurant_id, key, value)
  values (p_restaurant_id, p_key, 1)
  on conflict (restaurant_id, key) do update set value = c.value + 1
  returning c.value into v;
  return v;
end $$;
-- app is not an API schema, so this is not callable from the browser. The
-- order trigger (running as the till user) needs to execute it.
revoke all on function app.next_counter(uuid, text) from public, anon;
grant execute on function app.next_counter(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Access helpers used by every RLS policy
-- -----------------------------------------------------------------------------
create or replace function app.is_platform_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function app.role_rank(r public.member_role)
returns int
language sql immutable
set search_path = ''
as $$ select case r when 'owner' then 3 when 'manager' then 2 when 'device' then 1 end $$;

-- Restaurants the current user belongs to with at least min_role.
-- Policies call it as  restaurant_id = any ((select app.my_restaurants('device'))::uuid[])
-- so Postgres evaluates it once per statement instead of once per row.
create or replace function app.my_restaurants(min_role public.member_role)
returns uuid[]
language sql stable
security definer
set search_path = ''
as $$
  select case
    when app.is_platform_admin() then (select coalesce(array_agg(id), '{}') from public.restaurants)
    else (
      select coalesce(array_agg(m.restaurant_id), '{}')
      from public.memberships m
      where m.user_id = auth.uid()
        and app.role_rank(m.role) >= app.role_rank(min_role)
    )
  end
$$;

-- A restaurant can be written to while on a running trial or active subscription.
create or replace function app.is_writable(r public.restaurants)
returns boolean
language sql stable
set search_path = ''
as $$
  select r.status = 'active'
      or (r.status = 'trial' and (r.trial_ends_at is null or r.trial_ends_at > now()))
$$;

-- Same as my_restaurants, but only restaurants that are not paused/expired.
create or replace function app.my_writable_restaurants(min_role public.member_role)
returns uuid[]
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(r.id), '{}')
  from public.restaurants r
  where r.id = any (app.my_restaurants(min_role))
    and app.is_writable(r)
$$;

-- Raises unless the caller has min_role in the restaurant (and, optionally,
-- the restaurant is writable). Used at the top of every server function.
create or replace function app.require_role(
  p_restaurant_id uuid,
  min_role public.member_role,
  must_be_writable boolean default true
)
returns public.restaurants
language plpgsql stable
security definer
set search_path = ''
as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where id = p_restaurant_id;
  if r.id is null or not (p_restaurant_id = any (app.my_restaurants(min_role))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if must_be_writable and not app.is_writable(r) then
    raise exception 'restaurant is paused or trial has ended' using errcode = 'P0001', hint = 'paused';
  end if;
  return r;
end $$;

-- Business day of "now" for a restaurant (after-midnight sales belong to the previous day).
create or replace function app.business_date(r public.restaurants, at_time timestamptz default now())
returns date
language sql stable
set search_path = ''
as $$
  select ((at_time at time zone r.timezone) - make_interval(hours => r.day_cutoff_hour))::date
$$;

-- -----------------------------------------------------------------------------
-- Staff PIN handling (hashes with bcrypt, never exposed)
-- -----------------------------------------------------------------------------

-- Verifies a staff PIN. Returns 'ok' | 'invalid' | 'locked' | 'not_manager'.
-- Deliberately does NOT raise on a wrong PIN: an exception would roll back the
-- failed-attempt counter and make the lockout useless. Callers turn a non-'ok'
-- result into a normal (non-error) response so the counter is committed.
-- Locks the staff member for 5 minutes after 5 wrong tries.
create or replace function app.check_staff_pin(
  p_restaurant_id uuid,
  p_staff_id uuid,
  p_pin text,
  min_role public.staff_role default 'staff'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.staff;
  p app.staff_pins;
begin
  select * into s from public.staff
  where id = p_staff_id and restaurant_id = p_restaurant_id and active;
  select * into p from app.staff_pins where staff_id = s.id for update;

  if s.id is null or p.staff_id is null then
    return 'invalid';
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return 'locked';
  end if;

  if extensions.crypt(coalesce(p_pin, ''), p.pin_hash) <> p.pin_hash then
    update app.staff_pins
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '5 minutes' end
     where staff_id = s.id;
    return 'invalid';
  end if;

  if p.failed_attempts > 0 then
    update app.staff_pins set failed_attempts = 0, locked_until = null where staff_id = s.id;
  end if;

  if s.role = 'staff' and min_role = 'manager' then
    return 'not_manager';
  end if;
  return 'ok';
end $$;
revoke all on function app.check_staff_pin(uuid, uuid, text, public.staff_role) from public, anon, authenticated;
