-- =============================================================================
-- AMPLIFY AGENDA (3): la Nouba, the live queue of the salon
--
-- Many salons and barbers work without appointments: you walk in and wait. The Nouba ("your turn"
-- in Darija) shows from home how busy it is (people waiting, an estimated wait), lets a client take
-- a place from home or with the QR at the door, and gives the barber one button: "Suivant".
-- The estimate plans the queue on the people working now, after what they are doing and around
-- their appointments of the agenda. It is an estimate, always shown as a range.
-- Settings in restaurants.agenda:
--   queue (on/off), queue_remote (places from home), queue_remote_max, queue_default_min
-- =============================================================================

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
    'note', left(r.agenda ->> 'note', 300),
    'queue', coalesce((r.agenda ->> 'queue')::boolean, false),
    'queue_remote', coalesce((r.agenda ->> 'queue_remote')::boolean, true),
    'queue_remote_max', least(30, greatest(0, coalesce((r.agenda ->> 'queue_remote_max')::int, 5))),
    'queue_default_min', least(180, greatest(5, coalesce((r.agenda ->> 'queue_default_min')::int, 30))))
$$;

create table if not exists public.agenda_queue (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  status        text not null default 'waiting' check (status in ('waiting', 'serving', 'done', 'left', 'no_show')),
  name          text not null check (length(btrim(name)) between 1 and 60),
  phone         text check (phone is null or phone ~ '^[0-9]{6,15}$'),
  service_id    uuid,
  -- the person asked for; null: the first one free
  staff_id      uuid,
  -- who took the client
  served_by     uuid,
  -- joined from home (or from the salon's QR / the desk)
  remote        boolean not null default false,
  -- the client answered "j'arrive" when the turn came near
  coming_at     timestamptz,
  token         text not null default app.random_token(16) unique,
  client_id     uuid,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, client_id),
  foreign key (restaurant_id, service_id) references public.agenda_services (restaurant_id, id) on delete set null (service_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete set null (staff_id),
  foreign key (restaurant_id, served_by) references public.staff (restaurant_id, id) on delete set null (served_by)
);
create index if not exists agenda_queue_open_idx on public.agenda_queue (restaurant_id, created_at) where status in ('waiting', 'serving');

create or replace function app.agenda_queue_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.restaurant_id := old.restaurant_id; new.token := old.token; new.created_at := old.created_at; new.client_id := old.client_id;
    if new.status is distinct from old.status then
      if new.status = 'serving' then new.started_at := now(); end if;
      if new.status in ('done', 'left', 'no_show') then new.ended_at := now(); end if;
    end if;
  end if;
  if new.phone is not null then new.phone := app.norm_phone(new.phone); end if;
  return new;
end $$;
drop trigger if exists agenda_queue_before on public.agenda_queue;
create trigger agenda_queue_before before insert or update on public.agenda_queue
  for each row execute function app.agenda_queue_before();

alter table public.agenda_queue enable row level security;
grant select on public.agenda_queue to authenticated;
drop policy if exists agenda_queue_select on public.agenda_queue;
create policy agenda_queue_select on public.agenda_queue for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));

-- ------------------------------------------------------------------ the plan
-- minutes a queue entry takes: its prestation (with the time to prepare), or the salon's default
create or replace function app.nouba_minutes(r public.restaurants, p_service uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select duration_min + buffer_min from public.agenda_services where restaurant_id = r.id and id = p_service),
                  (app.agenda_cfg(r) ->> 'queue_default_min')::int)
$$;

-- the first moment from t a person is free for `mins` minutes, around their appointments and days off
create or replace function app.nouba_fit(r public.restaurants, p_staff uuid, t timestamptz, mins int)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare b tstzmultirange; i int := 0;
begin
  loop
    b := app.agenda_blocked(r, p_staff, tstzrange(t, t + make_interval(mins => mins)));
    exit when isempty(b) or i > 12;
    t := upper(b); i := i + 1;
  end loop;
  return t;
end $$;

-- Plans the queue on the people working now. Each waiting client goes, in order, to the person
-- who is free first (the one asked for, if any). With p_service / p_staff: also plans one more
-- client at the end (the estimate shown before joining).
-- Returns {"open": bool, "working": n, "starts": {entry id: start}, "next": start of one more}
create or replace function app.nouba_plan(r public.restaurants, p_service uuid default null, p_staff uuid default null, p_extra boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone r.timezone)::date;
  ids uuid[] := '{}'; free timestamptz[] := '{}'; ends timestamptz[] := '{}';
  s public.staff; w tstzmultirange; rg tstzrange; e record; i int; best int; bt timestamptz; t timestamptz; m int;
  starts jsonb := '{}'; nxt timestamptz;
