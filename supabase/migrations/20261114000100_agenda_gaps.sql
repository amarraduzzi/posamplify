-- =============================================================================
-- AMPLIFY AGENDA (6): closing the gaps
--   - messages in the client's language: the booking page and the Nouba remember it
--   - the Nouba board knows who works now (only they get a "Suivant")
--   - the salon's screen (TV) shows the queue with first names only
-- =============================================================================

alter table public.agenda_appointments add column if not exists lang text check (lang in ('fr', 'ar', 'en'));
alter table public.agenda_queue add column if not exists lang text check (lang in ('fr', 'ar', 'en'));

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
  return jsonb_build_object('open', true, 'working', cardinality(ids), 'staff', to_jsonb(ids), 'starts', starts, 'next', nxt);
end $$;


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
                                          service_name, price_cents, price_from, any_staff, name, phone, note, client_id, lang)
  values (r.id, svc.id, who, case when (c ->> 'auto_confirm')::boolean then 'confirmed' else 'requested' end, 'online',
          v_t, svc.duration_min, svc.buffer_min, svc.name, svc.price_cents, svc.price_from, want is null,
          nm, ph, nullif(btrim(p_booking ->> 'note'), ''), cid,
          case when p_booking ->> 'lang' in ('fr', 'ar', 'en') then p_booking ->> 'lang' end)
  returning * into x;
  return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', false,
                            'staff', (select name from public.staff where id = who));
end $$;


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
  insert into public.agenda_queue (restaurant_id, name, phone, service_id, staff_id, remote, client_id, lang)
  values (r.id, nm, ph, svc, who, far, cid, case when p_entry ->> 'lang' in ('fr', 'ar', 'en') then p_entry ->> 'lang' end) returning * into x;
  return jsonb_build_object('token', x.token, 'duplicate', false);
end $$;


-- the salon's board: who works now, each client's link, language and whether they were told
create or replace function public.nouba_board(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; p jsonb;
begin
  perform app.require_role(p_restaurant_id, 'device', false);
  select * into r from public.restaurants where id = p_restaurant_id;
  p := app.nouba_plan(r, null, null, true);
  return jsonb_build_object('open', (p ->> 'open')::boolean, 'working', (p ->> 'working')::int,
    'staff', coalesce(p -> 'staff', '[]'::jsonb), 'wait_min', app.nouba_wait((p ->> 'next')::timestamptz),
    'queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'status', q.status, 'name', q.name, 'phone', q.phone,
        'service_id', q.service_id, 'staff_id', q.staff_id, 'served_by', q.served_by, 'remote', q.remote, 'coming', q.coming_at is not null,
        'created_at', q.created_at, 'started_at', q.started_at, 'start', p -> 'starts' -> q.id::text,
        'token', q.token, 'notified', q.notified_at is not null, 'lang', q.lang) order by q.created_at)
      from public.agenda_queue q where q.restaurant_id = r.id and q.status in ('waiting', 'serving')), '[]'::jsonb));
end $$;

notify pgrst, 'reload schema';
