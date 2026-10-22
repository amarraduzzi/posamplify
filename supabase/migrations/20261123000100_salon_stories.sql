-- =============================================================================
-- AMPLIFY AGENDA (15): the salon's clients on Instagram
--
-- * "Le miroir": after paying, the ticket (WhatsApp) carries a link to a ready frame for the selfie in
--   the salon's mirror: the salon, the prestation, "fait par", the date, the @. The photo stays on the
--   client's phone. For sharing, what the owner chose (the same actions as the restaurants): a gift at
--   the till, or a personal code for the next visit (agenda_vouchers), typed at the till.
-- * The booking and the Nouba pages share a story too ("J'ai rendez-vous", "Je suis n°3"): they now
--   carry the salon's @ (handle).
-- =============================================================================

alter table public.agenda_sales add column if not exists share_token text;
update public.agenda_sales set share_token = app.random_token(16) where share_token is null;
alter table public.agenda_sales alter column share_token set default app.random_token(16);
alter table public.agenda_sales alter column share_token set not null;
create unique index if not exists agenda_sales_share_idx on public.agenda_sales (share_token);

create table if not exists public.agenda_vouchers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  code           text not null unique check (code ~ '^[A-Z0-9-]{4,20}$'),
  sale_id        uuid not null unique,
  action_id      text not null,
  name           text not null check (length(name) between 1 and 60),
  kind           text not null check (kind in ('percent', 'amount', 'gift')),
  value          bigint not null default 0 check (value >= 0),           -- percent: basis points; amount: cents
  min_cents      bigint not null default 0 check (min_cents >= 0),
  starts_on      date not null,
  ends_on        date not null,
  days           integer[] not null default '{1,2,3,4,5,6,7}',
  used_sale_id   uuid,
  used_at        timestamptz,
  used_cents     bigint,
  created_at     timestamptz not null default now(),
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, used_sale_id) references public.agenda_sales (restaurant_id, id) on delete set null (used_sale_id)
);
create index if not exists agenda_vouchers_idx on public.agenda_vouchers (restaurant_id, action_id, created_at);
drop trigger if exists agenda_vouchers_same_tenant on public.agenda_vouchers;
create trigger agenda_vouchers_same_tenant before update on public.agenda_vouchers for each row execute function app.forbid_restaurant_change();
alter table public.agenda_vouchers enable row level security;
revoke all on public.agenda_vouchers from anon, authenticated;
grant select on public.agenda_vouchers to authenticated;
drop policy if exists agenda_vouchers_select on public.agenda_vouchers;
create policy agenda_vouchers_select on public.agenda_vouchers for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- a cancelled ticket gives its code back
create or replace function app.agenda_sale_cancel_voucher()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    update public.agenda_vouchers set used_sale_id = null, used_at = null, used_cents = null where used_sale_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists agenda_sales_cancel_voucher on public.agenda_sales;
create trigger agenda_sales_cancel_voucher after update of cancelled_at on public.agenda_sales for each row execute function app.agenda_sale_cancel_voucher();

-- the salon's Instagram name: the one in the settings, or taken from the link on its website
create or replace function app.salon_handle(r public.restaurants)
returns text language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(coalesce(nullif(btrim(r.branding ->> 'instagram'), ''),
                                        substring(r.site ->> 'instagram' from 'instagram\.com/([A-Za-z0-9._]+)'), ''), '^@', ''), '')
$$;

-- Public: the mirror frame of a ticket (a week after paying)
create or replace function public.salon_mirror(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.agenda_sales; r public.restaurants;
begin
  select * into s from public.agenda_sales where share_token = p_token and cancelled_at is null and created_at > now() - interval '7 days';
  if s.id is null then return null; end if;
  select * into r from public.restaurants where id = s.restaurant_id and status <> 'cancelled';
  if r.id is null then return null; end if;
  return jsonb_build_object(
    'salon', jsonb_build_object('name', r.name, 'slug', r.slug, 'languages', r.languages, 'timezone', r.timezone, 'currency', r.currency,
                                'branding', r.branding - 'guest_actions', 'handle', app.salon_handle(r)),
    'share', coalesce((r.branding ->> 'guest_share')::boolean, true),
    'actions', coalesce((select jsonb_agg(a) from jsonb_array_elements(case when jsonb_typeof(r.branding -> 'guest_actions') = 'array' then r.branding -> 'guest_actions' else '[]'::jsonb end) a
                          where coalesce((a ->> 'on')::boolean, true)), '[]'::jsonb),
    'at', s.created_at, 'number', s.number,
    'services', coalesce((select jsonb_agg(l.name order by l.sort) from public.agenda_sale_lines l where l.sale_id = s.id and l.kind = 'service'), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(distinct st.name) from public.agenda_sale_lines l join public.staff st on st.id = l.staff_id
                        where l.sale_id = s.id and l.kind = 'service'), '[]'::jsonb),
    'voucher', (select jsonb_build_object('code', v.code, 'name', v.name, 'kind', v.kind, 'value', v.value, 'min_cents', v.min_cents,
                                          'starts_on', v.starts_on, 'ends_on', v.ends_on, 'days', v.days, 'used', v.used_sale_id is not null)
                  from public.agenda_vouchers v where v.sale_id = s.id));
