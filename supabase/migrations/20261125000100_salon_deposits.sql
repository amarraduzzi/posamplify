-- =============================================================================
-- AMPLIFY AGENDA (salon 10): deposits (acomptes) and the no-show rules
--
-- A salon asks a deposit for some prestations (agenda_services.deposit_cents) and, if it wants, for
-- every booking of a client who did not come N times (restaurants.agenda -> 'deposit'). The client
-- pays within X hours (bank transfer, CashPlus, the salon's own payment link, or at the salon);
-- unpaid in time, the time is free again and the appointment is cancelled. The salon marks it
-- received in one tap. Paid, it becomes a credit (a card in agenda_giftcards, kind 'deposit') that
-- the till takes off the bill on the day. No-show: the salon keeps it. Cancelled: the salon gives it
-- back or keeps it as a credit. Ready for an online payment provider: provider and reference are
-- stored, a webhook can mark a deposit paid with agenda_deposit_paid later.
-- Settings in restaurants.agenda -> 'deposit':
--   enabled, after_no_shows (0 = never), noshow_cents, hours (to pay), rib, rib_name, bank,
--   cashplus, link (https), note
-- The till also takes payments that are not cash or card (transfer, CashPlus, a payment link).
-- =============================================================================
set lock_timeout = '10s';

alter table public.agenda_services add column if not exists deposit_cents bigint not null default 0 check (deposit_cents between 0 and 10000000);

alter table public.agenda_sales add column if not exists other_cents bigint not null default 0 check (other_cents >= 0);
alter table public.agenda_sales add column if not exists other_method text check (other_method in ('transfer', 'cashplus', 'link', 'other'));
alter table public.agenda_sales drop constraint if exists agenda_sales_payment_check;
alter table public.agenda_sales add constraint agenda_sales_payment_check check (cash_cents + card_cents + other_cents + prepaid_cents = total_cents + tip_cents);
alter table public.agenda_giftcards add column if not exists kind text not null default 'gift' check (kind in ('gift', 'deposit'));

create table if not exists public.agenda_deposits (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  appointment_id uuid not null,
  amount_cents   bigint not null check (amount_cents between 1000 and 10000000),
  reason         text not null default 'manual' check (reason in ('service', 'no_shows', 'manual')),
  status         text not null default 'pending'
                 check (status in ('pending', 'paid', 'expired', 'cancelled', 'to_settle', 'kept', 'credited', 'refunded')),
  due_at         timestamptz,
  method         text check (method in ('cash', 'card', 'transfer', 'cashplus', 'link', 'other')),
  provider       text check (length(provider) <= 40),
  provider_ref   text check (length(provider_ref) <= 120),
  client_ref     text check (length(client_ref) <= 120),
  client_reported_at timestamptz,
  paid_at        timestamptz,
  sale_id        uuid,
  giftcard_id    uuid,
  settled_at     timestamptz,
  settle_note    text check (length(settle_note) <= 200),
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (appointment_id),
  foreign key (restaurant_id, appointment_id) references public.agenda_appointments (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete set null (sale_id),
  foreign key (restaurant_id, giftcard_id) references public.agenda_giftcards (restaurant_id, id) on delete set null (giftcard_id)
);
create index if not exists agenda_deposits_idx on public.agenda_deposits (restaurant_id, status, due_at);
drop trigger if exists agenda_deposits_same_tenant on public.agenda_deposits;
create trigger agenda_deposits_same_tenant before update on public.agenda_deposits for each row execute function app.forbid_restaurant_change();
alter table public.agenda_deposits enable row level security;
revoke all on public.agenda_deposits from anon, authenticated;
grant select on public.agenda_deposits to authenticated;
drop policy if exists agenda_deposits_select on public.agenda_deposits;
create policy agenda_deposits_select on public.agenda_deposits for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));

-- the deposit settings, checked
create or replace function app.agenda_deposit_cfg(r public.restaurants)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((r.agenda -> 'deposit' ->> 'enabled')::boolean, false),
    'after_no_shows', least(10, greatest(0, coalesce((r.agenda -> 'deposit' ->> 'after_no_shows')::int, 0))),
    'noshow_cents', least(10000000, greatest(1000, coalesce((r.agenda -> 'deposit' ->> 'noshow_cents')::bigint, 10000))),
    'hours', least(72, greatest(1, coalesce((r.agenda -> 'deposit' ->> 'hours')::int, 24))))
$$;

-- how the client pays: only what the salon filled in
create or replace function app.agenda_deposit_pay(r public.restaurants)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'rib', nullif(left(btrim(r.agenda -> 'deposit' ->> 'rib'), 40), ''),
    'rib_name', nullif(left(btrim(r.agenda -> 'deposit' ->> 'rib_name'), 60), ''),
    'bank', nullif(left(btrim(r.agenda -> 'deposit' ->> 'bank'), 40), ''),
    'cashplus', nullif(left(btrim(r.agenda -> 'deposit' ->> 'cashplus'), 80), ''),
    'link', case when r.agenda -> 'deposit' ->> 'link' ~ '^https://[^\s]{4,}$' and length(r.agenda -> 'deposit' ->> 'link') <= 300 then r.agenda -> 'deposit' ->> 'link' end,
    'note', nullif(left(btrim(r.agenda -> 'deposit' ->> 'note'), 300), '')))
$$;

create or replace function app.agenda_noshows(r public.restaurants, p_phone text)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.agenda_appointments where restaurant_id = r.id and phone = p_phone and status = 'no_show'
$$;
revoke all on function app.agenda_noshows(public.restaurants, text) from public, anon, authenticated;