begin
  -- the people taking clients now, and when each is free (after the client in the chair)
  for s in select * from public.staff where restaurant_id = r.id and active and agenda order by agenda_sort, name loop
    w := app.agenda_work(r, s, today);
    select x into rg from unnest(w) x where x @> now();
    continue when rg is null;
    continue when exists (select 1 from public.agenda_time_off o where o.restaurant_id = r.id and (o.staff_id = s.id or o.staff_id is null)
                           and o.starts_at <= now() and o.ends_at > now());
    ids := ids || s.id;
    ends := ends || upper(rg);
    free := free || greatest(now(), coalesce((select max(q.started_at + make_interval(mins => app.nouba_minutes(r, q.service_id)))
                                               from public.agenda_queue q where q.restaurant_id = r.id and q.status = 'serving' and q.served_by = s.id), now()));
  end loop;
  if cardinality(ids) = 0 then return jsonb_build_object('open', false, 'working', 0, 'starts', '{}'::jsonb, 'next', null); end if;

  for e in select * from (
             select 0 grp, q.created_at, q.id, q.service_id, q.staff_id from public.agenda_queue q
              where q.restaurant_id = r.id and q.status = 'waiting'
             union all select 1, now(), null::uuid, p_service, p_staff where p_extra) z
           order by z.grp, z.created_at loop
    m := app.nouba_minutes(r, e.service_id);
    best := null; bt := null;
    for i in 1 .. cardinality(ids) loop
      continue when e.staff_id is not null and ids[i] <> e.staff_id;
      -- the person does this prestation
      continue when e.service_id is not null and not exists (
        select 1 from public.staff p join public.agenda_services v on v.restaurant_id = p.restaurant_id and v.id = e.service_id
         where p.id = ids[i] and app.agenda_can_do(p, v));
      t := app.nouba_fit(r, ids[i], free[i], m);
      continue when t + make_interval(mins => m) > ends[i] + interval '15 minutes';
      if bt is null or t < bt then best := i; bt := t; end if;
    end loop;
    if best is not null then free[best] := bt + make_interval(mins => m); end if;
    if e.id is null then nxt := bt; else starts := starts || jsonb_build_object(e.id::text, bt); end if;
  end loop;
  return jsonb_build_object('open', true, 'working', cardinality(ids), 'starts', starts, 'next', nxt);
end $$;

-- minutes from now, rounded up to 5
create or replace function app.nouba_wait(t timestamptz)
returns integer language sql stable set search_path = '' as $$
  select case when t is null then null else (ceil(greatest(0, extract(epoch from t - now()) / 60) / 5) * 5)::int end
$$;

-- ------------------------------------------------------------------ public
-- How busy is it now? (the link in the Instagram bio, the salon's website)
create or replace function public.nouba_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; p jsonb;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_agenda(r) then return null; end if;
  c := app.agenda_cfg(r);
  if not (c ->> 'queue')::boolean or not app.is_writable(r) then
    return jsonb_build_object('enabled', false, 'name', r.name, 'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding,
                              'phone', r.phone, 'address', r.address, 'city', r.city, 'booking', (c ->> 'enabled')::boolean);
  end if;
  p := app.nouba_plan(r, null, null, true);
  return jsonb_build_object(
    'enabled', true, 'open', (p ->> 'open')::boolean, 'working', (p ->> 'working')::int,
    'name', r.name, 'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding,
    'phone', r.phone, 'address', r.address, 'city', r.city, 'booking', (c ->> 'enabled')::boolean,
    'remote', (c ->> 'queue_remote')::boolean
              and (select count(*) from public.agenda_queue where restaurant_id = r.id and status = 'waiting' and remote) < (c ->> 'queue_remote_max')::int,
    'waiting', (select count(*) from public.agenda_queue where restaurant_id = r.id and status = 'waiting'),
    'wait_min', app.nouba_wait((p ->> 'next')::timestamptz),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'duration_min', v.duration_min,
        'price_cents', v.price_cents, 'price_from', v.price_from) order by v.sort_order, v.created_at)
      from public.agenda_services v where v.restaurant_id = r.id and v.active), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.agenda_color, 'services', s.agenda_services)
        order by s.agenda_sort, s.name) from public.staff s where s.restaurant_id = r.id and s.active and s.agenda), '[]'::jsonb));
end $$;

