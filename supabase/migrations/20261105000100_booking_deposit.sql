-- =============================================================================
-- BOOKING GUARANTEE (ACOMPTE) AND OCCASION
--
-- A booking can ask for a deposit: by the restaurant's rule (from N guests, X DH per guest, in
-- restaurants.booking: deposit_party, deposit_cents) or set by hand at the host stand. The deposit is
-- received at the till (cash, card, bank transfer; an online payment can plug in later) and the
-- booking is then confirmed. On the evening it pays part of the bill: the payment method 'deposit'
-- (acompte) on the fiscal ticket, never twice. A deposit not used is refunded, or kept after a
-- no-show or a late cancellation, with a manager PIN. Every movement is in reservation_deposits,
-- with the business day: cash received or refunded counts in the drawer of that day.
-- The occasion (birthday, anniversary...) goes to the briefing and to the kitchen.
-- =============================================================================

alter table public.reservations
  add column if not exists occasion text check (occasion in ('birthday', 'anniversary', 'business', 'date', 'celebration', 'other')),
  -- what is asked; what came in and went out is in reservation_deposits
  add column if not exists deposit_cents bigint check (deposit_cents between 1 and 100000000),
  add column if not exists deposit_state text check (deposit_state in ('due', 'paid', 'used', 'refunded', 'kept'));

create table if not exists public.reservation_deposits (
  id             bigint generated always as identity primary key,
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  reservation_id uuid not null,
  -- in: received; used: paid part of the bill; refund: given back; kept: no-show, the restaurant keeps it
  kind           text not null check (kind in ('in', 'used', 'refund', 'kept')),
  amount_cents   bigint not null check (amount_cents > 0),
  method         text check (method in ('cash', 'card', 'transfer')),
  ref            text check (length(ref) <= 64),
  order_id       uuid,
  staff_id       uuid,
  business_date  date not null,
  created_at     timestamptz not null default now(),
  check ((kind in ('in', 'refund')) = (method is not null)),
  foreign key (restaurant_id, reservation_id) references public.reservations (restaurant_id, id) on delete cascade
);
create index if not exists reservation_deposits_res_idx on public.reservation_deposits (restaurant_id, reservation_id);
create index if not exists reservation_deposits_day_idx on public.reservation_deposits (restaurant_id, business_date);
alter table public.reservation_deposits enable row level security;
grant select on public.reservation_deposits to authenticated;
drop policy if exists reservation_deposits_select on public.reservation_deposits;
create policy reservation_deposits_select on public.reservation_deposits for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));

-- the bill paid with the deposit of a booking
alter table public.payments add column if not exists reservation_id uuid;
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('cash', 'card', 'transfer', 'other', 'account', 'deposit'));
alter table public.payments drop constraint if exists payments_deposit_reservation;
alter table public.payments add constraint payments_deposit_reservation check ((method = 'deposit') = (reservation_id is not null));

-- what is left of a booking's deposit (received, not used, refunded or kept)
create or replace function app.deposit_left(p_restaurant_id uuid, p_reservation_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when kind = 'in' then amount_cents else -amount_cents end), 0)::bigint
    from public.reservation_deposits where restaurant_id = p_restaurant_id and reservation_id = p_reservation_id
$$;

-- the restaurant's rule: from deposit_party guests, deposit_cents per guest (null: no deposit)
create or replace function app.deposit_for(r public.restaurants, p_party int)
returns bigint language sql stable set search_path = '' as $$
  select case when coalesce((r.booking ->> 'deposit_party')::int, 0) between 1 and p_party
               and coalesce((r.booking ->> 'deposit_cents')::bigint, 0) > 0
              then least(100000000, p_party * (r.booking ->> 'deposit_cents')::bigint) end
$$;