-- the deposit a booking needs: the prestation's, or the no-show rule's (the higher one)
create or replace function app.agenda_deposit_need(r public.restaurants, p_service uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb := app.agenda_deposit_cfg(r); svc bigint := 0; ns int := 0; rule bigint := 0;
begin
  if not (c ->> 'enabled')::boolean then return jsonb_build_object('amount_cents', 0, 'reason', null, 'no_shows', 0); end if;
  select deposit_cents into svc from public.agenda_services where id = p_service and restaurant_id = r.id;
  if p_phone is not null then ns := app.agenda_noshows(r, p_phone); end if;
  if (c ->> 'after_no_shows')::int > 0 and ns >= (c ->> 'after_no_shows')::int then rule := (c ->> 'noshow_cents')::bigint; end if;
  return jsonb_build_object('amount_cents', greatest(coalesce(svc, 0), rule),
    'reason', case when greatest(coalesce(svc, 0), rule) = 0 then null when rule > coalesce(svc, 0) then 'no_shows' else 'service' end, 'no_shows', ns);
end $$;
revoke all on function app.agenda_deposit_need(public.restaurants, uuid, text) from public, anon, authenticated;

-- when the client has to pay by: X hours, at the latest one hour before (never less than 30 minutes)
create or replace function app.agenda_deposit_due(r public.restaurants, p_start timestamptz, p_hours int default null)
returns timestamptz language sql stable set search_path = '' as $$
  select least(p_start, greatest(now() + interval '30 minutes',
         least(now() + make_interval(hours => coalesce(p_hours, (app.agenda_deposit_cfg(r) ->> 'hours')::int)), p_start - interval '1 hour')))
$$;

-- unpaid in time: the appointment is cancelled, the time is free again
create or replace function app.agenda_deposit_expire(r public.restaurants)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare x public.agenda_deposits;
begin
  for x in select * from public.agenda_deposits where restaurant_id = r.id and status = 'pending' and due_at < now() for update loop
    update public.agenda_deposits set status = 'expired' where id = x.id;
    update public.agenda_appointments set status = 'cancelled', cancelled_by = 'salon'
     where id = x.appointment_id and status in ('requested', 'confirmed');
  end loop;
end $$;
revoke all on function app.agenda_deposit_expire(public.restaurants) from public, anon, authenticated;

-- an appointment whose deposit was not paid in time does not hold the time any more
create or replace function app.agenda_blocked(r public.restaurants, p_staff uuid, w tstzrange, p_ignore uuid default null)
returns tstzmultirange language sql stable security definer set search_path = '' as $$
  select coalesce(range_agg(x), '{}'::tstzmultirange) from (
    select tstzrange(a.starts_at, a.busy_until) x from public.agenda_appointments a
     where a.restaurant_id = r.id and a.staff_id = p_staff and a.status not in ('cancelled', 'no_show')
       and a.starts_at < upper(w) and a.busy_until > lower(w) and a.id is distinct from p_ignore
       and not exists (select 1 from public.agenda_deposits d where d.appointment_id = a.id and d.status = 'pending' and d.due_at < now())
    union all
    select tstzrange(o.starts_at, o.ends_at) from public.agenda_time_off o
     where o.restaurant_id = r.id and (o.staff_id = p_staff or o.staff_id is null)
       and o.starts_at < upper(w) and o.ends_at > lower(w)) q
$$;

-- the appointment changes: a deposit not paid is dropped; a paid one is kept (no-show) or waits for
-- the salon to give it back or keep it as a credit (cancelled)
create or replace function app.agenda_deposit_on_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare x public.agenda_deposits;
begin
  if new.status is not distinct from old.status then return new; end if;
  select * into x from public.agenda_deposits where appointment_id = new.id for update;
  if x.id is null then return new; end if;
  if new.status in ('cancelled', 'no_show', 'done', 'arrived') and x.status = 'pending' then
    update public.agenda_deposits set status = case when x.due_at < now() and new.status = 'cancelled' then 'expired' else 'cancelled' end where id = x.id;
  elsif new.status = 'no_show' and x.status = 'paid' then
    update public.agenda_deposits set status = 'kept', settled_at = now(), settle_note = 'No-show' where id = x.id;
    update public.agenda_giftcards set cancelled_at = now() where id = x.giftcard_id and cancelled_at is null;
  elsif new.status = 'cancelled' and x.status = 'paid' then
    update public.agenda_deposits set status = 'to_settle' where id = x.id;
  elsif new.status in ('requested', 'confirmed') and old.status = 'no_show' and x.status = 'kept' and x.settle_note = 'No-show' then
    -- a no-show put back by mistake: the credit comes back
    update public.agenda_deposits set status = 'paid', settled_at = null, settle_note = null where id = x.id;
    update public.agenda_giftcards set cancelled_at = null where id = x.giftcard_id;
  end if;
  return new;
end $$;
drop trigger if exists agenda_deposit_on_status on public.agenda_appointments;
create trigger agenda_deposit_on_status after update of status on public.agenda_appointments
  for each row execute function app.agenda_deposit_on_status();

-- the booking page: which prestations ask a deposit
create or replace function public.agenda_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; dep boolean;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null or not app.has_agenda(r) then return null; end if;
  c := app.agenda_cfg(r); dep := (app.agenda_deposit_cfg(r) ->> 'enabled')::boolean;
  return jsonb_build_object(
    'enabled', (c ->> 'enabled')::boolean and app.is_writable(r),
    'name', r.name, 'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding,
    'phone', r.phone, 'address', r.address, 'city', r.city, 'note', c ->> 'note',
    'days_ahead', (c ->> 'days_ahead')::int, 'cancel_hours', (c ->> 'cancel_hours')::int, 'any_staff', (c ->> 'any_staff')::boolean,
    'deposit_hours', case when dep then (app.agenda_deposit_cfg(r) ->> 'hours')::int end,
    'services', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'description', v.description, 'category', v.category, 'duration_min', v.duration_min,
        'price_cents', v.price_cents, 'price_from', v.price_from, 'deposit_cents', case when dep then v.deposit_cents else 0 end) order by v.sort_order, v.created_at)
      from public.agenda_services v where v.restaurant_id = r.id and v.active and v.online), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.agenda_color, 'services', s.agenda_services)
                                        order by s.agenda_sort, s.name)
      from public.staff s where s.restaurant_id = r.id and s.active and s.agenda), '[]'::jsonb));
end $$;

-- the online booking: with the deposit the prestation or the client's no-shows ask for
create or replace function public.agenda_book(p_slug text, p_booking jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants := app.agenda_salon(p_slug); c jsonb := app.agenda_cfg(r); svc public.agenda_services;
        x public.agenda_appointments; cid uuid; v_t timestamptz; d date; ph text; nm text; who uuid; want uuid; need jsonb; dep public.agenda_deposits;
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
  if (select count(*) from public.agenda_appointments where restaurant_id = r.id and phone = ph
        and status in ('requested', 'confirmed') and starts_at > now()) >= 3 then
    perform app.fail('rate_limited');
  end if;
  d := (v_t at time zone r.timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended(r.id::text || 'agenda', 0));
  perform app.agenda_deposit_expire(r);
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
  need := app.agenda_deposit_need(r, svc.id, ph);
  if (need ->> 'amount_cents')::bigint >= 1000 then
    insert into public.agenda_deposits (restaurant_id, appointment_id, amount_cents, reason, due_at)
    values (r.id, x.id, (need ->> 'amount_cents')::bigint, need ->> 'reason', app.agenda_deposit_due(r, x.starts_at))
    returning * into dep;
  end if;
  return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', false,
                            'staff', (select name from public.staff where id = who),
                            'deposit', case when dep.id is not null then jsonb_build_object('amount_cents', dep.amount_cents, 'due_at', dep.due_at, 'reason', dep.reason) end);
