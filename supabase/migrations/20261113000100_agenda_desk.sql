-- =============================================================================
-- AMPLIFY AGENDA (5): the salon's agenda screen
--
-- The salon puts an appointment in (a client on the phone or on WhatsApp, a walk-in), moves it,
-- changes the person. The time is checked: on top of another appointment, a day off, or outside
-- the person's hours, the salon gets a warning and can still confirm (p_force), because a salon
-- sometimes does two things at once (a colour that sets while a cut is done).
-- =============================================================================

create or replace function public.agenda_save(p_restaurant_id uuid, p_appt jsonb, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; x public.agenda_appointments; svc public.agenda_services; s public.staff;
        aid uuid; t timestamptz; dur int; buf int; nm text; ph text; src text; d date; w tstzmultirange;
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
  if not p_force then
    if not isempty(app.agenda_blocked(r, s.id, tstzrange(t, t + make_interval(mins => dur + buf)), x.id)) then
      perform app.fail('overlap');
    end if;
    d := (t at time zone r.timezone)::date;
    w := app.agenda_work(r, s, d);
    if not (w @> tstzrange(t, t + make_interval(mins => dur))) then perform app.fail('outside_hours'); end if;
  end if;

  if x.id is null then
    insert into public.agenda_appointments (restaurant_id, service_id, staff_id, status, source, starts_at, duration_min, buffer_min,
                                            service_name, price_cents, price_from, name, phone, note)
    values (r.id, svc.id, s.id, 'confirmed', src, t, dur, buf, coalesce(svc.name, '{}'::jsonb), coalesce(svc.price_cents, 0),
            coalesce(svc.price_from, false), left(nm, 60), ph, nullif(btrim(p_appt ->> 'note'), ''))
    returning * into x;
  else
    update public.agenda_appointments set
      service_id = svc.id, staff_id = s.id, starts_at = t, duration_min = dur, buffer_min = buf,
      service_name = case when svc.id is distinct from x.service_id then coalesce(svc.name, '{}'::jsonb) else service_name end,
      price_cents = case when svc.id is distinct from x.service_id then coalesce(svc.price_cents, 0) else price_cents end,
      price_from = case when svc.id is distinct from x.service_id then coalesce(svc.price_from, false) else price_from end,
      any_staff = case when s.id is distinct from x.staff_id then false else any_staff end,
      name = left(nm, 60), phone = ph, source = src,
      note = case when p_appt ? 'note' then nullif(btrim(p_appt ->> 'note'), '') else note end,
      -- a new time: the old reminder and confirmation no longer count
      reminded_at = case when t is distinct from x.starts_at then null else reminded_at end,
      client_confirmed_at = case when t is distinct from x.starts_at then null else client_confirmed_at end
     where id = x.id returning * into x;
  end if;
  return to_jsonb(x) - 'token';
end $$;
revoke all on function public.agenda_save(uuid, jsonb, boolean) from public, anon;
grant execute on function public.agenda_save(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