-- ------------------------------------------------------------ the booking row
create or replace function app.reservations_before()
returns trigger language plpgsql set search_path = '' as $$
declare r public.restaurants;
begin
  if tg_op = 'UPDATE' then
    new.restaurant_id := old.restaurant_id; new.token := old.token; new.kind := old.kind;
    if new.status is distinct from old.status then
      if new.status = 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now()); end if;
      if new.status = 'called' then new.called_at := now(); end if;
      if new.status = 'seated' then new.seated_at := now(); end if;
      if new.status in ('cancelled', 'no_show') then new.ended_at := now(); end if;
    end if;
    if app.is_client() then
      -- the state of the money follows the money: only the server moves it
      new.deposit_state := old.deposit_state;
      -- the amount asked can change until something is received
      if new.deposit_cents is distinct from old.deposit_cents then
        if old.deposit_state is not null and old.deposit_state <> 'due' then new.deposit_cents := old.deposit_cents;
        else new.deposit_state := case when new.deposit_cents is not null then 'due' end; end if;
      end if;
    end if;
  else
    if new.phone is not null then new.phone := app.norm_phone(new.phone); end if;
    if new.status = 'confirmed' then new.confirmed_at := now(); end if;
    -- online bookings follow the rule; at the host stand the till proposes the amount and the host decides
    if new.kind = 'booking' and new.deposit_cents is null and new.source = 'online' then
      select * into r from public.restaurants where id = new.restaurant_id;
      new.deposit_cents := app.deposit_for(r, new.party_size);
    end if;
    new.deposit_state := case when new.deposit_cents is not null then 'due' end;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------ the host stand
