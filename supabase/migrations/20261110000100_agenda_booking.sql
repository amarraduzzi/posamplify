-- =============================================================================
-- AMPLIFY AGENDA (2): appointments, free times and the online booking page
--
-- A client books from the salon's link (<slug>?rdv): a prestation, a person or "peu importe", a day,
-- a time, a name and a number. Free times come from the hours of each person, minus their
-- appointments (with the time to prepare after) and the days off. The client gets a private page
-- (?rdv=<token>) to see the appointment and cancel it until a few hours before.
-- Settings in restaurants.agenda:
--   enabled, auto_confirm, step (minutes between proposed times), lead_minutes, days_ahead,
--   cancel_hours, any_staff ("peu importe" offered), note
-- =============================================================================

alter table public.restaurants
  add column if not exists agenda jsonb not null default '{}'::jsonb check (jsonb_typeof(agenda) = 'object');
grant update (agenda) on public.restaurants to authenticated;

create or replace function app.agenda_cfg(r public.restaurants)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((r.agenda ->> 'enabled')::boolean, false),
    'auto_confirm', coalesce((r.agenda ->> 'auto_confirm')::boolean, true),
    'step', case when (r.agenda ->> 'step')::int in (10, 15, 20, 30, 60) then (r.agenda ->> 'step')::int else 15 end,
    'lead_minutes', least(2880, greatest(0, coalesce((r.agenda ->> 'lead_minutes')::int, 60))),
    'days_ahead', least(90, greatest(1, coalesce((r.agenda ->> 'days_ahead')::int, 30))),
    'cancel_hours', least(72, greatest(0, coalesce((r.agenda ->> 'cancel_hours')::int, 3))),
    'any_staff', coalesce((r.agenda ->> 'any_staff')::boolean, true),
    'note', left(r.agenda ->> 'note', 300))
$$;

create table if not exists public.agenda_appointments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  service_id    uuid,
  staff_id      uuid,
  status        text not null default 'confirmed'
                check (status in ('requested', 'confirmed', 'arrived', 'done', 'cancelled', 'no_show')),
  source        text not null default 'staff' check (source in ('online', 'staff', 'phone', 'walk_in')),
  starts_at     timestamptz not null,
  duration_min  integer not null check (duration_min between 5 and 600),
  buffer_min    integer not null default 0 check (buffer_min between 0 and 120),
  -- filled by the trigger: the end for the client, the end of the time kept for the person
  ends_at       timestamptz not null,
  busy_until    timestamptz not null,
  -- what was booked, kept even if the prestation changes later
  service_name  jsonb not null default '{}'::jsonb check (jsonb_typeof(service_name) = 'object'),
  price_cents   bigint not null default 0 check (price_cents between 0 and 10000000),
  price_from    boolean not null default false,
  -- the client chose "peu importe": the salon may give it to someone else
  any_staff     boolean not null default false,
  name          text not null check (length(btrim(name)) between 1 and 60),
  phone         text check (phone is null or phone ~ '^[0-9]{6,15}$'),
  note          text check (length(note) <= 300),
  token         text not null default app.random_token(16) unique,
  client_id     uuid,
  confirmed_at  timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  text check (cancelled_by in ('client', 'salon')),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, client_id),
  foreign key (restaurant_id, service_id) references public.agenda_services (restaurant_id, id) on delete set null (service_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index if not exists agenda_appointments_staff_idx on public.agenda_appointments (restaurant_id, staff_id, starts_at);
create index if not exists agenda_appointments_day_idx on public.agenda_appointments (restaurant_id, starts_at);
create index if not exists agenda_appointments_phone_idx on public.agenda_appointments (restaurant_id, phone);

create or replace function app.agenda_appointments_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.restaurant_id := old.restaurant_id; new.token := old.token; new.client_id := old.client_id; new.created_at := old.created_at;
    if new.status is distinct from old.status then
      if new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now()); end if;
      if new.status = 'cancelled' then new.cancelled_at := now(); new.cancelled_by := coalesce(new.cancelled_by, 'salon'); end if;
    end if;
  else
    if new.status = 'confirmed' then new.confirmed_at := now(); end if;
  end if;
  if new.phone is not null then new.phone := app.norm_phone(new.phone); end if;
  new.ends_at := new.starts_at + make_interval(mins => new.duration_min);
  new.busy_until := new.ends_at + make_interval(mins => new.buffer_min);
  return new;