-- the estimate for one more client with this prestation / this person
create or replace function public.nouba_estimate(p_slug text, p_service uuid, p_staff uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; p jsonb;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_agenda(r) or not (app.agenda_cfg(r) ->> 'queue')::boolean then perform app.fail('queue_off'); end if;
  p := app.nouba_plan(r, p_service, p_staff, true);
  return jsonb_build_object('open', (p ->> 'open')::boolean, 'wait_min', app.nouba_wait((p ->> 'next')::timestamptz));
end $$;

-- take a place: from home (remote) or with the QR at the door (p_entry.here = true)
create or replace function public.nouba_join(p_slug text, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; x public.agenda_queue; cid uuid; nm text; ph text; svc uuid; who uuid; far boolean; p jsonb;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_agenda(r) then perform app.fail('restaurant_not_found'); end if;
  c := app.agenda_cfg(r);
  if not (c ->> 'queue')::boolean or not app.is_writable(r) then perform app.fail('queue_off'); end if;
  cid := app.try_uuid(p_entry ->> 'client_id');
  if cid is not null then
    select * into x from public.agenda_queue where restaurant_id = r.id and client_id = cid;
    if x.id is not null then return jsonb_build_object('token', x.token, 'duplicate', true); end if;
  end if;
  nm := nullif(btrim(p_entry ->> 'name'), '');
  ph := app.norm_phone(p_entry ->> 'phone');
  if nm is null or length(nm) > 60 or ph is null or ph !~ '^[0-9]{9,15}$' then perform app.fail('customer_required'); end if;
  far := not coalesce((p_entry ->> 'here')::boolean, false);
  svc := app.try_uuid(p_entry ->> 'service_id');
  if svc is not null and not exists (select 1 from public.agenda_services where restaurant_id = r.id and id = svc and active) then svc := null; end if;
  who := app.try_uuid(p_entry ->> 'staff_id');
  if who is not null and not exists (select 1 from public.staff where restaurant_id = r.id and id = who and active and agenda) then who := null; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.id::text || 'nouba', 0));
  if exists (select 1 from public.agenda_queue where restaurant_id = r.id and phone = ph and status = 'waiting') then perform app.fail('already_waiting'); end if;
  if far then
    if not (c ->> 'queue_remote')::boolean
       or (select count(*) from public.agenda_queue where restaurant_id = r.id and status = 'waiting' and remote) >= (c ->> 'queue_remote_max')::int then
      perform app.fail('remote_full');
    end if;
  end if;
  p := app.nouba_plan(r, svc, who, true);
  if not (p ->> 'open')::boolean then perform app.fail('closed'); end if;
  if p ->> 'next' is null then perform app.fail('full_today'); end if;
  insert into public.agenda_queue (restaurant_id, name, phone, service_id, staff_id, remote, client_id)
  values (r.id, nm, ph, svc, who, far, cid) returning * into x;
  return jsonb_build_object('token', x.token, 'duplicate', false);
end $$;

-- the client's page: place in the queue, the estimate, "bientôt à vous"
create or replace function public.nouba_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare x public.agenda_queue; r public.restaurants; p jsonb; st timestamptz;
begin
  select * into x from public.agenda_queue where token = p_token and created_at > now() - interval '18 hours';
  if x.id is null then return null; end if;
  select * into r from public.restaurants where id = x.restaurant_id;
  if x.status = 'waiting' then p := app.nouba_plan(r); st := (p -> 'starts' ->> x.id::text)::timestamptz; end if;
  return jsonb_build_object(
    'status', x.status, 'name', x.name, 'remote', x.remote, 'coming', x.coming_at is not null, 'created_at', x.created_at,
    'ahead', case when x.status = 'waiting' then (select count(*) from public.agenda_queue q where q.restaurant_id = x.restaurant_id
                                                    and q.status = 'waiting' and q.created_at < x.created_at) end,
    'wait_min', app.nouba_wait(st),
    -- the turn is near: from home, time to come
    'soon', x.status = 'waiting' and st is not null and st <= now() + interval '20 minutes',
    'service', (select name from public.agenda_services where id = x.service_id),
    'staff', (select name from public.staff where id = coalesce(x.served_by, x.staff_id)),
    'salon', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding));
end $$;

-- the client answers "j'arrive", or leaves the queue
create or replace function public.nouba_answer(p_token text, p_answer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.agenda_queue;
begin
  select * into x from public.agenda_queue where token = p_token for update;
  if x.id is null or x.status <> 'waiting' then perform app.fail('not_found'); end if;
  if p_answer = 'coming' then update public.agenda_queue set coming_at = coalesce(coming_at, now()) where id = x.id;
  elsif p_answer = 'leave' then update public.agenda_queue set status = 'left' where id = x.id;
  else perform app.fail('invalid_request'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------ the salon
-- the queue for the salon's screen: who waits, the estimate, who is in which chair
create or replace function public.nouba_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; p jsonb;
begin
  perform app.require_role(p_restaurant_id, 'device', false);
  select * into r from public.restaurants where id = p_restaurant_id;
  p := app.nouba_plan(r);
  return jsonb_build_object('open', (p ->> 'open')::boolean, 'working', (p ->> 'working')::int,
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status, 'name', q.name, 'phone', q.phone,
        'service_id', q.service_id, 'staff_id', q.staff_id, 'served_by', q.served_by, 'remote', q.remote, 'coming', q.coming_at is not null,
        'created_at', q.created_at, 'started_at', q.started_at, 'start', p -> 'starts' -> q.id::text) order by q.created_at)
      from public.agenda_queue q where q.restaurant_id = r.id and q.status in ('waiting', 'serving')), '[]'::jsonb));
