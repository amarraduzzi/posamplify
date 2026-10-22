-- =============================================================================
-- AMPLIFY AGENDA (salon 12): cabins and equipment (spas, instituts)
--
-- A spa has rooms and machines as well as people: a massage needs a free cabin, a hammam takes up to
-- N clients at once, a laser has one machine. agenda_resources lists them (capacity = how many
-- clients at the same time); a prestation needs one of its resources (agenda_services.resource_ids,
-- empty = none). A free time online needs the person AND a resource; each appointment gets its
-- resource (agenda_appointments.resource_id), chosen automatically or by the salon. On the agenda
-- screen, a cabin taken is a warning the salon can override, like the others.
-- =============================================================================
set lock_timeout = '10s';

create table if not exists public.agenda_resources (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 40),
  kind          text not null default 'cabin' check (kind in ('cabin', 'room', 'equipment')),
  capacity      integer not null default 1 check (capacity between 1 and 30),
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
drop trigger if exists agenda_resources_same_tenant on public.agenda_resources;
create trigger agenda_resources_same_tenant before update on public.agenda_resources for each row execute function app.forbid_restaurant_change();
alter table public.agenda_resources enable row level security;
revoke all on public.agenda_resources from anon, authenticated;
grant select on public.agenda_resources to authenticated;
grant insert (restaurant_id, name, kind, capacity, active, sort_order) on public.agenda_resources to authenticated;
grant update (name, kind, capacity, active, sort_order) on public.agenda_resources to authenticated;
drop policy if exists agenda_resources_select on public.agenda_resources;
create policy agenda_resources_select on public.agenda_resources for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
drop policy if exists agenda_resources_insert on public.agenda_resources;
create policy agenda_resources_insert on public.agenda_resources for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop policy if exists agenda_resources_update on public.agenda_resources;
create policy agenda_resources_update on public.agenda_resources for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

alter table public.agenda_services add column if not exists resource_ids uuid[] not null default '{}' check (cardinality(resource_ids) <= 20);
alter table public.agenda_appointments add column if not exists resource_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_appointments_resource_fk') then
    alter table public.agenda_appointments add constraint agenda_appointments_resource_fk
      foreign key (restaurant_id, resource_id) references public.agenda_resources (restaurant_id, id) on delete set null (resource_id);
  end if;
end $$;
create index if not exists agenda_appointments_resource_idx on public.agenda_appointments (restaurant_id, resource_id, starts_at) where resource_id is not null;

-- the prestation's resources belong to the same salon
create or replace function app.agenda_services_resources()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.resource_ids := coalesce((select array_agg(x.id order by x.sort_order, x.name) from public.agenda_resources x
                                  where x.restaurant_id = new.restaurant_id and x.id = any (new.resource_ids)), '{}');
  return new;
end $$;
drop trigger if exists agenda_services_resources on public.agenda_services;
create trigger agenda_services_resources before insert or update of resource_ids on public.agenda_services
  for each row execute function app.agenda_services_resources();

