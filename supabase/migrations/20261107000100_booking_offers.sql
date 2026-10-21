-- =============================================================================
-- FORMULES: ftour, group menus, events (Amplify Maître)
--
-- A formule is a fixed menu per guest, at a fixed time, on chosen days, with a number of covers
-- per day: the ftour of Ramadan (one time, at maghrib, all the room booked in advance), a group
-- menu, a New Year's Eve dinner. It can ask a deposit per guest and offer choices per guest
-- (Classique, Végétarien...): the briefing then gives the kitchen its list for the evening.
-- Guests book it online (book_offer) or at the host stand; on the evening the bill starts with it.
-- =============================================================================

create table if not exists public.booking_offers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  kind           text not null default 'group' check (kind in ('ftour', 'group', 'event')),
  name           text not null check (length(btrim(name)) between 1 and 60),
  description    text check (length(description) <= 300),
  price_cents    bigint not null default 0 check (price_cents between 0 and 100000000),       -- per guest
  deposit_cents  bigint check (deposit_cents between 1 and 100000000),                        -- per guest
  options        text[] not null default '{}' check (cardinality(options) <= 6),             -- choices per guest
  min_party      integer not null default 1 check (min_party between 1 and 200),
  max_party      integer not null default 20 check (max_party between 1 and 200),
  starts_on      date,
  ends_on        date,
  weekdays       integer[] not null default '{}' check (weekdays <@ array[0, 1, 2, 3, 4, 5, 6]),  -- empty: every day
  at_time        time not null default '19:00',
  covers         integer check (covers between 1 and 5000),                                   -- per day, null: the room
  online         boolean not null default true,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  check (max_party >= min_party),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists booking_offers_idx on public.booking_offers (restaurant_id, active);
drop trigger if exists booking_offers_same_tenant on public.booking_offers;
create trigger booking_offers_same_tenant before update on public.booking_offers
  for each row execute function app.forbid_restaurant_change();
alter table public.booking_offers enable row level security;
grant select, insert, update, delete on public.booking_offers to authenticated;
drop policy if exists booking_offers_select on public.booking_offers;
drop policy if exists booking_offers_write on public.booking_offers;
create policy booking_offers_select on public.booking_offers for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy booking_offers_write on public.booking_offers for all to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

-- the booking of a formule, and the choices of its guests ({"Végétarien": 2, "Classique": 4})
alter table public.reservations
  add column if not exists offer_id uuid,
  add column if not exists offer_choices jsonb not null default '{}'::jsonb check (jsonb_typeof(offer_choices) = 'object');
alter table public.reservations drop constraint if exists reservations_offer_fk;
alter table public.reservations add constraint reservations_offer_fk
  foreign key (restaurant_id, offer_id) references public.booking_offers (restaurant_id, id);

-- open that day (dates, weekdays, active)
create or replace function app.offer_open_on(o public.booking_offers, d date)
returns boolean language sql immutable set search_path = '' as $$
  select o.active and (o.starts_on is null or d >= o.starts_on) and (o.ends_on is null or d <= o.ends_on)
     and (cardinality(o.weekdays) = 0 or extract(dow from d)::int = any (o.weekdays))
$$;

-- covers already booked for a formule on a day (in the restaurant's time zone)
create or replace function app.offer_taken(o public.booking_offers, d date, tz text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(party_size), 0)::int from public.reservations
   where restaurant_id = o.restaurant_id and offer_id = o.id and kind = 'booking'
     and status in ('requested', 'confirmed', 'seated')
     and starts_at >= (d::timestamp at time zone tz) and starts_at < ((d + 1)::timestamp at time zone tz)
$$;

-- the choices of a booking: known options, whole numbers, at most the party
create or replace function app.offer_choices_ok(o public.booking_offers, c jsonb, party int)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(c) = 'object'
     and not exists (select 1 from jsonb_each(c) e where not (e.key = any (o.options)) or jsonb_typeof(e.value) <> 'number'
                       or (e.value)::text !~ '^[0-9]{1,3}$')
     and coalesce((select sum((e.value)::text::int) from jsonb_each(c) e), 0) <= party
$$;

-- what the booking page shows of the formules
create or replace function app.offer_public(o public.booking_offers)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'kind', o.kind, 'name', o.name, 'description', o.description,
    'price_cents', o.price_cents, 'deposit_cents', o.deposit_cents, 'options', to_jsonb(o.options),
    'min_party', o.min_party, 'max_party', o.max_party, 'starts_on', o.starts_on, 'ends_on', o.ends_on,
    'weekdays', to_jsonb(o.weekdays), 'at_time', to_char(o.at_time, 'HH24:MI'))
$$;