end $$;

-- the desk adds a client who walks in (the phone is optional here)
create or replace function public.nouba_add(p_restaurant_id uuid, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.agenda_queue; nm text;
begin
  perform app.require_role(p_restaurant_id, 'device', true);
  nm := coalesce(nullif(btrim(p_entry ->> 'name'), ''), 'Client');
  insert into public.agenda_queue (restaurant_id, name, phone, service_id, staff_id, remote)
  values (p_restaurant_id, left(nm, 60), nullif(app.norm_phone(p_entry ->> 'phone'), ''),
          app.try_uuid(p_entry ->> 'service_id'), app.try_uuid(p_entry ->> 'staff_id'), false)
  returning * into x;
  return to_jsonb(x) - 'token';
end $$;

-- "Suivant": the person finishes their client and takes the next one for them (asked for them, or
-- for anyone, in order, if they do the prestation). p_entry: take this one instead (the desk chose).
create or replace function public.nouba_next(p_restaurant_id uuid, p_staff uuid, p_entry uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.staff; x public.agenda_queue;
begin
  perform app.require_role(p_restaurant_id, 'device', true);
  select * into s from public.staff where restaurant_id = p_restaurant_id and id = p_staff and active;
  if s.id is null then perform app.fail('not_found', 'staff'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant_id::text || 'nouba', 0));
  update public.agenda_queue set status = 'done' where restaurant_id = p_restaurant_id and status = 'serving' and served_by = s.id;
  select q.* into x from public.agenda_queue q
   where q.restaurant_id = p_restaurant_id and q.status = 'waiting'
     and (p_entry is null or q.id = p_entry)
     and (p_entry is not null or ((q.staff_id is null or q.staff_id = s.id)
          and (q.service_id is null or exists (select 1 from public.agenda_services v where v.id = q.service_id and app.agenda_can_do(s, v)))))
   order by q.created_at limit 1 for update;
  if x.id is null then return jsonb_build_object('next', null); end if;
  update public.agenda_queue set status = 'serving', served_by = s.id where id = x.id returning * into x;
  return jsonb_build_object('next', to_jsonb(x) - 'token');
end $$;

-- the desk: the client left, did not come back, or the chair is done (no next)
create or replace function public.nouba_set(p_restaurant_id uuid, p_entry uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'device', true);
  if p_status not in ('done', 'left', 'no_show', 'waiting') then perform app.fail('invalid_request'); end if;
  update public.agenda_queue set status = p_status, served_by = case when p_status = 'waiting' then null else served_by end
   where restaurant_id = p_restaurant_id and id = p_entry and status in ('waiting', 'serving');
  if not found then perform app.fail('not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.nouba_info(text) from public;
revoke all on function public.nouba_estimate(text, uuid, uuid) from public;
revoke all on function public.nouba_join(text, jsonb) from public;
revoke all on function public.nouba_status(text) from public;
revoke all on function public.nouba_answer(text, text) from public;
revoke all on function public.nouba_board(uuid) from public, anon;
revoke all on function public.nouba_add(uuid, jsonb) from public, anon;
revoke all on function public.nouba_next(uuid, uuid, uuid) from public, anon;
revoke all on function public.nouba_set(uuid, uuid, text) from public, anon;
grant execute on function public.nouba_info(text) to anon, authenticated;
grant execute on function public.nouba_estimate(text, uuid, uuid) to anon, authenticated;
grant execute on function public.nouba_join(text, jsonb) to anon, authenticated;
grant execute on function public.nouba_status(text) to anon, authenticated;
grant execute on function public.nouba_answer(text, text) to anon, authenticated;
grant execute on function public.nouba_board(uuid) to authenticated;
grant execute on function public.nouba_add(uuid, jsonb) to authenticated;
grant execute on function public.nouba_next(uuid, uuid, uuid) to authenticated;
grant execute on function public.nouba_set(uuid, uuid, text) to authenticated;
revoke all on function app.nouba_plan(public.restaurants, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function app.nouba_fit(public.restaurants, uuid, timestamptz, integer) from public, anon, authenticated;
revoke all on function app.nouba_minutes(public.restaurants, uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'agenda_queue') then
    alter publication supabase_realtime add table public.agenda_queue;
  end if;
end $$;

notify pgrst, 'reload schema';