end $$;
drop trigger if exists agenda_appointments_before on public.agenda_appointments;
create trigger agenda_appointments_before before insert or update on public.agenda_appointments
  for each row execute function app.agenda_appointments_before();

-- the salon (the agenda screen, the manager) works with the list
alter table public.agenda_appointments enable row level security;
grant select, insert, update on public.agenda_appointments to authenticated;
drop policy if exists agenda_appointments_select on public.agenda_appointments;
drop policy if exists agenda_appointments_insert on public.agenda_appointments;
drop policy if exists agenda_appointments_update on public.agenda_appointments;
create policy agenda_appointments_select on public.agenda_appointments for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy agenda_appointments_insert on public.agenda_appointments for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
create policy agenda_appointments_update on public.agenda_appointments for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('device'))::uuid[]));
drop trigger if exists audit_agenda_appointments on public.agenda_appointments;
create trigger audit_agenda_appointments after update on public.agenda_appointments
  for each row execute function app.audit();

-- ------------------------------------------------------------------ the free-time engine
-- the hours a person works that day (their own hours; none set: the salon's opening hours)
create or replace function app.agenda_work(r public.restaurants, s public.staff, p_day date)
returns tstzmultirange language sql stable set search_path = '' as $$
  select coalesce(range_agg(tstzrange(
           (p_day + (p ->> 0)::time) at time zone r.timezone,
           case when p ->> 1 = '24:00' or (p ->> 1)::time = '00:00' then (p_day + 1)::timestamp at time zone r.timezone
                when (p ->> 1)::time <= (p ->> 0)::time then ((p_day + 1) + (p ->> 1)::time) at time zone r.timezone
                else (p_day + (p ->> 1)::time) at time zone r.timezone end)), '{}'::tstzmultirange)
    from jsonb_array_elements(coalesce(
           (case when s.agenda_hours = '{}'::jsonb then r.opening_hours else s.agenda_hours end) -> lower(to_char(p_day, 'dy')),
           '[]'::jsonb)) p
   where jsonb_typeof(p) = 'array' and (p ->> 0) ~ '^[0-9]{2}:[0-9]{2}$' and (p ->> 1) ~ '^[0-9]{2}:[0-9]{2}$'
$$;

-- what is taken in a window: appointments (with their time to prepare) and days off (own or whole salon)
create or replace function app.agenda_blocked(r public.restaurants, p_staff uuid, w tstzrange, p_ignore uuid default null)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(x), '{}'::tstzmultirange) from (
    select tstzrange(a.starts_at, a.busy_until) x from public.agenda_appointments a
     where a.restaurant_id = r.id and a.staff_id = p_staff and a.status not in ('cancelled', 'no_show')
       and a.starts_at < upper(w) and a.busy_until > lower(w) and a.id is distinct from p_ignore
    union all
    select tstzrange(o.starts_at, o.ends_at) from public.agenda_time_off o
     where o.restaurant_id = r.id and (o.staff_id = p_staff or o.staff_id is null)
       and o.starts_at < upper(w) and o.ends_at > lower(w)) q
$$;

-- the person does this prestation and takes appointments
create or replace function app.agenda_can_do(s public.staff, svc public.agenda_services)
returns boolean language sql immutable set search_path = '' as $$
  select s.active and s.agenda and s.restaurant_id = svc.restaurant_id
     and (cardinality(s.agenda_services) = 0 or svc.id = any (s.agenda_services))
$$;

