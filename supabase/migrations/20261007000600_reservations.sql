-- =============================================================================
-- 0035 RESERVATIONS AND WAITLIST
-- =============================================================================
-- Guests book a table from the restaurant's link (free times only: opening
-- hours and the number of seats), or join the waitlist at the door with the QR.
-- The host stand (the till) confirms, seats, calls the next guest on WhatsApp
-- and marks no-shows. Each guest gets a private link (token) to follow or cancel.
-- Settings in restaurants.booking:
--   enabled, waitlist, auto_confirm, capacity (seats at the same time),
--   duration_min, slot_minutes, lead_minutes, days_ahead, max_party, note
-- =============================================================================

alter table public.restaurants
  add column if not exists booking jsonb not null default '{}'::jsonb check (jsonb_typeof(booking) = 'object');
grant update (booking) on public.restaurants to authenticated;

create table if not exists public.reservations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind          text not null default 'booking' check (kind in ('booking', 'waitlist')),
  status        text not null default 'requested'
                check (status in ('requested', 'confirmed', 'called', 'seated', 'cancelled', 'no_show')),
  source        text not null default 'staff' check (source in ('online', 'staff', 'phone', 'walk_in')),
  starts_at     timestamptz,                            -- bookings: the time; waitlist: null
  duration_min  integer not null default 90 check (duration_min between 15 and 600),
  party_size    integer not null check (party_size between 1 and 60),
  name          text not null check (length(btrim(name)) between 1 and 60),
  phone         text check (phone is null or phone ~ '^[0-9]{6,15}$'),
  note          text check (length(note) <= 300),
  table_id      uuid,
  quoted_min    integer check (quoted_min between 0 and 600),    -- waitlist: wait announced
  token         text not null default app.random_token(16) unique,
  client_id     uuid,
  staff_id      uuid,
  confirmed_at  timestamptz,
  called_at     timestamptz,
  seated_at     timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, client_id),
  check (kind = 'waitlist' or starts_at is not null),
  foreign key (restaurant_id, table_id) references public.dining_tables (restaurant_id, id) on delete set null (table_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index if not exists reservations_day_idx on public.reservations (restaurant_id, starts_at);
create index if not exists reservations_wait_idx on public.reservations (restaurant_id, created_at) where kind = 'waitlist';
create index if not exists reservations_phone_idx on public.reservations (restaurant_id, phone);

-- timestamps follow the status; the restaurant never changes
create or replace function app.reservations_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.restaurant_id := old.restaurant_id; new.token := old.token; new.kind := old.kind;
    if new.status is distinct from old.status then
      if new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now()); end if;
      if new.status = 'called' then new.called_at := now(); end if;
      if new.status = 'seated' then new.seated_at := now(); end if;
      if new.status in ('cancelled', 'no_show') then new.ended_at := now(); end if;
    end if;
  else
    if new.phone is not null then new.phone := app.norm_phone(new.phone); end if;
    if new.status = 'confirmed' then new.confirmed_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists reservations_before on public.reservations;
create trigger reservations_before before insert or update on public.reservations
  for each row execute function app.reservations_before();

-- the host stand (any till) works with the list; managers and owners too
alter table public.reservations enable row level security;
grant select, insert, update on public.reservations to authenticated;
drop policy if exists reservations_select on public.reservations;
drop policy if exists reservations_insert on public.reservations;
drop policy if exists reservations_update on public.reservations;
create policy reservations_select on public.reservations for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy reservations_insert on public.reservations for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
create policy reservations_update on public.reservations for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
drop trigger if exists audit_reservations on public.reservations;
create trigger audit_reservations after update on public.reservations
  for each row execute function app.audit();

-- ------------------------------------------------------------ settings and slots
create or replace function app.booking_cfg(r public.restaurants)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((r.booking ->> 'enabled')::boolean, false),
    'waitlist', coalesce((r.booking ->> 'waitlist')::boolean, false),
    'auto_confirm', coalesce((r.booking ->> 'auto_confirm')::boolean, false),
    'capacity', least(1000, greatest(1, coalesce((r.booking ->> 'capacity')::int, 40))),
    'duration_min', least(600, greatest(30, coalesce((r.booking ->> 'duration_min')::int, 90))),
    'slot_minutes', case when (r.booking ->> 'slot_minutes')::int in (15, 30, 60) then (r.booking ->> 'slot_minutes')::int else 30 end,
    'lead_minutes', least(2880, greatest(0, coalesce((r.booking ->> 'lead_minutes')::int, 60))),
    'days_ahead', least(90, greatest(1, coalesce((r.booking ->> 'days_ahead')::int, 30))),
    'max_party', least(60, greatest(1, coalesce((r.booking ->> 'max_party')::int, 8))),
    'note', r.booking ->> 'note')
$$;

-- seats already taken around a moment (bookings that overlap [t, t + duration))
create or replace function app.booked_covers(p_restaurant_id uuid, t timestamptz, dur int, p_except uuid default null)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(party_size), 0)::int from public.reservations
   where restaurant_id = p_restaurant_id and kind = 'booking' and status in ('requested', 'confirmed', 'seated')
     and starts_at < t + make_interval(mins => dur) and starts_at + make_interval(mins => duration_min) > t
     and id is distinct from p_except