end $$;
revoke all on function public.salon_mirror(text) from public;
grant execute on function public.salon_mirror(text) to anon, authenticated;

-- Public: the code for the next visit, after sharing (one per ticket; asking again gives the same code)
create or replace function public.salon_voucher(p_token text, p_action_id text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s public.agenda_sales; r public.restaurants; a jsonb; v public.agenda_vouchers; num numeric; cap int; issued int; valid int;
        start_d date; v_days int[]; v_code text; tries int := 0;
        alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select * into s from public.agenda_sales where share_token = p_token and cancelled_at is null and created_at > now() - interval '7 days';
  if s.id is null then return jsonb_build_object('status', 'none'); end if;
  select * into v from public.agenda_vouchers where sale_id = s.id;
  if v.id is not null then return jsonb_build_object('status', 'ok', 'code', v.code); end if;
  select * into r from public.restaurants where id = s.restaurant_id and status <> 'cancelled';
  if r.id is null or coalesce((r.branding ->> 'guest_share')::boolean, true) = false then return jsonb_build_object('status', 'none'); end if;
  select t.x into a from jsonb_array_elements(case when jsonb_typeof(r.branding -> 'guest_actions') = 'array' then r.branding -> 'guest_actions' else '[]'::jsonb end) t(x)
   where t.x ->> 'id' = p_action_id and coalesce((t.x ->> 'on')::boolean, true) and t.x ->> 'when' = 'next' limit 1;
  if a is null then return jsonb_build_object('status', 'none'); end if;
  num := coalesce(nullif(a ->> 'value', '')::numeric, 0);
  if a ->> 'type' in ('percent', 'amount') and num <= 0 then return jsonb_build_object('status', 'none'); end if;
  cap := nullif(a ->> 'max_per_week', '')::int;
  if cap is not null then
    select count(*) into issued from public.agenda_vouchers where restaurant_id = r.id and action_id = p_action_id and created_at > now() - interval '7 days';
    if issued >= cap then return jsonb_build_object('status', 'full'); end if;
  end if;
  valid := greatest(1, least(365, coalesce(nullif(a ->> 'valid_days', '')::int, 30)));
  start_d := (now() at time zone r.timezone)::date + case when coalesce(a ->> 'delay', 'next_day') = 'now' then 0 else 1 end;
  select array_agg(x::int order by x::int) into v_days from jsonb_array_elements_text(case when jsonb_typeof(a -> 'days') = 'array' then a -> 'days' else '[]'::jsonb end) x where x ~ '^[1-7]$';
  if v_days is null or cardinality(v_days) = 0 then v_days := '{1,2,3,4,5,6,7}'; end if;
  loop
    tries := tries + 1;
    v_code := upper(left(regexp_replace(r.slug, '[^a-zA-Z0-9]', '', 'g'), 2)) || '-' || (select string_agg(substr(alphabet, 1 + floor(random() * 32)::int, 1), '') from generate_series(1, 6));
    begin
      insert into public.agenda_vouchers (restaurant_id, code, sale_id, action_id, name, kind, value, min_cents, starts_on, ends_on, days)
      values (r.id, v_code, s.id, p_action_id, left(coalesce(nullif(btrim(a ->> 'name'), ''), 'Story'), 60),
              case when a ->> 'type' in ('percent', 'amount') then a ->> 'type' else 'gift' end,
              case when a ->> 'type' = 'percent' then round(least(num, 100) * 100)::bigint when a ->> 'type' = 'amount' then round(num * 100)::bigint else 0 end,
              coalesce(round(nullif(a ->> 'min', '')::numeric * 100), 0)::bigint, start_d, start_d + (valid - 1), v_days)
      returning * into v;
      exit;
    exception when unique_violation then
      select * into v from public.agenda_vouchers where sale_id = s.id;
      if v.id is not null then exit; end if;
      if tries >= 8 then return jsonb_build_object('status', 'none'); end if;
    end;
  end loop;
  return jsonb_build_object('status', 'ok', 'code', v.code);
end $$;
revoke all on function public.salon_voucher(text, text) from public;
grant execute on function public.salon_voucher(text, text) to anon, authenticated;

-- the till checks a code before paying (what it gives, if it works today)
create or replace function public.agenda_voucher_check(p_restaurant_id uuid, p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; v public.agenda_vouchers; d date;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  d := app.business_date(r);
  select * into v from public.agenda_vouchers where restaurant_id = r.id and code = upper(btrim(p_code));
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'voucher_unknown'); end if;
  if v.used_sale_id is not null then return jsonb_build_object('ok', false, 'error', 'voucher_used'); end if;
  if d < v.starts_on or d > v.ends_on or not (extract(isodow from d)::int = any (v.days)) then
    return jsonb_build_object('ok', false, 'error', 'voucher_not_today', 'starts_on', v.starts_on, 'ends_on', v.ends_on);
  end if;
  return jsonb_build_object('ok', true, 'code', v.code, 'name', v.name, 'kind', v.kind, 'value', v.value, 'min_cents', v.min_cents);
end $$;
revoke all on function public.agenda_voucher_check(uuid, text) from public, anon;
grant execute on function public.agenda_voucher_check(uuid, text) to authenticated;

-- how the stories did: codes given, used, the discount and what those visits brought
create or replace function public.agenda_voucher_stats(p_restaurant_id uuid, p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(365, p_days)));
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  return jsonb_build_object(
    'issued', (select count(*) from public.agenda_vouchers where restaurant_id = p_restaurant_id and created_at >= since),
    'used', (select count(*) from public.agenda_vouchers where restaurant_id = p_restaurant_id and used_at >= since),
    'given_cents', (select coalesce(sum(used_cents), 0) from public.agenda_vouchers where restaurant_id = p_restaurant_id and used_at >= since),
    'revenue_cents', (select coalesce(sum(s.total_cents), 0) from public.agenda_vouchers v join public.agenda_sales s on s.id = v.used_sale_id
                       where v.restaurant_id = p_restaurant_id and v.used_at >= since));