-- the start times one person can take a prestation that day: the prestation fits in the hours,
-- and the prestation plus its time to prepare does not touch anything taken
create or replace function app.agenda_starts(r public.restaurants, svc public.agenda_services, s public.staff, p_day date,
                                             p_from timestamptz default null, p_ignore uuid default null)
returns setof timestamptz language plpgsql stable security definer set search_path = '' as $$
declare work tstzmultirange; taken tstzmultirange; rg tstzrange; t timestamptz;
        step int := (app.agenda_cfg(r) ->> 'step')::int;
        dur interval := make_interval(mins => svc.duration_min);
        full_dur interval := make_interval(mins => svc.duration_min + svc.buffer_min);
begin
  if not app.agenda_can_do(s, svc) then return; end if;
  work := app.agenda_work(r, s, p_day);
  if isempty(work) then return; end if;
  taken := app.agenda_blocked(r, s.id, tstzrange(lower(work), upper(work) + interval '2 hours'), p_ignore);
  for rg in select unnest(work) loop
    for t in select generate_series(lower(rg), upper(rg) - dur, make_interval(mins => step)) loop
      if (p_from is null or t >= p_from) and not (tstzrange(t, t + full_dur) && taken) then
        return next t;
      end if;
    end loop;
  end loop;
end $$;

-- the salon of a public link, with Agenda and online booking open
create or replace function app.agenda_salon(p_slug text)
returns public.restaurants language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_agenda(r) then perform app.fail('restaurant_not_found'); end if;
  if not (app.agenda_cfg(r) ->> 'enabled')::boolean or not app.is_writable(r) then perform app.fail('booking_off'); end if;
  return r;
end $$;

-- the prestation of a public link: active and bookable online
create or replace function app.agenda_online_service(r public.restaurants, p_service uuid)
returns public.agenda_services language plpgsql stable security definer set search_path = '' as $$
declare svc public.agenda_services;
begin
  select * into svc from public.agenda_services where restaurant_id = r.id and id = p_service and active and online;
  if svc.id is null then perform app.fail('service_not_found'); end if;
  return svc;
end $$;

-- the free start times of a day (one person, or everyone who does the prestation)
create or replace function app.agenda_day_starts(r public.restaurants, svc public.agenda_services, p_staff uuid, p_day date)
returns table (t timestamptz, staff_id uuid) language sql stable security definer set search_path = '' as $$
  select x.t, s.id
    from public.staff s, lateral app.agenda_starts(r, svc, s, p_day,
           now() + make_interval(mins => (app.agenda_cfg(r) ->> 'lead_minutes')::int)) x(t)
   where s.restaurant_id = r.id and (p_staff is null or s.id = p_staff)
     and p_day between (now() at time zone r.timezone)::date
                   and (now() at time zone r.timezone)::date + (app.agenda_cfg(r) ->> 'days_ahead')::int
$$;

-- ------------------------------------------------------------------ public functions
-- the booking page: the salon, its prestations and the people who take appointments
create or replace function public.agenda_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c jsonb;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_agenda(r) then return null; end if;
  c := app.agenda_cfg(r);
  return jsonb_build_object(
    'enabled', (c ->> 'enabled')::boolean and app.is_writable(r),
    'name', r.name, 'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding,
    'phone', r.phone, 'address', r.address, 'city', r.city, 'note', c ->> 'note',
    'days_ahead', (c ->> 'days_ahead')::int, 'cancel_hours', (c ->> 'cancel_hours')::int, 'any_staff', (c ->> 'any_staff')::boolean,
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'description', v.description, 'category', v.category, 'duration_min', v.duration_min,
        'price_cents', v.price_cents, 'price_from', v.price_from) order by v.sort_order, v.created_at)
      from public.agenda_services v where v.restaurant_id = r.id and v.active and v.online), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.agenda_color, 'services', s.agenda_services)
                                        order by s.agenda_sort, s.name)
      from public.staff s where s.restaurant_id = r.id and s.active and s.agenda), '[]'::jsonb));
end $$;