-- Public: the days a formule can still be booked for this party (the next weeks)
create or replace function public.offer_days(p_slug text, p_offer_id uuid, p_party integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; o public.booking_offers; c jsonb; d date; today date; out jsonb := '[]'::jsonb; left_n int; t timestamptz;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_maitre(r) or not app.is_writable(r) then return '[]'::jsonb; end if;
  select * into o from public.booking_offers where restaurant_id = r.id and id = p_offer_id and online;
  if o.id is null or p_party is null or p_party < o.min_party or p_party > o.max_party then return '[]'::jsonb; end if;
  c := app.booking_cfg(r);
  today := (now() at time zone r.timezone)::date;
  for i in 0 .. least(90, greatest((c ->> 'days_ahead')::int, case when o.ends_on is not null then o.ends_on - today else 0 end)) loop
    d := today + i;
    continue when not app.offer_open_on(o, d);
    t := (d + o.at_time)::timestamp at time zone r.timezone;
    continue when t < now() + make_interval(mins => (c ->> 'lead_minutes')::int);
    left_n := case when o.covers is null then 999 else o.covers - app.offer_taken(o, d, r.timezone) end;
    if left_n >= p_party then out := out || jsonb_build_array(jsonb_build_object('day', d, 'left', least(left_n, 999))); end if;
  end loop;
  return out;
end $$;

-- Public: book a formule
create or replace function public.book_offer(p_slug text, p_booking jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; o public.booking_offers; c jsonb; d date; n int; ph text; nm text; x public.reservations; cid uuid; t timestamptz; ch jsonb;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then perform app.fail('restaurant_not_found'); end if;
  if not app.has_maitre(r) or not app.is_writable(r) then perform app.fail('booking_off'); end if;
  c := app.booking_cfg(r);
  cid := app.try_uuid(p_booking ->> 'client_id');
  if cid is not null then
    select * into x from public.reservations where restaurant_id = r.id and client_id = cid;
    if x.id is not null then return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', true); end if;
  end if;
  select * into o from public.booking_offers where restaurant_id = r.id and id = app.try_uuid(p_booking ->> 'offer_id') and online;
  if o.id is null then perform app.fail('offer_not_found'); end if;
  begin d := (p_booking ->> 'day')::date; exception when others then perform app.fail('invalid_request', 'day'); end;
  n := case when (p_booking ->> 'party_size') ~ '^[0-9]{1,3}$' then (p_booking ->> 'party_size')::int end;
  nm := nullif(btrim(p_booking ->> 'name'), '');
  ph := app.norm_phone(p_booking ->> 'phone');
  ch := coalesce(p_booking -> 'choices', '{}'::jsonb);
  if d is null or n is null or n < 1 then perform app.fail('invalid_request'); end if;
  if n < o.min_party or n > o.max_party then perform app.fail('party_size', format('%s-%s', o.min_party, o.max_party)); end if;
  if nm is null or length(nm) > 60 or ph is null or ph !~ '^[0-9]{9,15}$' then perform app.fail('customer_required'); end if;
  if length(p_booking ->> 'note') > 300 then perform app.fail('invalid_request', 'too_long'); end if;
  if not app.offer_choices_ok(o, ch, n) then perform app.fail('invalid_request', 'choices'); end if;
  t := (d + o.at_time)::timestamp at time zone r.timezone;
  if not app.offer_open_on(o, d) or t < now() + make_interval(mins => (c ->> 'lead_minutes')::int) or d > (now() at time zone r.timezone)::date + 120 then
    perform app.fail('slot_unavailable');
  end if;
  if (select count(*) from public.reservations where restaurant_id = r.id and phone = ph
        and status in ('requested', 'confirmed') and starts_at > now()) >= 3 then
    perform app.fail('rate_limited');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(o.id::text || d::text, 0));
  if o.covers is not null and app.offer_taken(o, d, r.timezone) + n > o.covers then perform app.fail('slot_unavailable'); end if;
  insert into public.reservations (restaurant_id, kind, status, source, starts_at, duration_min, party_size, name, phone, note,
                                   client_id, offer_id, offer_choices, deposit_cents)
  values (r.id, 'booking', case when (c ->> 'auto_confirm')::boolean and o.deposit_cents is null then 'confirmed' else 'requested' end, 'online',
          t, (c ->> 'duration_min')::int, n, nm, ph, nullif(btrim(p_booking ->> 'note'), ''), cid, o.id, ch,
          case when o.deposit_cents is not null then least(100000000, n * o.deposit_cents) end)
  returning * into x;
  return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', false, 'deposit_cents', x.deposit_cents);
end $$;

-- the booking page: the formules open online (with Amplify Maître)
create or replace function public.get_booking_info(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', (c ->> 'enabled')::boolean and app.is_writable(r),
                            'waitlist', (c ->> 'waitlist')::boolean and app.is_writable(r) and app.open_at(r, now()),
                            'max_party', (c ->> 'max_party')::int, 'days_ahead', (c ->> 'days_ahead')::int,
                            'note', c ->> 'note', 'name', r.name, 'timezone', r.timezone,
                            'deposit_party', case when app.deposit_for(r, 60) is not null then (r.booking ->> 'deposit_party')::int end,
                            'deposit_cents', case when app.deposit_for(r, 60) is not null then (r.booking ->> 'deposit_cents')::bigint end,
                            'offers', case when app.has_maitre(r) and app.is_writable(r) then coalesce((
                               select jsonb_agg(app.offer_public(o) order by o.sort_order, o.created_at)
                                 from public.booking_offers o
                                where o.restaurant_id = r.id and o.active and o.online
                                  and (o.ends_on is null or o.ends_on >= (now() at time zone r.timezone)::date)), '[]'::jsonb) else '[]'::jsonb end)
    from public.restaurants r, lateral (select app.booking_cfg(r) c) s
   where r.slug = lower(p_slug) and r.status <> 'cancelled'
$$;

create or replace function public.reservation_status(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', x.kind, 'status', x.status, 'starts_at', x.starts_at, 'party_size', x.party_size, 'name', x.name,
    'created_at', x.created_at, 'called_at', x.called_at, 'quoted_min', x.quoted_min,
    'occasion', x.occasion, 'deposit_cents', x.deposit_cents, 'deposit_state', x.deposit_state,
    'offer', (select o.name from public.booking_offers o where o.restaurant_id = x.restaurant_id and o.id = x.offer_id),
    'offer_choices', x.offer_choices,
    'ahead', case when x.kind = 'waitlist' and x.status = 'requested' then
                (select count(*) from public.reservations w where w.restaurant_id = x.restaurant_id and w.kind = 'waitlist'
                   and w.status = 'requested' and w.created_at < x.created_at and w.created_at > now() - interval '12 hours') end,
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                     'timezone', r.timezone, 'note', r.booking ->> 'note'))
  from public.reservations x join public.restaurants r on r.id = x.restaurant_id
  where x.token = p_token and (x.kind = 'waitlist' and x.created_at > now() - interval '24 hours'
                               or x.kind = 'booking' and x.starts_at > now() - interval '1 day')
