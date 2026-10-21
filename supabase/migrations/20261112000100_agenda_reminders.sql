-- =============================================================================
-- AMPLIFY AGENDA (4a): WhatsApp reminders, one tap at a time
--
-- Until the WhatsApp Business API: the salon sends each message from its own WhatsApp with one tap
-- (the message and the link are ready). The salon sees who got a reminder and who confirmed.
--   agenda_appointments.reminded_at        the salon sent the reminder
--   agenda_appointments.client_confirmed_at the client tapped "je confirme" on their page
--   agenda_queue.notified_at                the salon told the client their turn is near
-- =============================================================================

alter table public.agenda_appointments
  add column if not exists reminded_at timestamptz,
  add column if not exists client_confirmed_at timestamptz;
alter table public.agenda_queue
  add column if not exists notified_at timestamptz;

-- the client's page also says whether the client confirmed
create or replace function public.agenda_status(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', x.status, 'starts_at', x.starts_at, 'ends_at', x.ends_at, 'duration_min', x.duration_min,
    'service', x.service_name, 'price_cents', x.price_cents, 'price_from', x.price_from, 'name', x.name,
    'staff', s.name, 'any_staff', x.any_staff, 'cancelled_by', x.cancelled_by,
    'client_confirmed', x.client_confirmed_at is not null,
    'can_confirm', x.status in ('requested', 'confirmed') and x.starts_at > now(),
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

-- Public: the client confirms they are coming (from the reminder's link)
create or replace function public.agenda_confirm(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.agenda_appointments;
begin
  select * into x from public.agenda_appointments where token = p_token for update;
  if x.id is null then perform app.fail('not_found'); end if;
  if x.status not in ('requested', 'confirmed') or x.starts_at <= now() then perform app.fail('too_late'); end if;
  update public.agenda_appointments set client_confirmed_at = coalesce(client_confirmed_at, now()) where id = x.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.agenda_confirm(text) from public;
grant execute on function public.agenda_confirm(text) to anon, authenticated;

-- the salon's board: with the client's link (to send it) and whether they were told
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
        'created_at', q.created_at, 'started_at', q.started_at, 'start', p -> 'starts' -> q.id::text,
        'token', q.token, 'notified', q.notified_at is not null) order by q.created_at)
      from public.agenda_queue q where q.restaurant_id = r.id and q.status in ('waiting', 'serving')), '[]'::jsonb));
end $$;

-- the salon told the client their turn is near
create or replace function public.nouba_notified(p_restaurant_id uuid, p_entry uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'device', true);
  update public.agenda_queue set notified_at = now() where restaurant_id = p_restaurant_id and id = p_entry;
  if not found then perform app.fail('not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.nouba_notified(uuid, uuid) from public, anon;
grant execute on function public.nouba_notified(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