-- is this resource free in this window (fewer appointments than its capacity)?
create or replace function app.agenda_resource_ok(p_resource uuid, w tstzrange, p_ignore uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select x.active and (select count(*) from public.agenda_appointments a
                        where a.resource_id = x.id and a.status not in ('cancelled', 'no_show') and a.id is distinct from p_ignore
                          and a.starts_at < upper(w) and a.busy_until > lower(w)
                          and not exists (select 1 from public.agenda_deposits d where d.appointment_id = a.id and d.status = 'pending' and d.due_at < now())) < x.capacity
    from public.agenda_resources x where x.id = p_resource
$$;

-- the first free resource among the ones a prestation needs
create or replace function app.agenda_resource_for(p_ids uuid[], w tstzrange, p_ignore uuid default null)
returns uuid language sql stable security definer set search_path = '' as $$
  select x.id from public.agenda_resources x
   where x.id = any (p_ids) and coalesce(app.agenda_resource_ok(x.id, w, p_ignore), false)
   order by x.sort_order, x.name limit 1
$$;
revoke all on function app.agenda_resource_ok(uuid, tstzrange, uuid) from public, anon, authenticated;
revoke all on function app.agenda_resource_for(uuid[], tstzrange, uuid) from public, anon, authenticated;

-- a free time needs the person and, when the prestation asks one, a free resource
create or replace function app.agenda_starts(r public.restaurants, svc public.agenda_services, s public.staff, p_day date,
                                             p_from timestamptz default null, p_ignore uuid default null)
returns setof timestamptz language plpgsql stable security definer set search_path = '' as $$
declare work tstzmultirange; taken tstzmultirange; rg tstzrange; t timestamptz;
        step int := (app.agenda_cfg(r) ->> 'step')::int;
        dur interval := make_interval(mins => svc.duration_min);
        full_dur interval := make_interval(mins => svc.duration_min + svc.buffer_min);
        needs boolean := cardinality(svc.resource_ids) > 0;
begin
  if not app.agenda_can_do(s, svc) then return; end if;
  work := app.agenda_work(r, s, p_day);
  if isempty(work) then return; end if;
  taken := app.agenda_blocked(r, s.id, tstzrange(lower(work), upper(work) + interval '2 hours'), p_ignore);
  for rg in select unnest(work) loop
    for t in select generate_series(lower(rg), upper(rg) - dur, make_interval(mins => step)) loop
      if (p_from is null or t >= p_from) and not (tstzrange(t, t + full_dur) && taken)
         and (not needs or app.agenda_resource_for(svc.resource_ids, tstzrange(t, t + full_dur), p_ignore) is not null) then
        return next t;
      end if;
    end loop;
  end loop;
end $$;

-- every appointment of a prestation that needs a resource gets a free one; none free: an error,
-- unless the salon confirmed anyway on the agenda screen (app.agenda_force)
create or replace function app.agenda_appointments_resource()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ids uuid[]; w tstzrange; pick uuid; forced boolean := coalesce(current_setting('app.agenda_force', true), '') = '1';
begin
  if new.status in ('cancelled', 'no_show', 'done') then return new; end if;
  -- only a new time, length, prestation or resource is checked (not "arrivée", "terminé"...)
  if tg_op = 'UPDATE' and new.starts_at = old.starts_at and new.duration_min = old.duration_min and new.buffer_min = old.buffer_min
     and new.service_id is not distinct from old.service_id and new.resource_id is not distinct from old.resource_id then
    return new;
  end if;
  select resource_ids into ids from public.agenda_services where id = new.service_id;
  ids := coalesce(ids, '{}');
  w := tstzrange(new.starts_at, new.starts_at + make_interval(mins => new.duration_min + new.buffer_min));
  if new.resource_id is not null then
    if app.agenda_resource_ok(new.resource_id, w, new.id) then return new; end if;
    -- the salon chose this one: taken is a warning; moved: another free one of the prestation is taken
    if tg_op = 'UPDATE' and new.resource_id is not distinct from old.resource_id and cardinality(ids) > 0 then
      pick := app.agenda_resource_for(ids, w, new.id);
      if pick is not null then new.resource_id := pick; return new; end if;
    end if;
    if forced then return new; end if;
    perform app.fail('no_resource');
  end if;
  if cardinality(ids) = 0 then return new; end if;
  pick := app.agenda_resource_for(ids, w, new.id);
  if pick is not null then new.resource_id := pick; return new; end if;
  if forced then return new; end if;
  perform app.fail('no_resource');
  return new;
end $$;
drop trigger if exists agenda_appointments_resource on public.agenda_appointments;
create trigger agenda_appointments_resource before insert or update on public.agenda_appointments
  for each row execute function app.agenda_appointments_resource();

-- the agenda screen: the cabin can be chosen; "confirm anyway" also lets a cabin be shared
create or replace function public.agenda_save(p_restaurant_id uuid, p_appt jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; x public.agenda_appointments; svc public.agenda_services; s public.staff;
        aid uuid; res uuid; t timestamptz; dur int; buf int; nm text; ph text; src text; d date; w tstzmultirange;
begin
  perform app.require_role(p_restaurant_id, 'device', true);
  select * into r from public.restaurants where id = p_restaurant_id;
  aid := app.try_uuid(p_appt ->> 'id');
  if aid is not null then
    select * into x from public.agenda_appointments where restaurant_id = r.id and id = aid for update;
    if x.id is null then perform app.fail('not_found'); end if;
  end if;
  -- the prestation (optional when moving: the old one stays)
  if p_appt ? 'service_id' then
    select * into svc from public.agenda_services where restaurant_id = r.id and id = app.try_uuid(p_appt ->> 'service_id');
  elsif x.id is not null then
    select * into svc from public.agenda_services where restaurant_id = r.id and id = x.service_id;
  end if;
  select * into s from public.staff where restaurant_id = r.id and id = app.try_uuid(coalesce(p_appt ->> 'staff_id', x.staff_id::text)) and active;
  if s.id is null then perform app.fail('staff_required'); end if;
  begin t := coalesce((p_appt ->> 'starts_at')::timestamptz, x.starts_at); exception when others then perform app.fail('invalid_request', 'starts_at'); end;
  if t is null then perform app.fail('invalid_request', 'starts_at'); end if;
  dur := coalesce(nullif(p_appt ->> 'duration_min', '')::int, case when p_appt ? 'service_id' then svc.duration_min end, x.duration_min, svc.duration_min, 30);
  buf := coalesce(case when p_appt ? 'service_id' then svc.buffer_min end, x.buffer_min, svc.buffer_min, 0);
  if dur < 5 or dur > 600 then perform app.fail('invalid_request', 'duration'); end if;
  nm := coalesce(nullif(btrim(p_appt ->> 'name'), ''), x.name, 'Client');
  ph := case when p_appt ? 'phone' then nullif(app.norm_phone(p_appt ->> 'phone'), '') else x.phone end;
  src := coalesce(p_appt ->> 'source', x.source, 'staff');
  if src not in ('staff', 'phone', 'walk_in', 'online') then src := 'staff'; end if;
  if length(p_appt ->> 'note') > 300 then perform app.fail('invalid_request', 'too_long'); end if;

  perform pg_advisory_xact_lock(hashtextextended(r.id::text || 'agenda', 0));
  perform set_config('app.agenda_force', case when p_force then '1' else '' end, true);
  res := app.try_uuid(p_appt ->> 'resource_id');
  if res is not null and not exists (select 1 from public.agenda_resources where id = res and restaurant_id = r.id) then perform app.fail('invalid_request', 'resource'); end if;
  if not p_force then
    -- the person does not do this prestation
    if svc.id is not null and not app.agenda_can_do(s, svc) then perform app.fail('cannot_do'); end if;
    if not isempty(app.agenda_blocked(r, s.id, tstzrange(t, t + make_interval(mins => dur + buf)), x.id)) then
      perform app.fail('overlap');
    end if;
    d := (t at time zone r.timezone)::date;
    w := app.agenda_work(r, s, d);
    if not (w @> tstzrange(t, t + make_interval(mins => dur))) then perform app.fail('outside_hours'); end if;
  end if;

  if x.id is null then
    insert into public.agenda_appointments (restaurant_id, service_id, staff_id, status, source, starts_at, duration_min, buffer_min,
                                            service_name, price_cents, price_from, name, phone, note, resource_id)
    values (r.id, svc.id, s.id, 'confirmed', src, t, dur, buf, coalesce(svc.name, '{}'::jsonb), coalesce(svc.price_cents, 0),
            coalesce(svc.price_from, false), left(nm, 60), ph, nullif(btrim(p_appt ->> 'note'), ''), res)
    returning * into x;
  else
    update public.agenda_appointments set
      service_id = svc.id, staff_id = s.id, starts_at = t, duration_min = dur, buffer_min = buf,
      service_name = case when svc.id is distinct from x.service_id then coalesce(svc.name, '{}'::jsonb) else service_name end,
      price_cents = case when svc.id is distinct from x.service_id then coalesce(svc.price_cents, 0) else price_cents end,
      price_from = case when svc.id is distinct from x.service_id then coalesce(svc.price_from, false) else price_from end,
      any_staff = case when s.id is distinct from x.staff_id then false else any_staff end,
      name = left(nm, 60), phone = ph, source = src,
      resource_id = case when p_appt ? 'resource_id' then res else resource_id end,
      note = case when p_appt ? 'note' then nullif(btrim(p_appt ->> 'note'), '') else note end,
      -- a new time: the old reminder and confirmation no longer count
      reminded_at = case when t is distinct from x.starts_at then null else reminded_at end,
      client_confirmed_at = case when t is distinct from x.starts_at then null else client_confirmed_at end
     where id = x.id returning * into x;
  end if;
  return to_jsonb(x) - 'token';
end $$;

notify pgrst, 'reload schema';
