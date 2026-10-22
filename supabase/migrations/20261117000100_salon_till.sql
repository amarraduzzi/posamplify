-- =============================================================================
-- AMPLIFY AGENDA (9): the salon's till ("Encaisser") and the day closing ("Clôture")
--
-- A client is paid from her appointment or from the Nouba, or as a walk-in: the prestations are
-- filled in, one line per person who did the work (the commissions come from these lines), plus
-- products or other lines. Cash and/or card, a tip, a discount, or "offert" with a reason.
--
-- The money that leaks in a salon is the client who was done but never went through the till. At
-- the closing every such client (appointment done, arrived or never marked; Nouba done) must be
-- paid or explained. Then the drawer is counted blind: the expected cash is only shown after the
-- count. A ticket is only cancelled by the owner or a manager, and stays visible as cancelled.
-- =============================================================================

create table if not exists public.agenda_sales (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  business_date    date not null,
  number           integer not null check (number >= 1),
  appointment_id   uuid,
  queue_id         uuid,
  customer_id      uuid,
  name             text check (length(name) <= 60),
  phone            text check (phone is null or phone ~ '^\+?[0-9]{6,15}$'),
  staff_id         uuid,
  subtotal_cents   bigint not null check (subtotal_cents between 0 and 100000000),
  discount_cents   bigint not null default 0 check (discount_cents >= 0),
  discount_reason  text check (length(discount_reason) <= 100),
  total_cents      bigint not null check (total_cents >= 0),
  cash_cents       bigint not null default 0 check (cash_cents >= 0),
  card_cents       bigint not null default 0 check (card_cents >= 0),
  tip_cents        bigint not null default 0 check (tip_cents between 0 and 10000000),
  free_reason      text check (length(free_reason) <= 100),
  created_by       uuid,
  created_at       timestamptz not null default now(),
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  cancel_reason    text check (length(cancel_reason) <= 200),
  unique (restaurant_id, id),
  unique (restaurant_id, business_date, number),
  check (discount_cents <= subtotal_cents and total_cents = subtotal_cents - discount_cents),
  check (cash_cents + card_cents = total_cents + tip_cents),
  foreign key (restaurant_id, appointment_id) references public.agenda_appointments (restaurant_id, id) on delete set null (appointment_id),
  foreign key (restaurant_id, queue_id) references public.agenda_queue (restaurant_id, id) on delete set null (queue_id),
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete set null (customer_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index if not exists agenda_sales_day_idx on public.agenda_sales (restaurant_id, business_date);
create unique index if not exists agenda_sales_appt_idx on public.agenda_sales (appointment_id) where cancelled_at is null and appointment_id is not null;
create unique index if not exists agenda_sales_queue_idx on public.agenda_sales (queue_id) where cancelled_at is null and queue_id is not null;

create table if not exists public.agenda_sale_lines (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  sale_id          uuid not null,
  kind             text not null check (kind in ('service', 'product', 'other')),
  service_id       uuid,
  name             text not null check (length(btrim(name)) between 1 and 80),
  quantity         integer not null default 1 check (quantity between 1 and 99),
  unit_cents       bigint not null check (unit_cents between 0 and 10000000),
  line_cents       bigint generated always as (unit_cents * quantity) stored,
  staff_id         uuid,
  sort             smallint not null default 0,
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, service_id) references public.agenda_services (restaurant_id, id) on delete set null (service_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index if not exists agenda_sale_lines_sale_idx on public.agenda_sale_lines (restaurant_id, sale_id);
create index if not exists agenda_sale_lines_staff_idx on public.agenda_sale_lines (restaurant_id, staff_id);

create table if not exists public.agenda_closings (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants (id) on delete cascade,
  business_date       date not null,
  counted_cash_cents  bigint not null check (counted_cash_cents between 0 and 10000000000),
  expected_cash_cents bigint not null,
  cash_diff_cents     bigint not null,
  totals              jsonb not null default '{}'::jsonb,
  unpaid              jsonb not null default '[]'::jsonb,
  note                text check (length(note) <= 300),
  closed_by           uuid,
  closed_at           timestamptz not null default now(),
  unique (restaurant_id, business_date)
);

do $$ declare t text; begin
  foreach t in array array['agenda_sales', 'agenda_sale_lines', 'agenda_closings'] loop
    execute format('drop trigger if exists %1$s_same_tenant on public.%1$s', t);
    execute format('create trigger %1$s_same_tenant before update on public.%1$s for each row execute function app.forbid_restaurant_change()', t);
    execute format('alter table public.%s enable row level security', t);
    execute format('revoke all on public.%s from anon, authenticated', t);
    execute format('grant select on public.%s to authenticated', t);
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (restaurant_id = any ((select app.my_restaurants(''manager''))::uuid[]))', t);
  end loop;
end $$;
-- the tickets are written by the functions below only; a change to a ticket is kept in the audit
drop trigger if exists audit_agenda_sales on public.agenda_sales;
create trigger audit_agenda_sales after update on public.agenda_sales for each row execute function app.audit();

-- the clients the salon has seen that day and that never went through the till
create or replace function app.agenda_unpaid(r public.restaurants, d date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'at'), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'appointment', 'id', a.id, 'name', a.name, 'phone', a.phone, 'at', a.starts_at, 'status', a.status,
             'staff_id', a.staff_id, 'service_id', a.service_id, 'service', a.service_name, 'price_cents', a.price_cents) x
      from public.agenda_appointments a
     where a.restaurant_id = r.id and app.business_date(r, a.starts_at) = d
       and (a.status in ('arrived', 'done') or (a.status in ('requested', 'confirmed') and a.starts_at < now()))
       and not exists (select 1 from public.agenda_sales s where s.appointment_id = a.id and s.cancelled_at is null)
    union all
    select jsonb_build_object('kind', 'queue', 'id', q.id, 'name', q.name, 'phone', q.phone, 'at', coalesce(q.started_at, q.created_at),
             'status', q.status, 'staff_id', coalesce(q.served_by, q.staff_id), 'service_id', q.service_id,
             'service', (select v.name from public.agenda_services v where v.id = q.service_id),
             'price_cents', (select v.price_cents from public.agenda_services v where v.id = q.service_id))
      from public.agenda_queue q
     where q.restaurant_id = r.id and app.business_date(r, coalesce(q.started_at, q.created_at)) = d
       and q.status in ('serving', 'done')
       and not exists (select 1 from public.agenda_sales s where s.queue_id = q.id and s.cancelled_at is null)) t
$$;
revoke all on function app.agenda_unpaid(public.restaurants, date) from public, anon, authenticated;

-- Encaisser. p: { appointment_id?, queue_id?, name?, phone?, staff_id?, lines: [{kind, service_id?, name?, quantity?, unit_cents, staff_id?}],
--               discount_cents?, discount_reason?, free_reason?, cash_cents, card_cents, tip_cents? }
create or replace function public.agenda_checkout(p_restaurant_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants; d date; a public.agenda_appointments; q public.agenda_queue; l jsonb; v public.agenda_services;
  sid uuid; num int; sub bigint := 0; disc bigint; tot bigint; tip bigint; cash bigint; card bigint;
  ph text; nm text; who uuid; cust uuid; i int := 0; ln_staff uuid; ln_name text; ln_qty int; ln_unit bigint; ln_kind text;
  counted_price bigint := 0;
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
    sub := sub + ln_unit * ln_qty;
  end loop;
  disc := coalesce((p ->> 'discount_cents')::bigint, 0);
  if disc < 0 or disc > sub then perform app.fail('invalid_request', 'discount'); end if;
  tot := sub - disc;
  if tot = 0 and coalesce(btrim(p ->> 'free_reason'), '') = '' then perform app.fail('free_reason_required'); end if;
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
  values (r.id, d, num, a.id, q.id, cust, nm, ph, who, sub, disc, nullif(btrim(p ->> 'discount_reason'), ''), tot, cash, card, tip,
          case when tot = 0 then left(btrim(p ->> 'free_reason'), 100) end, auth.uid())
  returning id into sid;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    ln_kind := coalesce(l ->> 'kind', 'service'); v := null;
    if nullif(l ->> 'service_id', '') is not null then select * into v from public.agenda_services where id = (l ->> 'service_id')::uuid; end if;
    ln_name := coalesce(nullif(btrim(l ->> 'name'), ''), v.name ->> 'fr', v.name ->> 'ar', v.name ->> 'en', 'Prestation');
    ln_staff := coalesce(nullif(l ->> 'staff_id', '')::uuid, case when ln_kind = 'service' then who end);
    insert into public.agenda_sale_lines (restaurant_id, sale_id, kind, service_id, name, quantity, unit_cents, staff_id, sort)
    values (r.id, sid, ln_kind, v.id, left(ln_name, 80), coalesce((l ->> 'quantity')::int, 1), (l ->> 'unit_cents')::bigint, ln_staff, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', sid, 'number', num, 'business_date', d, 'total_cents', tot, 'tip_cents', tip,
                            'cash_cents', cash, 'card_cents', card, 'name', nm, 'phone', ph);
end $$;
revoke all on function public.agenda_checkout(uuid, jsonb) from public, anon;
grant execute on function public.agenda_checkout(uuid, jsonb) to authenticated;

-- cancelling a ticket: the owner or a manager only, never on a closed day; the client is to be paid again
create or replace function public.agenda_sale_cancel(p_restaurant_id uuid, p_sale uuid, p_reason text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; s public.agenda_sales; a public.agenda_appointments;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  select * into s from public.agenda_sales where id = p_sale and restaurant_id = r.id for update;
  if s.id is null then perform app.fail('not_found'); end if;
  if s.cancelled_at is not null then return; end if;
  if coalesce(btrim(p_reason), '') = '' then perform app.fail('reason_required'); end if;
  if exists (select 1 from public.agenda_closings where restaurant_id = r.id and business_date = s.business_date) then perform app.fail('day_closed'); end if;
  update public.agenda_sales set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = left(btrim(p_reason), 200) where id = s.id;
  if s.customer_id is not null then
    select * into a from public.agenda_appointments where id = s.appointment_id;
    if a.id is not null and a.phone is not null and a.phone = s.phone then
      update public.customers set spent_cents = greatest(0, spent_cents - s.total_cents + a.price_cents) where id = s.customer_id;
    else
      update public.customers set spent_cents = greatest(0, spent_cents - s.total_cents), visits = greatest(0, visits - 1) where id = s.customer_id;
    end if;
  end if;
end $$;
revoke all on function public.agenda_sale_cancel(uuid, uuid, text) from public, anon;
grant execute on function public.agenda_sale_cancel(uuid, uuid, text) to authenticated;

-- the day of the till: the tickets, the totals, per person, the clients not paid, the closing.
-- Before the closing the salon's screen does not see the cash (the count must be blind); the owner
-- and the managers always do.
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
               'expected_cash_cents', c.expected_cash_cents, 'cash_diff_cents', c.cash_diff_cents, 'unpaid', c.unpaid, 'note', c.note) end,
    'sales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number, 'at', s.created_at, 'name', s.name, 'phone', s.phone,
               'staff_id', s.staff_id, 'total_cents', s.total_cents, 'tip_cents', s.tip_cents, 'discount_cents', s.discount_cents,
               'discount_reason', s.discount_reason, 'free_reason', s.free_reason,
               'cash_cents', case when sees_cash then s.cash_cents end, 'card_cents', s.card_cents,
               'appointment_id', s.appointment_id, 'queue_id', s.queue_id,
               'cancelled', s.cancelled_at is not null, 'cancel_reason', s.cancel_reason,
               'lines', (select jsonb_agg(jsonb_build_object('kind', l.kind, 'name', l.name, 'quantity', l.quantity, 'unit_cents', l.unit_cents,
                          'line_cents', l.line_cents, 'staff_id', l.staff_id) order by l.sort) from public.agenda_sale_lines l where l.sale_id = s.id))
               order by s.number desc)
       from public.agenda_sales s where s.restaurant_id = r.id and s.business_date = d), '[]'::jsonb),
    'totals', (select jsonb_build_object('tickets', count(*) filter (where cancelled_at is null),
               'total_cents', coalesce(sum(total_cents) filter (where cancelled_at is null), 0),
               'card_cents', coalesce(sum(card_cents) filter (where cancelled_at is null), 0),
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
revoke all on function public.agenda_day_till(uuid, date) from public, anon;
grant execute on function public.agenda_day_till(uuid, date) to authenticated;

-- the closing: every client seen and not paid is explained, then the drawer is counted blind.
-- p_unpaid: [{kind, id, reason}] for each client still unpaid.
create or replace function public.agenda_close_day(p_restaurant_id uuid, p_date date, p_counted_cash_cents bigint, p_unpaid jsonb default '[]'::jsonb, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; d date; up jsonb; e jsonb; why text; expected bigint; tot jsonb; out jsonb := '[]'::jsonb; diff bigint;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  d := coalesce(p_date, app.business_date(r));
  if d > app.business_date(r) then perform app.fail('invalid_date'); end if;
  if p_counted_cash_cents is null or p_counted_cash_cents not between 0 and 10000000000 then perform app.fail('invalid_request', 'counted_cash'); end if;
  perform pg_advisory_xact_lock(hashtext('agenda_sales' || r.id::text || d::text));
  if exists (select 1 from public.agenda_closings where restaurant_id = r.id and business_date = d) then perform app.fail('day_closed'); end if;
  up := app.agenda_unpaid(r, d);
  for e in select * from jsonb_array_elements(up) loop
    select btrim(x ->> 'reason') into why from jsonb_array_elements(coalesce(p_unpaid, '[]'::jsonb)) x
     where x ->> 'kind' = e ->> 'kind' and x ->> 'id' = e ->> 'id' limit 1;
    if coalesce(why, '') = '' then perform app.fail('unpaid', e ->> 'id'); end if;
    out := out || jsonb_build_array(jsonb_build_object('kind', e -> 'kind', 'id', e -> 'id', 'name', e -> 'name', 'at', e -> 'at',
                                    'staff_id', e -> 'staff_id', 'price_cents', e -> 'price_cents', 'reason', left(why, 100)));
  end loop;
  select coalesce(sum(cash_cents), 0) into expected from public.agenda_sales where restaurant_id = r.id and business_date = d and cancelled_at is null;
  select jsonb_build_object('tickets', count(*) filter (where cancelled_at is null),
           'total_cents', coalesce(sum(total_cents) filter (where cancelled_at is null), 0),
           'card_cents', coalesce(sum(card_cents) filter (where cancelled_at is null), 0),
           'cash_cents', coalesce(sum(cash_cents) filter (where cancelled_at is null), 0),
           'tip_cents', coalesce(sum(tip_cents) filter (where cancelled_at is null), 0),
           'discount_cents', coalesce(sum(discount_cents) filter (where cancelled_at is null), 0),
           'cancelled', count(*) filter (where cancelled_at is not null))
    into tot from public.agenda_sales where restaurant_id = r.id and business_date = d;
  diff := p_counted_cash_cents - expected;
  insert into public.agenda_closings (restaurant_id, business_date, counted_cash_cents, expected_cash_cents, cash_diff_cents, totals, unpaid, note, closed_by)
  values (r.id, d, p_counted_cash_cents, expected, diff, tot, out, nullif(left(btrim(p_note), 300), ''), auth.uid());
  return jsonb_build_object('ok', true, 'expected_cash_cents', expected, 'counted_cash_cents', p_counted_cash_cents, 'cash_diff_cents', diff, 'totals', tot);
end $$;
revoke all on function public.agenda_close_day(uuid, date, bigint, jsonb, text) from public, anon;
grant execute on function public.agenda_close_day(uuid, date, bigint, jsonb, text) to authenticated;

notify pgrst, 'reload schema';