$$;

-- Public: free times of a day for a party. Open at the start and still open 45 min later.
create or replace function public.booking_slots(p_slug text, p_date date, p_party integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; t timestamptz; day_start timestamptz; out jsonb := '[]'; cap int; dur int; step int;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then perform app.fail('restaurant_not_found'); end if;
  c := app.booking_cfg(r);
  if not (c ->> 'enabled')::boolean or not app.is_writable(r) then perform app.fail('booking_off'); end if;
  if p_party is null or p_party < 1 or p_party > (c ->> 'max_party')::int then perform app.fail('party_too_big', c ->> 'max_party'); end if;
  if p_date is null or p_date < (now() at time zone r.timezone)::date or p_date > (now() at time zone r.timezone)::date + (c ->> 'days_ahead')::int then
    return '[]'::jsonb;
  end if;
  cap := (c ->> 'capacity')::int; dur := (c ->> 'duration_min')::int; step := (c ->> 'slot_minutes')::int;
  day_start := p_date::timestamp at time zone r.timezone;
  for t in select generate_series(day_start, day_start + interval '1 day' - make_interval(mins => step), make_interval(mins => step)) loop
    if t >= now() + make_interval(mins => (c ->> 'lead_minutes')::int)
       and app.open_at(r, t) and app.open_at(r, t + interval '45 minutes')
       and app.booked_covers(r.id, t, dur) + p_party <= cap then
      out := out || to_jsonb(t);
    end if;
  end loop;
  return out;
end $$;

-- Public: book. Free time checked again here (two guests at the same moment).
create or replace function public.book_table(p_slug text, p_booking jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; t timestamptz; n int; ph text; nm text; x public.reservations; cid uuid;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then perform app.fail('restaurant_not_found'); end if;
  c := app.booking_cfg(r);
  if not (c ->> 'enabled')::boolean or not app.is_writable(r) then perform app.fail('booking_off'); end if;
  cid := app.try_uuid(p_booking ->> 'client_id');
  if cid is not null then
    select * into x from public.reservations where restaurant_id = r.id and client_id = cid;
    if x.id is not null then return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', true); end if;
  end if;
  begin t := (p_booking ->> 'starts_at')::timestamptz; exception when others then perform app.fail('invalid_request', 'starts_at'); end;
  n := case when (p_booking ->> 'party_size') ~ '^[0-9]{1,2}$' then (p_booking ->> 'party_size')::int end;
  nm := nullif(btrim(p_booking ->> 'name'), '');
  ph := app.norm_phone(p_booking ->> 'phone');
  if t is null or n is null or n < 1 then perform app.fail('invalid_request'); end if;
  if n > (c ->> 'max_party')::int then perform app.fail('party_too_big', c ->> 'max_party'); end if;
  if nm is null or length(nm) > 60 or ph is null or ph !~ '^[0-9]{9,15}$' then perform app.fail('customer_required'); end if;
  if length(p_booking ->> 'note') > 300 then perform app.fail('invalid_request', 'too_long'); end if;
  if t < now() + make_interval(mins => (c ->> 'lead_minutes')::int)
     or t > now() + make_interval(days => (c ->> 'days_ahead')::int + 1)
     or not app.open_at(r, t) then
    perform app.fail('slot_unavailable');
  end if;
  -- one phone number cannot fill the room
  if (select count(*) from public.reservations where restaurant_id = r.id and phone = ph
        and status in ('requested', 'confirmed') and starts_at > now()) >= 3 then
    perform app.fail('rate_limited');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(r.id::text || 'booking', 0));
  if app.booked_covers(r.id, t, (c ->> 'duration_min')::int) + n > (c ->> 'capacity')::int then
    perform app.fail('slot_unavailable');
  end if;
  insert into public.reservations (restaurant_id, kind, status, source, starts_at, duration_min, party_size, name, phone, note, client_id)
  values (r.id, 'booking', case when (c ->> 'auto_confirm')::boolean then 'confirmed' else 'requested' end, 'online',
          t, (c ->> 'duration_min')::int, n, nm, ph, nullif(btrim(p_booking ->> 'note'), ''), cid)
  returning * into x;
  return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', false);
end $$;

-- Public: join the waitlist (the QR at the door).
create or replace function public.waitlist_join(p_slug text, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; n int; ph text; nm text; x public.reservations; cid uuid;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then perform app.fail('restaurant_not_found'); end if;
  c := app.booking_cfg(r);
  if not (c ->> 'waitlist')::boolean or not app.is_writable(r) then perform app.fail('waitlist_off'); end if;
  if not app.open_at(r, now()) then perform app.fail('closed'); end if;
  cid := app.try_uuid(p_entry ->> 'client_id');
  if cid is not null then
    select * into x from public.reservations where restaurant_id = r.id and client_id = cid;
    if x.id is not null then return jsonb_build_object('token', x.token, 'duplicate', true); end if;
  end if;
  n := case when (p_entry ->> 'party_size') ~ '^[0-9]{1,2}$' then (p_entry ->> 'party_size')::int end;
  nm := nullif(btrim(p_entry ->> 'name'), '');
  ph := app.norm_phone(p_entry ->> 'phone');
  if n is null or n < 1 or n > 30 then perform app.fail('invalid_request', 'party'); end if;
  if nm is null or length(nm) > 60 or ph is null or ph !~ '^[0-9]{9,15}$' then perform app.fail('customer_required'); end if;
  if exists (select 1 from public.reservations where restaurant_id = r.id and kind = 'waitlist' and phone = ph
               and status in ('requested', 'called') and created_at > now() - interval '6 hours') then
    perform app.fail('already_waiting');
  end if;
  insert into public.reservations (restaurant_id, kind, status, source, party_size, name, phone, client_id)
  values (r.id, 'waitlist', 'requested', 'walk_in', n, nm, ph, cid)
  returning * into x;
  return jsonb_build_object('token', x.token, 'duplicate', false);
end $$;

-- Public: the guest's private page (booking or place in the queue).
create or replace function public.reservation_status(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', x.kind, 'status', x.status, 'starts_at', x.starts_at, 'party_size', x.party_size, 'name', x.name,
    'created_at', x.created_at, 'called_at', x.called_at, 'quoted_min', x.quoted_min,
    'ahead', case when x.kind = 'waitlist' and x.status = 'requested' then
                (select count(*) from public.reservations w where w.restaurant_id = x.restaurant_id and w.kind = 'waitlist'
                   and w.status = 'requested' and w.created_at < x.created_at and w.created_at > now() - interval '12 hours') end,
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                     'timezone', r.timezone, 'note', r.booking ->> 'note'))
  from public.reservations x join public.restaurants r on r.id = x.restaurant_id
  where x.token = p_token and (x.kind = 'waitlist' and x.created_at > now() - interval '24 hours'
                               or x.kind = 'booking' and x.starts_at > now() - interval '1 day')
$$;

-- Public: the guest cancels (a booking still to come, or leaves the queue).
create or replace function public.reservation_cancel(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.reservations;
begin
  select * into x from public.reservations where token = p_token for update;
  if x.id is null then perform app.fail('not_found'); end if;
  if x.status not in ('requested', 'confirmed', 'called') or (x.kind = 'booking' and x.starts_at < now()) then
    perform app.fail('too_late');
  end if;
  update public.reservations set status = 'cancelled' where id = x.id;
  return jsonb_build_object('ok', true);
end $$;

-- Host stand: no-shows and visits of a phone number (warn before confirming again).
create or replace function public.guest_history(p_restaurant_id uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ph text := app.norm_phone(p_phone);
begin
  perform app.require_role(p_restaurant_id, 'device', false);
  return (select jsonb_build_object('no_shows', count(*) filter (where status = 'no_show'),
                                    'seated', count(*) filter (where status = 'seated'),
                                    'cancelled', count(*) filter (where status = 'cancelled'))
            from public.reservations where restaurant_id = p_restaurant_id and phone = ph);
end $$;

revoke all on function public.booking_slots(text, date, integer) from public;
revoke all on function public.book_table(text, jsonb) from public;
revoke all on function public.waitlist_join(text, jsonb) from public;
revoke all on function public.reservation_status(text) from public;
revoke all on function public.reservation_cancel(text) from public;
revoke all on function public.guest_history(uuid, text) from public, anon;
grant execute on function public.booking_slots(text, date, integer) to anon, authenticated;
grant execute on function public.book_table(text, jsonb) to anon, authenticated;
grant execute on function public.waitlist_join(text, jsonb) to anon, authenticated;
grant execute on function public.reservation_status(text) to anon, authenticated;
grant execute on function public.reservation_cancel(text) to anon, authenticated;
grant execute on function public.guest_history(uuid, text) to authenticated;
revoke all on function app.booked_covers(uuid, timestamptz, integer, uuid) from public, anon, authenticated;

-- The menu tells guests when booking / the waitlist are open.
create or replace function public.get_booking_info(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', (c ->> 'enabled')::boolean and app.is_writable(r),
                            'waitlist', (c ->> 'waitlist')::boolean and app.is_writable(r) and app.open_at(r, now()),
                            'max_party', (c ->> 'max_party')::int, 'days_ahead', (c ->> 'days_ahead')::int,
                            'note', c ->> 'note', 'name', r.name, 'timezone', r.timezone)
    from public.restaurants r, lateral (select app.booking_cfg(r) c) s
   where r.slug = lower(p_slug) and r.status <> 'cancelled'
$$;
revoke all on function public.get_booking_info(text) from public;
grant execute on function public.get_booking_info(text) to anon, authenticated;

-- Realtime: the host stand sees online bookings and the queue arrive.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'reservations') then
    alter publication supabase_realtime add table public.reservations;
  end if;
end $$;