end $$;
revoke all on function public.agenda_voucher_stats(uuid, integer) from public, anon;
grant execute on function public.agenda_voucher_stats(uuid, integer) to authenticated;

-- the booking and Nouba pages: also the salon's @ for their story
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
                                'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding - 'guest_actions', 'handle', app.salon_handle(r),
                                'cancel_hours', (app.agenda_cfg(r) ->> 'cancel_hours')::int, 'note', app.agenda_cfg(r) ->> 'note'))
  from public.agenda_appointments x
  join public.restaurants r on r.id = x.restaurant_id
  left join public.staff s on s.restaurant_id = x.restaurant_id and s.id = x.staff_id
  where x.token = p_token and x.starts_at > now() - interval '7 days'
$$;

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
    'soon', x.status = 'waiting' and st is not null and st <= now() + interval '20 minutes',
    'service', (select name from public.agenda_services where id = x.service_id),
    'staff', (select name from public.staff where id = coalesce(x.served_by, x.staff_id)),
    'salon', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                'timezone', r.timezone, 'languages', r.languages, 'branding', r.branding - 'guest_actions', 'handle', app.salon_handle(r)));
end $$;

create or replace function public.agenda_checkout(p_restaurant_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants; d date; a public.agenda_appointments; q public.agenda_queue; l jsonb; v public.agenda_services;
  sid uuid; num int; sub bigint := 0; disc bigint; tot bigint; tip bigint; cash bigint; card bigint;
  ph text; nm text; who uuid; cust uuid; i int := 0; ln_staff uuid; ln_name text; ln_qty int; ln_unit bigint; ln_kind text; pr public.agenda_products;
  counted_price bigint := 0; vo public.agenda_vouchers; vdisc bigint := 0; reason text;
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

  -- the lines: checked and priced before anything is written
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := coalesce(l ->> 'kind', 'service');
    if ln_kind not in ('service', 'product', 'other') then perform app.fail('invalid_request', 'kind'); end if;
    ln_unit := (l ->> 'unit_cents')::bigint; ln_qty := coalesce((l ->> 'quantity')::int, 1);
    if ln_unit is null or ln_unit not between 0 and 10000000 or ln_qty not between 1 and 99 then perform app.fail('invalid_request', 'price'); end if;
    if nullif(l ->> 'staff_id', '') is not null and not exists (select 1 from public.staff where id = (l ->> 'staff_id')::uuid and restaurant_id = r.id) then
      perform app.fail('invalid_request', 'staff');
    end if;
    if nullif(l ->> 'service_id', '') is not null and not exists (select 1 from public.agenda_services where id = (l ->> 'service_id')::uuid and restaurant_id = r.id) then
      perform app.fail('invalid_request', 'service');
    end if;
    -- a product of the catalogue: only one for sale, of this salon
    if nullif(l ->> 'product_id', '') is not null and not exists (select 1 from public.agenda_products where id = (l ->> 'product_id')::uuid and restaurant_id = r.id and kind = 'retail') then
      perform app.fail('invalid_request', 'product');
    end if;
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
  tot := sub - disc;
  if tot = 0 and coalesce(btrim(p ->> 'free_reason'), '') = '' and vo.id is null then perform app.fail('free_reason_required'); end if;
  tip := coalesce((p ->> 'tip_cents')::bigint, 0); cash := coalesce((p ->> 'cash_cents')::bigint, 0); card := coalesce((p ->> 'card_cents')::bigint, 0);
  if tip < 0 or cash < 0 or card < 0 or cash + card <> tot + tip then perform app.fail('payment_mismatch'); end if;

  -- the visit counts (the appointment or the Nouba entry is done)
  if a.id is not null then
    if a.status <> 'done' then update public.agenda_appointments set status = 'done' where id = a.id; end if;
    -- the appointment's own number already counted the visit and its list price
    if a.phone is not null and a.phone = ph then counted_price := a.price_cents; end if;
  elsif q.id is not null and q.status <> 'done' then
    update public.agenda_queue set status = 'done', ended_at = coalesce(ended_at, now()), started_at = coalesce(started_at, now()) where id = q.id;
  end if;

  -- the client: the list knows what she really paid
  if ph is not null and ph ~ '^\+?[0-9]{6,15}$' then
    insert into public.customers (restaurant_id, phone, name) values (r.id, ph, left(coalesce(nm, ph), 60))
    on conflict (restaurant_id, phone) do update set name = coalesce(public.customers.name, excluded.name)
    returning id into cust;
    if a.id is not null and a.phone is not null and a.phone = ph then
      update public.customers set spent_cents = greatest(0, spent_cents + tot - counted_price) where id = cust;
    else
      update public.customers set spent_cents = spent_cents + tot, visits = visits + 1,
             first_visit_at = coalesce(first_visit_at, now()), last_visit_at = now() where id = cust;
    end if;
  else ph := null;
  end if;

  perform pg_advisory_xact_lock(hashtext('agenda_sales' || r.id::text || d::text));
  select coalesce(max(number), 0) + 1 into num from public.agenda_sales where restaurant_id = r.id and business_date = d;
  insert into public.agenda_sales (restaurant_id, business_date, number, appointment_id, queue_id, customer_id, name, phone, staff_id,
                                   subtotal_cents, discount_cents, discount_reason, total_cents, cash_cents, card_cents, tip_cents, free_reason, created_by)
  values (r.id, d, num, a.id, q.id, cust, nm, ph, who, sub, disc, left(reason, 100), tot, cash, card, tip,
          case when tot = 0 then left(coalesce(nullif(btrim(p ->> 'free_reason'), ''), 'Code ' || vo.code), 100) end, auth.uid())
  returning id into sid;
  if vo.id is not null then update public.agenda_vouchers set used_sale_id = sid, used_at = now(), used_cents = vdisc where id = vo.id; end if;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := coalesce(l ->> 'kind', 'service'); v := null; pr := null;
    if nullif(l ->> 'service_id', '') is not null then select * into v from public.agenda_services where id = (l ->> 'service_id')::uuid; end if;
    if nullif(l ->> 'product_id', '') is not null then select * into pr from public.agenda_products where id = (l ->> 'product_id')::uuid; ln_kind := 'product'; end if;
    ln_name := coalesce(nullif(btrim(l ->> 'name'), ''), pr.name, v.name ->> 'fr', v.name ->> 'ar', v.name ->> 'en', 'Prestation');
    ln_staff := coalesce(nullif(l ->> 'staff_id', '')::uuid, case when ln_kind = 'service' then who end);
    insert into public.agenda_sale_lines (restaurant_id, sale_id, kind, service_id, product_id, name, quantity, unit_cents, staff_id, sort)
    values (r.id, sid, ln_kind, v.id, pr.id, left(ln_name, 80), coalesce((l ->> 'quantity')::int, 1), (l ->> 'unit_cents')::bigint, ln_staff, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', sid, 'number', num, 'business_date', d, 'total_cents', tot, 'tip_cents', tip, 'voucher_cents', vdisc, 'share_token', (select share_token from public.agenda_sales where id = sid),
                            'cash_cents', cash, 'card_cents', card, 'name', nm, 'phone', ph);
end $$;
revoke all on function public.agenda_checkout(uuid, jsonb) from public, anon;
grant execute on function public.agenda_checkout(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