-- The deposit comes in (or a part of it): the booking is confirmed.
create or replace function public.pos_deposit_receive(p_reservation_id uuid, p_amount_cents bigint, p_method text,
  p_ref text default null, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.reservations; r public.restaurants;
begin
  select * into x from public.reservations where id = p_reservation_id for update;
  if x.id is null or x.kind <> 'booking' then perform app.fail('not_found'); end if;
  r := app.require_role(x.restaurant_id, 'device', true);
  if x.status in ('cancelled', 'no_show') then perform app.fail('booking_closed'); end if;
  if p_method not in ('cash', 'card', 'transfer') or p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > 100000000
     or length(coalesce(p_ref, '')) > 64 then perform app.fail('invalid_request'); end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where restaurant_id = r.id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  insert into public.reservation_deposits (restaurant_id, reservation_id, kind, amount_cents, method, ref, staff_id, business_date)
  values (r.id, x.id, 'in', p_amount_cents, p_method, nullif(btrim(coalesce(p_ref, '')), ''), p_staff_id, app.business_date(r));
  update public.reservations
     set deposit_cents = coalesce(deposit_cents, p_amount_cents), deposit_state = 'paid',
         status = case when status = 'requested' then 'confirmed' else status end
   where id = x.id returning * into x;
  return jsonb_build_object('ok', true, 'left_cents', app.deposit_left(r.id, x.id), 'status', x.status);
end $$;

-- What is left goes back to the guest, or stays with the restaurant (no-show, late cancellation). Manager PIN.
create or replace function public.pos_deposit_close(p_reservation_id uuid, p_action text, p_method text,
  p_staff_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.reservations; r public.restaurants; res text; left_c bigint;
begin
  select * into x from public.reservations where id = p_reservation_id for update;
  if x.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(x.restaurant_id, 'device', true);
  if p_action not in ('refund', 'kept') or (p_action = 'refund' and coalesce(p_method, '') not in ('cash', 'card', 'transfer')) then
    perform app.fail('invalid_request');
  end if;
  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'manager');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;
  left_c := app.deposit_left(r.id, x.id);
  if left_c <= 0 then perform app.fail('nothing_left'); end if;
  if p_action = 'kept' and x.status not in ('no_show', 'cancelled') then perform app.fail('booking_not_closed'); end if;
  insert into public.reservation_deposits (restaurant_id, reservation_id, kind, amount_cents, method, staff_id, business_date)
  values (r.id, x.id, p_action, left_c, case when p_action = 'refund' then p_method end, p_staff_id, app.business_date(r));
  update public.reservations set deposit_state = case when p_action = 'refund' then 'refunded' else 'kept' end where id = x.id;
  return jsonb_build_object('ok', true, 'amount_cents', left_c);
end $$;

-- At the bill: the deposits that can pay this order (the booking of its table or of its guest, today).
create or replace function public.pos_order_deposits(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; ph text;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', false);
  ph := coalesce((select phone from public.customers where restaurant_id = r.id and id = o.customer_id), app.norm_phone(o.customer_phone));
  return coalesce((
    select jsonb_agg(jsonb_build_object('reservation_id', x.id, 'name', x.name, 'starts_at', x.starts_at, 'left_cents', x.left_c) order by x.starts_at)
      from (select b.*, app.deposit_left(r.id, b.id) left_c from public.reservations b
             where b.restaurant_id = r.id and b.kind = 'booking' and b.deposit_state = 'paid'
               and b.starts_at between now() - interval '16 hours' and now() + interval '8 hours'
               and ((o.table_id is not null and b.table_id = o.table_id) or (ph is not null and b.phone = ph))) x
     where x.left_c > 0), '[]'::jsonb);
end $$;

-- ------------------------------------------------------------ paying with the deposit
create or replace function public.pos_pay_order(
  p_order_id uuid, p_payments jsonb, p_staff_id uuid default null, p_buyer jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  r public.restaurants;
  c public.customers;
  p jsonb;
  on_account bigint := 0;
  dep record;
  res jsonb;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_already_closed'); end if;
  -- a bill of 0 DH (a reward or an approved discount covers everything) needs no payment at all
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) > 20
     or (jsonb_array_length(p_payments) = 0 and o.total_cents <> 0) then
    perform app.fail('invalid_request', 'payments');
  end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff where restaurant_id = o.restaurant_id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  for p in select * from jsonb_array_elements(p_payments) loop
    if (p ->> 'method') not in ('cash', 'card', 'transfer', 'other', 'account', 'deposit')
       or (p ->> 'amount_cents') !~ '^[0-9]{1,12}$' or (p ->> 'amount_cents')::bigint <= 0
       or coalesce(p ->> 'tip_cents', '0') !~ '^[0-9]{1,12}$' then
      perform app.fail('invalid_request', 'payment');
    end if;
    -- what the card terminal answered: only on a card payment, never the card number itself
    if p ? 'tpe' and p -> 'tpe' <> 'null'::jsonb then
      if p ->> 'method' <> 'card' or jsonb_typeof(p -> 'tpe') <> 'object'
         or coalesce(p -> 'tpe' ->> 'status', '') not in ('approved', 'manual')
         or length(coalesce(p -> 'tpe' ->> 'ref', '')) > 64
         or coalesce(p -> 'tpe' ->> 'last4', '') !~ '^([0-9]{4})?$'
         or length(coalesce(p -> 'tpe' ->> 'brand', '')) > 20
         or length(coalesce(p -> 'tpe' ->> 'terminal', '')) > 40 then
        perform app.fail('invalid_request', 'tpe');
      end if;
    end if;
    if p ->> 'method' = 'account' then
      -- no tip on credit: a tip is money handed to the staff now
      if coalesce((p ->> 'tip_cents')::bigint, 0) <> 0 then perform app.fail('invalid_request', 'tip_on_account'); end if;
      on_account := on_account + (p ->> 'amount_cents')::bigint;
    end if;
    if p ->> 'method' = 'deposit' then
      if coalesce((p ->> 'tip_cents')::bigint, 0) <> 0 or app.try_uuid(p ->> 'reservation_id') is null then
        perform app.fail('invalid_request', 'deposit');
      end if;
    elsif p ? 'reservation_id' and p -> 'reservation_id' <> 'null'::jsonb then
      perform app.fail('invalid_request', 'deposit');
    end if;
  end loop;

  if on_account > 0 then
    if not coalesce((r.loyalty ->> 'customers')::boolean, false) or not coalesce((r.loyalty ->> 'credit')::boolean, false) then
      perform app.fail('credit_off');
    end if;
    if o.customer_id is null then perform app.fail('no_customer'); end if;
    select * into c from public.customers where restaurant_id = r.id and id = o.customer_id for update;
    if c.id is null then perform app.fail('no_customer'); end if;
    if not c.credit_allowed then perform app.fail('credit_not_allowed'); end if;
    if c.balance_cents + on_account > coalesce(c.credit_limit_cents, 0) then
      perform app.fail('credit_limit', format('balance=%s limit=%s', c.balance_cents, coalesce(c.credit_limit_cents, 0)));
    end if;
  end if;

  -- the deposits: a booking of this restaurant, paid, with enough left (locked, never used twice)
  for dep in select (x ->> 'reservation_id')::uuid rid, sum((x ->> 'amount_cents')::bigint) amt
               from jsonb_array_elements(p_payments) x where x ->> 'method' = 'deposit' group by 1 loop
    perform 1 from public.reservations where restaurant_id = r.id and id = dep.rid and kind = 'booking' for update;
    if not found then perform app.fail('not_found', 'reservation'); end if;
    if app.deposit_left(r.id, dep.rid) < dep.amt then perform app.fail('deposit_too_small'); end if;
  end loop;

  for p in select * from jsonb_array_elements(p_payments) loop
    insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents, staff_id,
                                 tpe_status, tpe_ref, card_last4, card_brand, tpe_terminal, reservation_id)
    values (o.restaurant_id, o.id, p ->> 'method', (p ->> 'amount_cents')::bigint,
            coalesce((p ->> 'tip_cents')::bigint, 0), coalesce(p_staff_id, o.staff_id),
            p -> 'tpe' ->> 'status', nullif(p -> 'tpe' ->> 'ref', ''), nullif(p -> 'tpe' ->> 'last4', ''),
            nullif(p -> 'tpe' ->> 'brand', ''), nullif(p -> 'tpe' ->> 'terminal', ''),
            case when p ->> 'method' = 'deposit' then (p ->> 'reservation_id')::uuid end);
  end loop;
  res := public.close_order(o.id, p_staff_id, p_buyer);

  for dep in select (x ->> 'reservation_id')::uuid rid, sum((x ->> 'amount_cents')::bigint) amt
               from jsonb_array_elements(p_payments) x where x ->> 'method' = 'deposit' group by 1 loop
    insert into public.reservation_deposits (restaurant_id, reservation_id, kind, amount_cents, order_id, staff_id, business_date)
    values (r.id, dep.rid, 'used', dep.amt, o.id, coalesce(p_staff_id, o.staff_id), app.business_date(r));
    update public.reservations set deposit_state = case when app.deposit_left(r.id, dep.rid) = 0 then 'used' else 'paid' end
     where restaurant_id = r.id and id = dep.rid;
  end loop;
  return res;
end $$;
revoke all on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ the day: the deposits in the drawer
create or replace function app.day_totals(p_restaurant_id uuid, p_date date)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  with docs as (
    select * from public.fiscal_documents
     where restaurant_id = p_restaurant_id and business_date = p_date
  ),
  pays as (
    select p ->> 'method' method, (p ->> 'amount')::bigint amount, (p ->> 'tip')::bigint tip
      from docs, jsonb_array_elements(docs.payments) p
  ),
  vat as (
    select (v ->> 'vat_bp')::int vat_bp, sum((v ->> 'ht')::bigint) ht,
           sum((v ->> 'vat')::bigint) vat, sum((v ->> 'ttc')::bigint) ttc
      from docs, jsonb_array_elements(docs.vat_breakdown) v group by 1
  ),
  cash as (
    select kind, sum(amount_cents) amount from public.cash_movements
     where restaurant_id = p_restaurant_id and business_date = p_date group by kind
  ),
  settled as (
    select method, -sum(amount_cents) amount from public.customer_account_ledger
     where restaurant_id = p_restaurant_id and business_date = p_date and kind = 'payment' group by method
  ),
  deps as (
    select kind, method, sum(amount_cents) amount from public.reservation_deposits
     where restaurant_id = p_restaurant_id and business_date = p_date group by kind, method
  )
  select jsonb_build_object(
    'business_date', p_date,
    'tickets', (select count(*) from docs where doc_type <> 'credit_note'),
    'credit_notes', (select count(*) from docs where doc_type = 'credit_note'),
    'credit_notes_cents', (select coalesce(sum(total_ttc_cents), 0) from docs where doc_type = 'credit_note'),
    'revenue_ttc_cents', (select coalesce(sum(total_ttc_cents), 0) from docs),
    'revenue_ht_cents', (select coalesce(sum(total_ht_cents), 0) from docs),
    'vat_cents', (select coalesce(sum(total_vat_cents), 0) from docs),
    'discounts_cents', (select coalesce(sum(discount_cents), 0) from docs),
    'vat_breakdown', (select coalesce(jsonb_agg(to_jsonb(vat) order by vat_bp), '[]') from vat),
    'payments', (select coalesce(jsonb_object_agg(method, amount), '{}')
                   from (select method, sum(amount) amount from pays group by method) s),
    'tips_cents', (select coalesce(sum(tip), 0) from pays),
    'cash_float_cents', (select coalesce(sum(amount), 0) from cash where kind = 'float'),
    'cash_payouts_cents', (select coalesce(sum(amount), 0) from cash where kind = 'payout'),
    'cash_deposits_cents', (select coalesce(sum(amount), 0) from cash where kind = 'deposit'),
    'account_sales_cents', (select coalesce(sum(amount), 0) from pays where method = 'account'),
    'account_received', (select coalesce(jsonb_object_agg(method, amount), '{}') from settled),
    'account_received_cents', (select coalesce(sum(amount), 0) from settled),
    -- booking deposits (acomptes): received today (by method), given back, kept after a no-show
    'advances_received', (select coalesce(jsonb_object_agg(method, amount), '{}') from deps where kind = 'in'),
    'advances_received_cents', (select coalesce(sum(amount), 0) from deps where kind = 'in'),
    'advances_refunded_cents', (select coalesce(sum(amount), 0) from deps where kind = 'refund'),
    'advances_kept_cents', (select coalesce(sum(amount), 0) from deps where kind = 'kept'),
    -- what should physically be in the drawer: float + cash sales + cash tips
    -- + ardoises paid back in cash + deposits received in cash - deposits given back in cash - money taken out
    'expected_cash_cents',
       (select coalesce(sum(amount), 0) from cash where kind = 'float')
     + (select coalesce(sum(amount + tip), 0) from pays where method = 'cash')
     + (select coalesce(sum(amount), 0) from settled where method = 'cash')
     + (select coalesce(sum(amount), 0) from deps where kind = 'in' and method = 'cash')
     - (select coalesce(sum(amount), 0) from deps where kind = 'refund' and method = 'cash')
     - (select coalesce(sum(amount), 0) from cash where kind in ('payout', 'deposit')),
    'open_orders', (select count(*) from public.orders
                     where restaurant_id = p_restaurant_id and business_date = p_date
                       and closed_at is null and status <> 'cancelled'
                       and (total_cents > 0 or exists (select 1 from public.order_lines l where l.restaurant_id = public.orders.restaurant_id and l.order_id = public.orders.id))),
    'cancelled_orders', (select count(*) from public.orders
                          where restaurant_id = p_restaurant_id and business_date = p_date
                            and status = 'cancelled'),
    'by_staff', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', name,
                                                              'revenue_ttc_cents', total) order by total desc), '[]')
                   from (select d.staff_id, s.name, sum(d.total_ttc_cents) total
                           from docs d left join public.staff s on s.id = d.staff_id
                          group by d.staff_id, s.name) x)
  )