end $$;

-- the client's page: the deposit, how to pay it, and whether the salon received it
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
    'deposit', (select jsonb_build_object('amount_cents', d.amount_cents, 'reason', d.reason, 'due_at', d.due_at,
                  'status', case when d.status = 'pending' and d.due_at < now() then 'expired' else d.status end,
                  'reported', d.client_reported_at is not null,
                  'pay', case when d.status = 'pending' then app.agenda_deposit_pay(r) end)
                from public.agenda_deposits d where d.appointment_id = x.id),
    'salon', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding - 'guest_actions', 'handle', app.salon_handle(r),
                                'cancel_hours', (app.agenda_cfg(r) ->> 'cancel_hours')::int, 'note', app.agenda_cfg(r) ->> 'note'))
  from public.agenda_appointments x
  join public.restaurants r on r.id = x.restaurant_id
  left join public.staff s on s.restaurant_id = x.restaurant_id and s.id = x.staff_id
  where x.token = p_token and x.starts_at > now() - interval '7 days'
$$;

-- Public: the client says she paid (and gives the reference of the transfer)
create or replace function public.agenda_deposit_report(p_token text, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.agenda_appointments; dp public.agenda_deposits;
begin
  select * into x from public.agenda_appointments where token = p_token;
  if x.id is null then perform app.fail('not_found'); end if;
  select * into dp from public.agenda_deposits where appointment_id = x.id for update;
  if dp.id is null or dp.status <> 'pending' or dp.due_at < now() then perform app.fail('too_late'); end if;
  update public.agenda_deposits set client_reported_at = now(), client_ref = nullif(left(btrim(p_ref), 120), '') where id = dp.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.agenda_deposit_report(text, text) from public;
grant execute on function public.agenda_deposit_report(text, text) to anon, authenticated;

-- ------------------------------------------------------------------ the salon's side

-- the deposit a booking would need (the agenda screen proposes it)
create or replace function public.agenda_deposit_rule(p_restaurant_id uuid, p_service uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  return app.agenda_deposit_need(r, p_service, app.norm_phone(nullif(p_phone, '')))
         || jsonb_build_object('enabled', (app.agenda_deposit_cfg(r) ->> 'enabled')::boolean, 'hours', (app.agenda_deposit_cfg(r) ->> 'hours')::int);
end $$;

-- ask (or change, or drop with 0) the deposit of an appointment
create or replace function public.agenda_deposit_request(p_restaurant_id uuid, p_appointment uuid, p_amount_cents bigint, p_hours int default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; a public.agenda_appointments; dp public.agenda_deposits;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  select * into a from public.agenda_appointments where id = p_appointment and restaurant_id = r.id for update;
  if a.id is null then perform app.fail('not_found'); end if;
  if a.status not in ('requested', 'confirmed') or a.starts_at <= now() then perform app.fail('too_late'); end if;
  if p_amount_cents is null or (p_amount_cents <> 0 and p_amount_cents not between 1000 and 10000000) then perform app.fail('invalid_request', 'amount'); end if;
  if p_hours is not null and p_hours not between 1 and 72 then perform app.fail('invalid_request', 'hours'); end if;
  select * into dp from public.agenda_deposits where appointment_id = a.id for update;
  if dp.id is not null and dp.status not in ('pending', 'expired', 'cancelled') then perform app.fail('deposit_paid'); end if;
  if p_amount_cents = 0 then
    delete from public.agenda_deposits where id = dp.id;
    return jsonb_build_object('ok', true, 'deposit', null);
  end if;
  if dp.id is null then
    insert into public.agenda_deposits (restaurant_id, appointment_id, amount_cents, reason, due_at)
    values (r.id, a.id, p_amount_cents, 'manual', app.agenda_deposit_due(r, a.starts_at, p_hours)) returning * into dp;
  else
    update public.agenda_deposits set amount_cents = p_amount_cents, status = 'pending', due_at = app.agenda_deposit_due(r, a.starts_at, p_hours),
           client_reported_at = null, client_ref = null where id = dp.id returning * into dp;
  end if;
  return jsonb_build_object('ok', true, 'deposit', to_jsonb(dp));
end $$;

-- the salon received the deposit: on the till (cash, card) or elsewhere (transfer, CashPlus, a
-- payment link). It becomes a credit the till takes off the bill on the day. A payment provider's
-- webhook can call this later with its name and reference.
create or replace function public.agenda_deposit_paid(p_restaurant_id uuid, p_appointment uuid, p_method text, p_ref text default null,
                                                      p_cashier uuid default null, p_provider text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; a public.agenda_appointments; dp public.agenda_deposits; res jsonb; gid uuid; sid uuid; v_code text;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if p_method is null or p_method not in ('cash', 'card', 'transfer', 'cashplus', 'link', 'other') then perform app.fail('invalid_request', 'method'); end if;
  if p_cashier is not null and not exists (select 1 from public.staff where id = p_cashier and restaurant_id = r.id and active) then
    perform app.fail('invalid_request', 'cashier');
  end if;
  select * into a from public.agenda_appointments where id = p_appointment and restaurant_id = r.id for update;
  if a.id is null then perform app.fail('not_found'); end if;
  select * into dp from public.agenda_deposits where appointment_id = a.id for update;
  if dp.id is null then perform app.fail('not_found'); end if;
  if dp.status <> 'pending' then perform app.fail('deposit_paid'); end if;
  if a.status not in ('requested', 'confirmed', 'arrived') then perform app.fail('too_late'); end if;
  perform set_config('app.cashier', coalesce(p_cashier::text, ''), true);
  res := public.agenda_checkout(r.id, jsonb_build_object(
    'name', a.name, 'lines', jsonb_build_array(jsonb_build_object('kind', 'giftcard', 'unit_cents', dp.amount_cents, 'name', a.name)),
    'cash_cents', case when p_method = 'cash' then dp.amount_cents else 0 end,
    'card_cents', case when p_method = 'card' then dp.amount_cents else 0 end,
    'other_cents', case when p_method not in ('cash', 'card') then dp.amount_cents else 0 end,
    'other_method', case when p_method not in ('cash', 'card') then p_method end));
  sid := (res ->> 'id')::uuid; gid := (res -> 'made' -> 0 ->> 'id')::uuid;
  update public.agenda_giftcards set kind = 'deposit', code = 'ACP-' || substr(code, 5) where id = gid returning agenda_giftcards.code into v_code;
  update public.agenda_sale_lines set name = left('Acompte ' || v_code || ' · ' || coalesce(a.service_name ->> 'fr', a.service_name ->> 'ar', 'RDV')
                                              || ' ' || to_char(a.starts_at at time zone r.timezone, 'DD/MM HH24:MI'), 80)
   where sale_id = sid and giftcard_id = gid;
  update public.agenda_deposits set status = 'paid', method = p_method, paid_at = now(), sale_id = sid, giftcard_id = gid,
         provider = nullif(left(btrim(p_provider), 40), ''), provider_ref = coalesce(nullif(left(btrim(p_ref), 120), ''), client_ref)
   where id = dp.id;
  -- paid: the appointment is sure
  if a.status = 'requested' then update public.agenda_appointments set status = 'confirmed' where id = a.id; end if;
  return jsonb_build_object('ok', true, 'code', v_code, 'number', (res ->> 'number')::int, 'amount_cents', dp.amount_cents, 'sale_id', sid);
end $$;

-- after a cancellation: give it back, keep it as a credit for a next visit, or keep it
create or replace function public.agenda_deposit_settle(p_restaurant_id uuid, p_deposit uuid, p_action text, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; dp public.agenda_deposits; s public.agenda_sales; g public.agenda_giftcards; back boolean := false;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if p_action not in ('refund', 'credit', 'keep') then perform app.fail('invalid_request', 'action'); end if;
  select * into dp from public.agenda_deposits where id = p_deposit and restaurant_id = r.id for update;
  if dp.id is null then perform app.fail('not_found'); end if;
  if dp.status not in ('to_settle', 'kept', 'credited') then perform app.fail('invalid_request', 'status'); end if;
  select * into g from public.agenda_giftcards where id = dp.giftcard_id;
  if g.id is not null and g.balance_cents < g.initial_cents and p_action = 'refund' then perform app.fail('deposit_used'); end if;
  if p_action = 'refund' then
    -- paid at the till today and the day is still open: the ticket is cancelled, the drawer stays right
    select * into s from public.agenda_sales where id = dp.sale_id;
    if s.id is not null and s.cancelled_at is null and s.business_date = app.business_date(r)
       and not exists (select 1 from public.agenda_closings where restaurant_id = r.id and business_date = s.business_date) then
      update public.agenda_sales set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = 'Acompte remboursé' where id = s.id;
      back := true;
    else
      update public.agenda_giftcards set cancelled_at = coalesce(cancelled_at, now()) where id = g.id;
    end if;
    update public.agenda_deposits set status = 'refunded', settled_at = now(), settle_note = nullif(left(btrim(p_note), 200), '') where id = dp.id;
  elsif p_action = 'credit' then
    update public.agenda_giftcards set cancelled_at = null, expires_on = greatest(expires_on, app.business_date(r) + 180) where id = g.id;
    update public.agenda_deposits set status = 'credited', settled_at = now(), settle_note = nullif(left(btrim(p_note), 200), '') where id = dp.id;
  else
    update public.agenda_giftcards set cancelled_at = coalesce(cancelled_at, now()) where id = g.id;
    update public.agenda_deposits set status = 'kept', settled_at = now(), settle_note = nullif(left(btrim(p_note), 200), '') where id = dp.id;
  end if;
  return jsonb_build_object('ok', true, 'ticket_cancelled', back, 'code', g.code);
end $$;

-- a deposit ticket cancelled by mistake: the deposit waits again
create or replace function app.agenda_deposit_sale_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.agenda_deposits set status = 'pending', method = null, paid_at = null, sale_id = null, giftcard_id = null,
           due_at = greatest(due_at, now() + interval '30 minutes')
     where sale_id = new.id and status = 'paid';
  end if;
  return new;
end $$;
drop trigger if exists agenda_deposit_sale_cancel on public.agenda_sales;
create trigger agenda_deposit_sale_cancel after update of cancelled_at on public.agenda_sales for each row execute function app.agenda_deposit_sale_cancel();

-- the deposits of the salon: to receive, to settle, and the ones of the coming days
create or replace function public.agenda_deposits(p_restaurant_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if app.is_writable(r) then perform app.agenda_deposit_expire(r); end if;
  return jsonb_build_object(
    'cfg', app.agenda_deposit_cfg(r), 'pay', app.agenda_deposit_pay(r),
    'list', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'appointment_id', d.appointment_id, 'amount_cents', d.amount_cents, 'reason', d.reason,
               'status', d.status, 'due_at', d.due_at, 'method', d.method, 'paid_at', d.paid_at, 'reported', d.client_reported_at is not null,
               'client_ref', d.client_ref, 'provider_ref', d.provider_ref, 'settle_note', d.settle_note, 'settled_at', d.settled_at,
               'code', g.code, 'balance_cents', case when g.cancelled_at is null then g.balance_cents else 0 end,
               'name', a.name, 'phone', a.phone, 'starts_at', a.starts_at, 'service', a.service_name, 'staff_id', a.staff_id, 'appt_status', a.status,
               'token', a.token)
               order by case d.status when 'to_settle' then 0 when 'pending' then 1 else 2 end, a.starts_at)
       from public.agenda_deposits d
       join public.agenda_appointments a on a.id = d.appointment_id
       left join public.agenda_giftcards g on g.id = d.giftcard_id
      where d.restaurant_id = r.id
        and (d.status in ('pending', 'to_settle')
             or (d.status = 'paid' and a.starts_at > now() - interval '2 days')
             or coalesce(d.settled_at, d.paid_at, d.created_at) > now() - interval '14 days')), '[]'::jsonb));
end $$;

-- the deposit of one appointment (the till takes it off the bill)
create or replace function public.agenda_appt_deposit(p_restaurant_id uuid, p_appointment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  return (select jsonb_build_object('status', d.status, 'amount_cents', d.amount_cents, 'due_at', d.due_at, 'method', d.method,
            'code', g.code, 'balance_cents', case when g.cancelled_at is null then g.balance_cents else 0 end)
            from public.agenda_deposits d left join public.agenda_giftcards g on g.id = d.giftcard_id
           where d.restaurant_id = r.id and d.appointment_id = p_appointment);
end $$;

do $$ declare f text; begin
  foreach f in array array['agenda_deposit_rule(uuid, uuid, text)', 'agenda_deposit_request(uuid, uuid, bigint, integer)',
                           'agenda_deposit_paid(uuid, uuid, text, text, uuid, text)', 'agenda_deposit_settle(uuid, uuid, text, text)',
                           'agenda_deposits(uuid)', 'agenda_appt_deposit(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- the gift cards of the salon: the deposits have their own list
create or replace function public.agenda_prepaid_list(p_restaurant_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'packs', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'client', p.client_name, 'phone', p.phone, 'left', p.sessions_left, 'total', p.sessions_total,
                         'price_cents', p.price_cents, 'paid_cents', p.paid_cents, 'expires_on', p.expires_on, 'created_at', p.created_at) order by p.created_at desc)
       from public.agenda_client_packs p where p.restaurant_id = r.id and p.cancelled_at is null and (p.sessions_left > 0 or p.paid_cents < p.price_cents)), '[]'::jsonb),
    'giftcards', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'for', g.for_name, 'initial_cents', g.initial_cents, 'balance_cents', g.balance_cents,
                         'expires_on', g.expires_on, 'created_at', g.created_at, 'kind', g.kind) order by g.created_at desc)
       from public.agenda_giftcards g where g.restaurant_id = r.id and g.cancelled_at is null and g.balance_cents > 0), '[]'::jsonb),
    'outstanding_cents', (select coalesce(sum(balance_cents), 0) from public.agenda_giftcards where restaurant_id = r.id and cancelled_at is null and expires_on >= app.business_date(r))
                       + (select coalesce(sum(round(price_cents::numeric * sessions_left / sessions_total)), 0) from public.agenda_client_packs where restaurant_id = r.id and cancelled_at is null and expires_on >= app.business_date(r))::bigint);