-- the days with at least one free time, from today to the last bookable day
create or replace function public.agenda_days(p_slug text, p_service uuid, p_staff uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants := app.agenda_salon(p_slug); svc public.agenda_services := app.agenda_online_service(r, p_service);
        today date := (now() at time zone r.timezone)::date; d date; out jsonb := '[]';
begin
  if p_staff is null and not (app.agenda_cfg(r) ->> 'any_staff')::boolean then perform app.fail('staff_required'); end if;
  for d in select generate_series(today, today + (app.agenda_cfg(r) ->> 'days_ahead')::int, interval '1 day')::date loop
    if exists (select 1 from app.agenda_day_starts(r, svc, p_staff, d)) then out := out || to_jsonb(d); end if;
  end loop;
  return out;
end $$;

-- the free times of a day
create or replace function public.agenda_slots(p_slug text, p_service uuid, p_staff uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants := app.agenda_salon(p_slug); svc public.agenda_services := app.agenda_online_service(r, p_service);
begin
  if p_staff is null and not (app.agenda_cfg(r) ->> 'any_staff')::boolean then perform app.fail('staff_required'); end if;
  return coalesce((select jsonb_agg(t order by t) from (select distinct x.t from app.agenda_day_starts(r, svc, p_staff, p_day) x) q), '[]'::jsonb);
end $$;

-- book. The time is checked again under a lock (two clients on the same time).
-- "peu importe": the person who has the least booked that day gets it.
create or replace function public.agenda_book(p_slug text, p_booking jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants := app.agenda_salon(p_slug); c jsonb := app.agenda_cfg(r); svc public.agenda_services;
        x public.agenda_appointments; cid uuid; v_t timestamptz; d date; ph text; nm text; who uuid; want uuid;
begin
  cid := app.try_uuid(p_booking ->> 'client_id');
  if cid is not null then
    select * into x from public.agenda_appointments where restaurant_id = r.id and client_id = cid;
    if x.id is not null then return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', true); end if;
  end if;
  svc := app.agenda_online_service(r, app.try_uuid(p_booking ->> 'service_id'));
  want := app.try_uuid(p_booking ->> 'staff_id');
  if want is null and nullif(p_booking ->> 'staff_id', '') is not null then perform app.fail('invalid_request', 'staff_id'); end if;
  if want is null and not (c ->> 'any_staff')::boolean then perform app.fail('staff_required'); end if;
  begin v_t := (p_booking ->> 'starts_at')::timestamptz; exception when others then perform app.fail('invalid_request', 'starts_at'); end;
  if v_t is null then perform app.fail('invalid_request', 'starts_at'); end if;
  nm := nullif(btrim(p_booking ->> 'name'), '');
  ph := app.norm_phone(p_booking ->> 'phone');
  if nm is null or length(nm) > 60 or ph is null or ph !~ '^[0-9]{9,15}$' then perform app.fail('customer_required'); end if;
  if length(p_booking ->> 'note') > 300 then perform app.fail('invalid_request', 'too_long'); end if;
  -- one phone number cannot fill the agenda
  if (select count(*) from public.agenda_appointments where restaurant_id = r.id and phone = ph
        and status in ('requested', 'confirmed') and starts_at > now()) >= 3 then
    perform app.fail('rate_limited');
  end if;
  d := (v_t at time zone r.timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended(r.id::text || 'agenda', 0));
  select s.staff_id into who
    from app.agenda_day_starts(r, svc, want, d) s
    join public.staff p on p.id = s.staff_id
   where s.t = v_t
   order by (select coalesce(sum(a.duration_min), 0) from public.agenda_appointments a
              where a.restaurant_id = r.id and a.staff_id = s.staff_id and a.status not in ('cancelled', 'no_show')
                and a.starts_at >= (d::timestamp at time zone r.timezone) and a.starts_at < ((d + 1)::timestamp at time zone r.timezone)),
            p.agenda_sort, p.name
   limit 1;
  if who is null then perform app.fail('slot_unavailable'); end if;
  insert into public.agenda_appointments (restaurant_id, service_id, staff_id, status, source, starts_at, duration_min, buffer_min,
                                          service_name, price_cents, price_from, any_staff, name, phone, note, client_id)
  values (r.id, svc.id, who, case when (c ->> 'auto_confirm')::boolean then 'confirmed' else 'requested' end, 'online',
          v_t, svc.duration_min, svc.buffer_min, svc.name, svc.price_cents, svc.price_from, want is null,
          nm, ph, nullif(btrim(p_booking ->> 'note'), ''), cid)
  returning * into x;
  return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', false,
                            'staff', (select name from public.staff where id = who));
end $$;

-- the client's private page
create or replace function public.agenda_status(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', x.status, 'starts_at', x.starts_at, 'ends_at', x.ends_at, 'duration_min', x.duration_min,
    'service', x.service_name, 'price_cents', x.price_cents, 'price_from', x.price_from, 'name', x.name,
    'staff', s.name, 'any_staff', x.any_staff, 'cancelled_by', x.cancelled_by,
    'can_cancel', x.status in ('requested', 'confirmed')
                  and x.starts_at - make_interval(hours => (app.agenda_cfg(r) ->> 'cancel_hours')::int) > now(),
    'salon', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding,
                                'cancel_hours', (app.agenda_cfg(r) ->> 'cancel_hours')::int, 'note', app.agenda_cfg(r) ->> 'note'))
  from public.agenda_appointments x
  join public.restaurants r on r.id = x.restaurant_id
  left join public.staff s on s.restaurant_id = x.restaurant_id and s.id = x.staff_id
  where x.token = p_token and x.starts_at > now() - interval '7 days'
$$;

-- the client cancels, until a few hours before (after that: call the salon)
create or replace function public.agenda_cancel(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.agenda_appointments; r public.restaurants;
begin
  select * into x from public.agenda_appointments where token = p_token for update;
  if x.id is null then perform app.fail('not_found'); end if;
  select * into r from public.restaurants where id = x.restaurant_id;
  if x.status not in ('requested', 'confirmed')
     or x.starts_at - make_interval(hours => (app.agenda_cfg(r) ->> 'cancel_hours')::int) <= now() then
    perform app.fail('too_late');
  end if;
  update public.agenda_appointments set status = 'cancelled', cancelled_by = 'client' where id = x.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.agenda_info(text) from public;
revoke all on function public.agenda_days(text, uuid, uuid) from public;
revoke all on function public.agenda_slots(text, uuid, uuid, date) from public;
revoke all on function public.agenda_book(text, jsonb) from public;
revoke all on function public.agenda_status(text) from public;
revoke all on function public.agenda_cancel(text) from public;
grant execute on function public.agenda_info(text) to anon, authenticated;
grant execute on function public.agenda_days(text, uuid, uuid) to anon, authenticated;
grant execute on function public.agenda_slots(text, uuid, uuid, date) to anon, authenticated;
grant execute on function public.agenda_book(text, jsonb) to anon, authenticated;
grant execute on function public.agenda_status(text) to anon, authenticated;
grant execute on function public.agenda_cancel(text) to anon, authenticated;
revoke all on function app.agenda_blocked(public.restaurants, uuid, tstzrange, uuid) from public, anon, authenticated;
revoke all on function app.agenda_starts(public.restaurants, public.agenda_services, public.staff, date, timestamptz, uuid) from public, anon, authenticated;
revoke all on function app.agenda_day_starts(public.restaurants, public.agenda_services, uuid, date) from public, anon, authenticated;
revoke all on function app.agenda_salon(text) from public, anon, authenticated;
revoke all on function app.agenda_online_service(public.restaurants, uuid) from public, anon, authenticated;

-- Realtime: the salon sees online appointments arrive
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'agenda_appointments') then
    alter publication supabase_realtime add table public.agenda_appointments;
  end if;
end $$;

notify pgrst, 'reload schema';