$$;

-- ------------------------------------------------------------ the guest's side (booking page)
-- the rule is shown before booking; the occasion can be chosen
create or replace function public.get_booking_info(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('enabled', (c ->> 'enabled')::boolean and app.is_writable(r),
                            'waitlist', (c ->> 'waitlist')::boolean and app.is_writable(r) and app.open_at(r, now()),
                            'max_party', (c ->> 'max_party')::int, 'days_ahead', (c ->> 'days_ahead')::int,
                            'note', c ->> 'note', 'name', r.name, 'timezone', r.timezone,
                            'deposit_party', case when app.deposit_for(r, 60) is not null then (r.booking ->> 'deposit_party')::int end,
                            'deposit_cents', case when app.deposit_for(r, 60) is not null then (r.booking ->> 'deposit_cents')::bigint end)
    from public.restaurants r, lateral (select app.booking_cfg(r) c) s
   where r.slug = lower(p_slug) and r.status <> 'cancelled'
$$;

create or replace function public.book_table(p_slug text, p_booking jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; c jsonb; t timestamptz; n int; ph text; nm text; x public.reservations; cid uuid; occ text;
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
  occ := nullif(p_booking ->> 'occasion', '');
  if t is null or n is null or n < 1 then perform app.fail('invalid_request'); end if;
  if occ is not null and occ not in ('birthday', 'anniversary', 'business', 'date', 'celebration', 'other') then perform app.fail('invalid_request', 'occasion'); end if;
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
  -- a booking with a deposit waits for it: never confirmed by itself
  insert into public.reservations (restaurant_id, kind, status, source, starts_at, duration_min, party_size, name, phone, note, client_id, occasion)
  values (r.id, 'booking', case when (c ->> 'auto_confirm')::boolean and app.deposit_for(r, n) is null then 'confirmed' else 'requested' end, 'online',
          t, (c ->> 'duration_min')::int, n, nm, ph, nullif(btrim(p_booking ->> 'note'), ''), cid, occ)
  returning * into x;
  return jsonb_build_object('token', x.token, 'status', x.status, 'starts_at', x.starts_at, 'duplicate', false, 'deposit_cents', x.deposit_cents);
end $$;

create or replace function public.reservation_status(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'kind', x.kind, 'status', x.status, 'starts_at', x.starts_at, 'party_size', x.party_size, 'name', x.name,
    'created_at', x.created_at, 'called_at', x.called_at, 'quoted_min', x.quoted_min,
    'occasion', x.occasion, 'deposit_cents', x.deposit_cents, 'deposit_state', x.deposit_state,
    'ahead', case when x.kind = 'waitlist' and x.status = 'requested' then
                (select count(*) from public.reservations w where w.restaurant_id = x.restaurant_id and w.kind = 'waitlist'
                   and w.status = 'requested' and w.created_at < x.created_at and w.created_at > now() - interval '12 hours') end,
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'phone', r.phone, 'address', r.address, 'city', r.city,
                                     'timezone', r.timezone, 'note', r.booking ->> 'note'))
  from public.reservations x join public.restaurants r on r.id = x.restaurant_id
  where x.token = p_token and (x.kind = 'waitlist' and x.created_at > now() - interval '24 hours'
                               or x.kind = 'booking' and x.starts_at > now() - interval '1 day')
$$;

-- ------------------------------------------------------------ the briefing knows the occasion and the deposit
create or replace function public.pos_briefing(p_restaurant_id uuid, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; d date; t0 timestamptz; files boolean;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
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
        left join public.customers c on c.restaurant_id = r.id and c.phone = b.phone
       where b.restaurant_id = r.id and b.kind = 'booking'
         and b.status in ('requested', 'confirmed', 'seated')
         and b.starts_at >= t0 and b.starts_at < t0 + interval '1 day'
    ), '[]'::jsonb)
  );
end $$;

revoke all on function app.deposit_left(uuid, uuid) from public, anon;
grant execute on function app.deposit_left(uuid, uuid) to authenticated;
revoke all on function public.pos_deposit_receive(uuid, bigint, text, text, uuid) from public, anon;
revoke all on function public.pos_deposit_close(uuid, text, text, uuid, text) from public, anon;
revoke all on function public.pos_order_deposits(uuid) from public, anon;
grant execute on function public.pos_deposit_receive(uuid, bigint, text, text, uuid) to authenticated;
grant execute on function public.pos_deposit_close(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.pos_order_deposits(uuid) to authenticated;

notify pgrst, 'reload schema';