$$;

revoke all on function public.offer_days(text, uuid, integer) from public;
revoke all on function public.book_offer(text, jsonb) from public;
grant execute on function public.offer_days(text, uuid, integer) to anon, authenticated;
grant execute on function public.book_offer(text, jsonb) to anon, authenticated;
revoke all on function app.offer_taken(public.booking_offers, date, text) from public, anon;
grant execute on function app.offer_taken(public.booking_offers, date, text) to authenticated;

-- the briefing knows the formule of each booking and the choices of its guests
CREATE OR REPLACE FUNCTION public.pos_briefing(p_restaurant_id uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; d date; t0 timestamptz; files boolean;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not app.has_maitre(r) then perform app.fail('maitre_off'); end if;
  d := coalesce(p_day, (now() at time zone r.timezone)::date);
  if d < current_date - 400 or d > current_date + 400 then perform app.fail('invalid_request', 'day'); end if;
  t0 := d::timestamp at time zone r.timezone;
  files := coalesce((r.loyalty ->> 'customers')::boolean, false);
  return jsonb_build_object(
    'day', d,
    'files', files,
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'starts_at', b.starts_at, 'status', b.status, 'source', b.source,
          'party_size', b.party_size, 'name', b.name, 'phone', b.phone, 'note', b.note,
          'table', t.label, 'occasion', b.occasion,
          'offer', case when o.id is not null then jsonb_build_object('id', o.id, 'name', o.name, 'kind', o.kind) end, 'offer_choices', b.offer_choices,
          'deposit_cents', b.deposit_cents, 'deposit_state', b.deposit_state, 'deposit_left', app.deposit_left(r.id, b.id),
          'guest', case when files and c.id is not null then app.guest_brief(c) end,
          'no_shows', (select count(*) from public.reservations x
                        where x.restaurant_id = r.id and b.phone is not null and x.phone = b.phone and x.status = 'no_show'),
          -- days until the birthday (0 = today), only within the coming week
          'birthday_in', case when files and c.birthday is not null then (
              select n from (select case when bd >= d then bd - d else (bd + interval '1 year')::date - d end n
                               from (select (c.birthday + make_interval(years => (extract(year from d) - extract(year from c.birthday))::int))::date bd) y) z
               where n between 0 and 6) end
        ) order by b.starts_at, b.name)
        from public.reservations b
        left join public.dining_tables t on t.restaurant_id = r.id and t.id = b.table_id
        left join public.booking_offers o on o.restaurant_id = r.id and o.id = b.offer_id
        left join public.customers c on c.restaurant_id = r.id and c.phone = b.phone
       where b.restaurant_id = r.id and b.kind = 'booking'
         and b.status in ('requested', 'confirmed', 'seated')
         and b.starts_at >= t0 and b.starts_at < t0 + interval '1 day'
    ), '[]'::jsonb)
  );
end $function$;

notify pgrst, 'reload schema';