end $$;

-- Encaisser: also a payment that is not cash or card (a transfer, CashPlus, a payment link)
-- Encaisser, complete. p: { appointment_id?, queue_id?, name?, phone?, staff_id?,
--   lines: [ {kind 'service', service_id?, unit_cents, quantity?, staff_id?, use_pack?}   (use_pack: a client pack, one session)
--          | {kind 'product', product_id, unit_cents, quantity?, staff_id?} | {kind 'other', name, unit_cents, quantity?}
--          | {kind 'pack', pack_id, unit_cents (paid now)} | {kind 'pack_payment', client_pack_id, unit_cents}
--          | {kind 'giftcard', unit_cents, name? (for whom)} ],
--   discount_cents?, discount_reason?, free_reason?, voucher_code?, loyalty?, giftcard_code?, giftcard_cents?,
--   cash_cents, card_cents, other_cents? + other_method? (transfer, cashplus, link, other), tip_cents? }
create or replace function public.agenda_checkout(p_restaurant_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants; d date; a public.agenda_appointments; q public.agenda_queue; l jsonb; v public.agenda_services;
  sid uuid; num int; sub bigint := 0; disc bigint; tot bigint; tip bigint; cash bigint; card bigint; other bigint; omethod text; prepaid bigint := 0;
  ph text; nm text; who uuid; cust uuid; i int := 0; ln_staff uuid; ln_name text; ln_qty int; ln_unit bigint; ln_kind text; pr public.agenda_products;
  counted_price bigint := 0; vo public.agenda_vouchers; vdisc bigint := 0; reason text;
  cp public.agenda_client_packs; pk public.agenda_packs; gc public.agenda_giftcards; gcp bigint := 0;
  uses jsonb := '{}'::jsonb; pays jsonb := '{}'::jsonb; units jsonb := '[]'::jsonb;
  lc jsonb := '{}'::jsonb; lred bigint := 0; loyal boolean := coalesce((p ->> 'loyalty')::boolean, false);
  new_cp uuid; new_gc uuid; gcode text; made jsonb := '[]'::jsonb; tries int;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if not 'agenda' = any (r.products) then perform app.fail('not_allowed'); end if;
  d := app.business_date(r);
  if exists (select 1 from public.agenda_closings where restaurant_id = r.id and business_date = d) then perform app.fail('day_closed'); end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') not between 1 and 30 then perform app.fail('invalid_request', 'lines'); end if;

  nm := nullif(btrim(p ->> 'name'), ''); ph := app.norm_phone(nullif(p ->> 'phone', '')); who := nullif(p ->> 'staff_id', '')::uuid;
  if nullif(p ->> 'appointment_id', '') is not null then
    select * into a from public.agenda_appointments where id = (p ->> 'appointment_id')::uuid and restaurant_id = r.id for update;
    if a.id is null or a.status in ('cancelled', 'no_show') then perform app.fail('invalid_request', 'appointment'); end if;
    if exists (select 1 from public.agenda_sales where appointment_id = a.id and cancelled_at is null) then perform app.fail('already_paid'); end if;
    nm := coalesce(nm, a.name); ph := coalesce(ph, a.phone); who := coalesce(who, a.staff_id);
  elsif nullif(p ->> 'queue_id', '') is not null then
    select * into q from public.agenda_queue where id = (p ->> 'queue_id')::uuid and restaurant_id = r.id for update;
    if q.id is null or q.status in ('left', 'no_show') then perform app.fail('invalid_request', 'queue'); end if;
    if exists (select 1 from public.agenda_sales where queue_id = q.id and cancelled_at is null) then perform app.fail('already_paid'); end if;
    nm := coalesce(nm, q.name); ph := coalesce(ph, q.phone); who := coalesce(who, q.served_by, q.staff_id);
  end if;
  if who is not null and not exists (select 1 from public.staff where id = who and restaurant_id = r.id) then perform app.fail('invalid_request', 'staff'); end if;
  if ph is not null and ph !~ '^\+?[0-9]{6,15}$' then ph := null; end if;

  -- the lines: checked and priced before anything is written (units: the price of each line)
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := coalesce(l ->> 'kind', case when nullif(l ->> 'product_id', '') is not null then 'product' else 'service' end);
    if ln_kind not in ('service', 'product', 'other', 'pack', 'pack_payment', 'giftcard') then perform app.fail('invalid_request', 'kind'); end if;
    ln_unit := (l ->> 'unit_cents')::bigint; ln_qty := coalesce((l ->> 'quantity')::int, 1);
    if nullif(l ->> 'staff_id', '') is not null and not exists (select 1 from public.staff where id = (l ->> 'staff_id')::uuid and restaurant_id = r.id) then
      perform app.fail('invalid_request', 'staff');
    end if;
    if nullif(l ->> 'service_id', '') is not null and not exists (select 1 from public.agenda_services where id = (l ->> 'service_id')::uuid and restaurant_id = r.id) then
      perform app.fail('invalid_request', 'service');
    end if;
    if ln_kind = 'product' and nullif(l ->> 'product_id', '') is not null
       and not exists (select 1 from public.agenda_products where id = (l ->> 'product_id')::uuid and restaurant_id = r.id and kind = 'retail') then
      perform app.fail('invalid_request', 'product');
    end if;
    if ln_kind = 'service' and nullif(l ->> 'use_pack', '') is not null then
      -- a session of a pack: one per line, at the value of a session, paid by the pack
      select * into cp from public.agenda_client_packs where id = app.try_uuid(l ->> 'use_pack') and restaurant_id = r.id for update;
      if cp.id is null or cp.cancelled_at is not null or cp.expires_on < d then perform app.fail('pack_unknown'); end if;
      if ph is null or cp.phone <> ph then perform app.fail('pack_not_client'); end if;
      if cp.service_id is not null and nullif(l ->> 'service_id', '') is not null and cp.service_id <> (l ->> 'service_id')::uuid then perform app.fail('pack_other_service'); end if;
      uses := jsonb_set(uses, array[cp.id::text], to_jsonb(coalesce((uses ->> cp.id::text)::int, 0) + 1));
      if (uses ->> cp.id::text)::int > cp.sessions_left then perform app.fail('pack_empty'); end if;
      ln_unit := round(cp.price_cents::numeric / cp.sessions_total)::bigint; ln_qty := 1;
      prepaid := prepaid + ln_unit;
    elsif ln_kind = 'pack' then
      select * into pk from public.agenda_packs where id = app.try_uuid(l ->> 'pack_id') and restaurant_id = r.id and active;
      if pk.id is null then perform app.fail('invalid_request', 'pack'); end if;
      if ph is null then perform app.fail('phone_required'); end if;
      ln_qty := 1; ln_unit := coalesce(ln_unit, pk.price_cents);
      if ln_unit < 1 or ln_unit > pk.price_cents then perform app.fail('invalid_request', 'price'); end if;
    elsif ln_kind = 'pack_payment' then
      select * into cp from public.agenda_client_packs where id = app.try_uuid(l ->> 'client_pack_id') and restaurant_id = r.id for update;
      if cp.id is null or cp.cancelled_at is not null then perform app.fail('pack_unknown'); end if;
      pays := jsonb_set(pays, array[cp.id::text], to_jsonb(coalesce((pays ->> cp.id::text)::bigint, 0) + coalesce(ln_unit, 0)));
      ln_qty := 1;
      if coalesce(ln_unit, 0) < 1 or cp.paid_cents + (pays ->> cp.id::text)::bigint > cp.price_cents then perform app.fail('invalid_request', 'price'); end if;
    elsif ln_kind = 'giftcard' then
      ln_qty := 1;
      if ln_unit is null or ln_unit not between 1000 and 10000000 then perform app.fail('invalid_request', 'price'); end if;
    end if;
    if ln_unit is null or ln_unit not between 0 and 10000000 or ln_qty not between 1 and 99 then perform app.fail('invalid_request', 'price'); end if;
    units := units || jsonb_build_array(jsonb_build_object('unit', ln_unit, 'qty', ln_qty, 'kind', ln_kind));
    sub := sub + ln_unit * ln_qty;
  end loop;

  disc := coalesce((p ->> 'discount_cents')::bigint, 0);
  if disc < 0 or disc > sub then perform app.fail('invalid_request', 'discount'); end if;
  reason := nullif(btrim(p ->> 'discount_reason'), '');
  -- a code from the client's story (Le miroir): checked and applied here, used once
  if nullif(btrim(p ->> 'voucher_code'), '') is not null then
    select * into vo from public.agenda_vouchers where restaurant_id = r.id and code = upper(btrim(p ->> 'voucher_code')) for update;
    if vo.id is null then perform app.fail('voucher_unknown'); end if;
    if vo.used_sale_id is not null then perform app.fail('voucher_used'); end if;
    if d < vo.starts_on or d > vo.ends_on or not (extract(isodow from d)::int = any (vo.days)) then perform app.fail('voucher_not_today'); end if;
    if sub < vo.min_cents then perform app.fail('voucher_min'); end if;
    vdisc := case when vo.kind = 'percent' then round(sub::numeric * vo.value / 10000)::bigint when vo.kind = 'amount' then least(vo.value, sub) else 0 end;
    disc := least(sub, disc + vdisc);
    reason := concat_ws(' · ', reason, 'Code ' || vo.code || case when vo.kind = 'gift' then ' : ' || vo.name else '' end);
  end if;
  -- the loyalty reward: only when the client has her stamps
  if loyal then
    lc := app.agenda_loyalty_cfg(r);
    if not (lc ->> 'enabled')::boolean or ph is null or app.agenda_stamps(r, ph) < (lc ->> 'every')::int then perform app.fail('loyalty_not_ready'); end if;
    lred := case when lc ->> 'type' = 'percent' then round(sub::numeric * least((lc ->> 'value')::numeric, 100) / 100)::bigint
                 else least(round((lc ->> 'value')::numeric * 100)::bigint, sub) end;
    disc := least(sub, disc + lred);
    reason := concat_ws(' · ', reason, 'Fidélité : ' || (lc ->> 'name'));
  end if;
  tot := sub - disc;
  -- a gift card pays part of it
  if nullif(btrim(p ->> 'giftcard_code'), '') is not null then
    select * into gc from public.agenda_giftcards where restaurant_id = r.id and code = upper(btrim(p ->> 'giftcard_code')) for update;
    if gc.id is null or gc.cancelled_at is not null then perform app.fail('giftcard_unknown'); end if;
    if gc.expires_on < d then perform app.fail('giftcard_expired'); end if;
    gcp := coalesce((p ->> 'giftcard_cents')::bigint, 0);
    if gcp < 1 or gcp > gc.balance_cents then perform app.fail('giftcard_balance'); end if;
    prepaid := prepaid + gcp;
  end if;
  if tot = 0 and coalesce(btrim(p ->> 'free_reason'), '') = '' and vo.id is null and not loyal then perform app.fail('free_reason_required'); end if;
  tip := coalesce((p ->> 'tip_cents')::bigint, 0); cash := coalesce((p ->> 'cash_cents')::bigint, 0); card := coalesce((p ->> 'card_cents')::bigint, 0);
  other := coalesce((p ->> 'other_cents')::bigint, 0); omethod := case when other > 0 then coalesce(nullif(p ->> 'other_method', ''), 'other') end;
  if omethod is not null and omethod not in ('transfer', 'cashplus', 'link', 'other') then perform app.fail('invalid_request', 'other_method'); end if;
  if tip < 0 or cash < 0 or card < 0 or other < 0 or prepaid > tot + tip or cash + card + other + prepaid <> tot + tip then perform app.fail('payment_mismatch'); end if;

  -- the visit counts (the appointment or the Nouba entry is done)
  if a.id is not null then
    if a.status <> 'done' then update public.agenda_appointments set status = 'done' where id = a.id; end if;
    if a.phone is not null and a.phone = ph then counted_price := a.price_cents; end if;
  elsif q.id is not null and q.status <> 'done' then
    update public.agenda_queue set status = 'done', ended_at = coalesce(ended_at, now()), started_at = coalesce(started_at, now()) where id = q.id;
  end if;

  -- the client: the list knows what she really paid
  if ph is not null then
    insert into public.customers (restaurant_id, phone, name) values (r.id, ph, left(coalesce(nm, ph), 60))
    on conflict (restaurant_id, phone) do update set name = coalesce(public.customers.name, excluded.name)
    returning id into cust;
    if a.id is not null and a.phone is not null and a.phone = ph then
      update public.customers set spent_cents = greatest(0, spent_cents + tot - counted_price) where id = cust;
    else
      update public.customers set spent_cents = spent_cents + tot, visits = visits + 1,
             first_visit_at = coalesce(first_visit_at, now()), last_visit_at = now() where id = cust;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('agenda_sales' || r.id::text || d::text));
  select coalesce(max(number), 0) + 1 into num from public.agenda_sales where restaurant_id = r.id and business_date = d;
  insert into public.agenda_sales (restaurant_id, business_date, number, appointment_id, queue_id, customer_id, name, phone, staff_id,
                                   subtotal_cents, discount_cents, discount_reason, total_cents, cash_cents, card_cents, other_cents, other_method, tip_cents, prepaid_cents, loyalty_used, free_reason, created_by)
  values (r.id, d, num, a.id, q.id, cust, nm, ph, who, sub, disc, left(reason, 100), tot, cash, card, other, omethod, tip, prepaid, loyal,
          case when tot = 0 then left(coalesce(nullif(btrim(p ->> 'free_reason'), ''), case when loyal then 'Fidélité' else 'Code ' || vo.code end), 100) end, auth.uid())
  returning id into sid;
  if vo.id is not null then update public.agenda_vouchers set used_sale_id = sid, used_at = now(), used_cents = vdisc where id = vo.id; end if;
  if gc.id is not null then
    update public.agenda_giftcards set balance_cents = balance_cents - gcp where id = gc.id;
    insert into public.agenda_prepaid_moves (restaurant_id, sale_id, kind, giftcard_id, amount_cents) values (r.id, sid, 'giftcard_use', gc.id, gcp);
  end if;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := (units -> i ->> 'kind'); ln_unit := (units -> i ->> 'unit')::bigint; ln_qty := (units -> i ->> 'qty')::int;
    v := null; pr := null; cp := null; pk := null; new_cp := null; new_gc := null;
    if nullif(l ->> 'service_id', '') is not null then select * into v from public.agenda_services where id = (l ->> 'service_id')::uuid; end if;
    if ln_kind = 'product' and nullif(l ->> 'product_id', '') is not null then select * into pr from public.agenda_products where id = (l ->> 'product_id')::uuid; end if;
    ln_staff := case when ln_kind in ('pack', 'pack_payment', 'giftcard') then null
                     else coalesce(nullif(l ->> 'staff_id', '')::uuid, case when ln_kind = 'service' then who end) end;
    if ln_kind = 'service' and nullif(l ->> 'use_pack', '') is not null then
      select * into cp from public.agenda_client_packs where id = (l ->> 'use_pack')::uuid;
      if v.id is null and cp.service_id is not null then select * into v from public.agenda_services where id = cp.service_id; end if;
      update public.agenda_client_packs set sessions_left = sessions_left - 1 where id = cp.id;
      insert into public.agenda_prepaid_moves (restaurant_id, sale_id, kind, client_pack_id, sessions, amount_cents) values (r.id, sid, 'pack_use', cp.id, 1, ln_unit);
      ln_name := coalesce(v.name ->> 'fr', v.name ->> 'ar', cp.name) || ' (' || cp.name || ')';
    elsif ln_kind = 'pack' then
      select * into pk from public.agenda_packs where id = (l ->> 'pack_id')::uuid;
      insert into public.agenda_client_packs (restaurant_id, pack_id, customer_id, phone, client_name, name, service_id, sessions_total, sessions_left, price_cents, paid_cents, expires_on, sale_id)
      values (r.id, pk.id, cust, ph, nm, pk.name, pk.service_id, pk.sessions, pk.sessions, pk.price_cents, ln_unit, d + pk.valid_days, sid)
      returning id into new_cp;
      ln_name := pk.name || case when ln_unit < pk.price_cents then ' (1er versement)' else '' end;
      made := made || jsonb_build_array(jsonb_build_object('kind', 'pack', 'id', new_cp, 'name', pk.name, 'sessions', pk.sessions, 'due_cents', pk.price_cents - ln_unit));
    elsif ln_kind = 'pack_payment' then
      select * into cp from public.agenda_client_packs where id = (l ->> 'client_pack_id')::uuid;
      update public.agenda_client_packs set paid_cents = paid_cents + ln_unit where id = cp.id;
      insert into public.agenda_prepaid_moves (restaurant_id, sale_id, kind, client_pack_id, amount_cents) values (r.id, sid, 'pack_payment', cp.id, ln_unit);
      ln_name := 'Versement : ' || cp.name;
    elsif ln_kind = 'giftcard' then
      tries := 0;
      loop
        tries := tries + 1;
        gcode := 'KDO-' || (select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
        begin
          insert into public.agenda_giftcards (restaurant_id, code, initial_cents, balance_cents, for_name, expires_on, sale_id)
          values (r.id, gcode, ln_unit, ln_unit, nullif(left(btrim(l ->> 'name'), 60), ''), d + 365, sid) returning id into new_gc;
          exit;
        exception when unique_violation then
          if tries >= 8 then perform app.fail('invalid_request', 'giftcard'); end if;
        end;
      end loop;
      ln_name := 'Carte cadeau ' || gcode || coalesce(' pour ' || nullif(btrim(l ->> 'name'), ''), '');
      made := made || jsonb_build_array(jsonb_build_object('kind', 'giftcard', 'id', new_gc, 'code', gcode, 'amount_cents', ln_unit, 'expires_on', d + 365));
    else
      ln_name := coalesce(nullif(btrim(l ->> 'name'), ''), pr.name, v.name ->> 'fr', v.name ->> 'ar', v.name ->> 'en', 'Prestation');
    end if;
    insert into public.agenda_sale_lines (restaurant_id, sale_id, kind, service_id, product_id, client_pack_id, giftcard_id, name, quantity, unit_cents, staff_id, sort)
    values (r.id, sid, ln_kind, v.id, pr.id, coalesce(cp.id, new_cp), new_gc, left(ln_name, 80), ln_qty, ln_unit, ln_staff, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', sid, 'number', num, 'business_date', d, 'total_cents', tot, 'tip_cents', tip, 'voucher_cents', vdisc, 'loyalty_cents', lred,
                            'prepaid_cents', prepaid, 'share_token', (select share_token from public.agenda_sales where id = sid), 'made', made,
                            'stamps', case when ph is not null and (app.agenda_loyalty_cfg(r) ->> 'enabled')::boolean then app.agenda_stamps(r, ph) end,
                            'every', case when (app.agenda_loyalty_cfg(r) ->> 'enabled')::boolean then (app.agenda_loyalty_cfg(r) ->> 'every')::int end,
                            'cash_cents', cash, 'card_cents', card, 'other_cents', other, 'name', nm, 'phone', ph);
end $$;
revoke all on function public.agenda_checkout(uuid, jsonb) from public, anon;
grant execute on function public.agenda_checkout(uuid, jsonb) to authenticated;

-- the day of the till: the other payments and what packs, gift cards and deposits paid
create or replace function public.agenda_day_till(p_restaurant_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; d date; c public.agenda_closings; boss boolean; sees_cash boolean;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  d := coalesce(p_date, app.business_date(r));
  boss := p_restaurant_id = any (app.my_restaurants('manager'));
  select * into c from public.agenda_closings where restaurant_id = r.id and business_date = d;
  sees_cash := boss or c.id is not null;
  return jsonb_build_object(
    'date', d, 'today', app.business_date(r), 'manager', boss,
    'closed', case when c.id is null then null else jsonb_build_object('at', c.closed_at, 'counted_cash_cents', c.counted_cash_cents,
               'expected_cash_cents', c.expected_cash_cents, 'cash_diff_cents', c.cash_diff_cents, 'unpaid', c.unpaid, 'note', c.note,
               'staff_id', c.closed_by_staff) end,
    'sales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number, 'at', s.created_at, 'name', s.name, 'phone', s.phone,
               'staff_id', s.staff_id, 'cashier_id', s.cashier_id, 'total_cents', s.total_cents, 'tip_cents', s.tip_cents, 'discount_cents', s.discount_cents,
               'discount_reason', s.discount_reason, 'free_reason', s.free_reason,
               'cash_cents', case when sees_cash then s.cash_cents end, 'card_cents', s.card_cents, 'other_cents', s.other_cents, 'other_method', s.other_method, 'prepaid_cents', s.prepaid_cents,
               'appointment_id', s.appointment_id, 'queue_id', s.queue_id,
               'cancelled', s.cancelled_at is not null, 'cancel_reason', s.cancel_reason,
               'lines', (select jsonb_agg(jsonb_build_object('kind', l.kind, 'name', l.name, 'quantity', l.quantity, 'unit_cents', l.unit_cents,
                          'line_cents', l.line_cents, 'staff_id', l.staff_id) order by l.sort) from public.agenda_sale_lines l where l.sale_id = s.id))
               order by s.number desc)
       from public.agenda_sales s where s.restaurant_id = r.id and s.business_date = d), '[]'::jsonb),
    'totals', (select jsonb_build_object('tickets', count(*) filter (where cancelled_at is null),
               'total_cents', coalesce(sum(total_cents) filter (where cancelled_at is null), 0),
               'card_cents', coalesce(sum(card_cents) filter (where cancelled_at is null), 0),
               'other_cents', coalesce(sum(other_cents) filter (where cancelled_at is null), 0),
               'prepaid_cents', coalesce(sum(prepaid_cents) filter (where cancelled_at is null), 0),
               'cash_cents', case when sees_cash then coalesce(sum(cash_cents) filter (where cancelled_at is null), 0) end,
               'tip_cents', coalesce(sum(tip_cents) filter (where cancelled_at is null), 0),
               'discount_cents', coalesce(sum(discount_cents) filter (where cancelled_at is null), 0),
               'free', count(*) filter (where cancelled_at is null and free_reason is not null),
               'cancelled', count(*) filter (where cancelled_at is not null),
               'cancelled_cents', coalesce(sum(total_cents) filter (where cancelled_at is not null), 0))
       from public.agenda_sales where restaurant_id = r.id and business_date = d),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'total_cents', x.total, 'clients', x.clients, 'tip_cents', x.tips) order by x.total desc)
       from (select l.staff_id, sum(l.line_cents - case when s.subtotal_cents > 0 then round(l.line_cents::numeric * s.discount_cents / s.subtotal_cents) else 0 end)::bigint total,
                    count(distinct s.id) clients,
                    coalesce((select sum(t.tip_cents) from public.agenda_sales t where t.restaurant_id = r.id and t.business_date = d and t.cancelled_at is null and t.staff_id = l.staff_id), 0) tips
               from public.agenda_sale_lines l join public.agenda_sales s on s.id = l.sale_id
              where s.restaurant_id = r.id and s.business_date = d and s.cancelled_at is null and l.staff_id is not null
              group by l.staff_id) x), '[]'::jsonb),
    'unpaid', case when c.id is null then app.agenda_unpaid(r, d) else '[]'::jsonb end);
end $$;

notify pgrst, 'reload schema';
