-- =============================================================================
-- 0010 ONBOARDING: self sign-up and pairing tills with a code
-- =============================================================================
-- * signup_restaurant(): a logged-in (non anonymous) user creates their own
--   restaurant, gets a 30 day trial and becomes its owner. Max 3 per user.
-- * Tills no longer need an e-mail account: the owner creates a one-time code
--   (valid 30 minutes) in the back office; the till signs in anonymously and
--   redeems the code with pair_device(), which makes that anonymous user a
--   "device" member of the restaurant. The owner can revoke a till anytime.
-- =============================================================================

alter table public.memberships add column label text check (length(label) <= 40);

create or replace function app.is_anonymous()
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false)
$$;

-- ---------------------------------------------------------------------------
-- Self sign-up
-- ---------------------------------------------------------------------------
create or replace function public.slug_available(p_slug text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select lower(p_slug) ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
     and not exists (select 1 from public.restaurants where slug = lower(p_slug))
$$;

create or replace function public.signup_restaurant(p_name text, p_slug text, p_city text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid(); rid uuid;
begin
  if uid is null or app.is_anonymous() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.memberships where user_id = uid and role = 'owner') >= 3 then
    perform app.fail('too_many_restaurants');
  end if;
  if nullif(btrim(p_name), '') is null then perform app.fail('name_required'); end if;
  if not public.slug_available(p_slug) then perform app.fail('slug_taken'); end if;

  insert into public.restaurants (slug, name, city, status, trial_ends_at, timezone, languages,
                                  accept_dine_in, accept_takeaway, branding)
  values (lower(p_slug), left(btrim(p_name), 80), nullif(btrim(p_city), ''), 'trial', now() + interval '30 days',
          'UTC', '{fr,ar,en}', true, true, '{"primary_color":"#C2410C","theme":"light"}')
  returning id into rid;
  insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  return rid;
end $$;

-- ---------------------------------------------------------------------------
-- Pairing tills with a one-time code
-- ---------------------------------------------------------------------------
create table app.device_pairings (
  code          text primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text,
  created_by    uuid,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid
);
alter table app.device_pairings enable row level security;
revoke all on app.device_pairings from public, anon, authenticated;

-- Owner/manager: create a code for a new till. 8 characters, no look-alikes.
create or replace function public.create_pairing_code(p_restaurant_id uuid, p_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare c text; exp timestamptz := now() + interval '30 minutes';
begin
  perform app.require_role(p_restaurant_id, 'manager', true);
  delete from app.device_pairings where expires_at < now() - interval '1 day';
  c := upper(app.random_token(8));
  insert into app.device_pairings (code, restaurant_id, label, created_by, expires_at)
  values (c, p_restaurant_id, left(nullif(btrim(p_label), ''), 40), auth.uid(), exp);
  return jsonb_build_object('code', c, 'expires_at', exp);
end $$;

-- The till (usually an anonymous session) redeems the code.
create or replace function public.pair_device(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare p app.device_pairings; uid uuid := auth.uid(); r public.restaurants;
begin
  if uid is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into p from app.device_pairings where code = upper(btrim(p_code)) for update;
  if p.code is null or p.used_at is not null or p.expires_at < now() then
    perform app.fail('invalid_code');
  end if;
  select * into r from public.restaurants where id = p.restaurant_id;
  if not app.is_writable(r) then perform app.fail('ordering_unavailable'); end if;
  -- never downgrade a real owner/manager account that types a code by mistake
  if exists (select 1 from public.memberships where restaurant_id = r.id and user_id = uid and role <> 'device') then
    perform app.fail('already_member');
  end if;
  insert into public.memberships (restaurant_id, user_id, role, label)
  values (r.id, uid, 'device', coalesce(p.label, 'Caisse'))
  on conflict (restaurant_id, user_id) do update set label = excluded.label;
  update app.device_pairings set used_at = now(), used_by = uid where code = p.code;
  return jsonb_build_object('restaurant_id', r.id, 'name', r.name);
end $$;

-- Owner removes a till (or any member other than themselves).
create or replace function public.revoke_member(p_restaurant_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_role(p_restaurant_id, 'owner', false);
  if p_user_id = auth.uid() then perform app.fail('cannot_remove_yourself'); end if;
  delete from public.memberships where restaurant_id = p_restaurant_id and user_id = p_user_id;
end $$;

revoke all on function public.slug_available(text) from public, anon;
revoke all on function public.signup_restaurant(text, text, text) from public, anon;
revoke all on function public.create_pairing_code(uuid, text) from public, anon;
revoke all on function public.pair_device(text) from public, anon;
revoke all on function public.revoke_member(uuid, uuid) from public, anon;
grant execute on function public.slug_available(text) to authenticated;
grant execute on function public.signup_restaurant(text, text, text) to authenticated;
grant execute on function public.create_pairing_code(uuid, text) to authenticated;
grant execute on function public.pair_device(text) to authenticated;
grant execute on function public.revoke_member(uuid, uuid) to authenticated;
