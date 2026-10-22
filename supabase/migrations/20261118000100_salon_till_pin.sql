-- =============================================================================
-- AMPLIFY AGENDA (10): the salon on the till app (caisse.amplifygrowthstudio.com)
--
-- At the reception the till is unlocked with each person's PIN, like in a restaurant. A ticket
-- keeps who took the money (cashier_id), the closing who closed the day. Cancelling a ticket at the
-- till needs a manager's PIN (an owner or manager account still can without one).
-- =============================================================================

alter table public.agenda_sales add column if not exists cashier_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_sales_cashier_fk') then
    alter table public.agenda_sales add constraint agenda_sales_cashier_fk foreign key (restaurant_id, cashier_id)
      references public.staff (restaurant_id, id) on delete set null (cashier_id);
  end if;
end $$;
alter table public.agenda_sales add column if not exists cancelled_by_staff uuid;
alter table public.agenda_closings add column if not exists closed_by_staff uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_closings_staff_fk') then
    alter table public.agenda_closings add constraint agenda_closings_staff_fk foreign key (restaurant_id, closed_by_staff)
      references public.staff (restaurant_id, id) on delete set null (closed_by_staff);
  end if;
end $$;

-- the ticket remembers who took the money (p.cashier_id: the person unlocked on the till)
create or replace function app.agenda_sale_cashier()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c text := current_setting('app.cashier', true);
begin
  if nullif(c, '') is not null then
    new.cashier_id := c::uuid;
  end if;
  return new;
end $$;
drop trigger if exists agenda_sales_cashier on public.agenda_sales;
create trigger agenda_sales_cashier before insert on public.agenda_sales
  for each row execute function app.agenda_sale_cashier();

create or replace function public.agenda_checkout_by(p_restaurant_id uuid, p jsonb, p_cashier uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'device', true);
  if p_cashier is not null and not exists (select 1 from public.staff where id = p_cashier and restaurant_id = p_restaurant_id and active) then
    perform app.fail('invalid_request', 'cashier');
  end if;
  perform set_config('app.cashier', coalesce(p_cashier::text, ''), true);
  return public.agenda_checkout(p_restaurant_id, p);
end $$;
revoke all on function public.agenda_checkout_by(uuid, jsonb, uuid) from public, anon;
grant execute on function public.agenda_checkout_by(uuid, jsonb, uuid) to authenticated;

-- cancelling: an owner or manager account, or the till with a manager's PIN
drop function if exists public.agenda_sale_cancel(uuid, uuid, text);
create or replace function public.agenda_sale_cancel(p_restaurant_id uuid, p_sale uuid, p_reason text, p_staff_id uuid default null, p_pin text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; s public.agenda_sales; a public.agenda_appointments; res text;
begin
  if p_restaurant_id = any (app.my_restaurants('manager')) then
    r := app.require_role(p_restaurant_id, 'manager', true);
  else
    r := app.require_role(p_restaurant_id, 'device', true);
    if p_staff_id is null then perform app.fail('not_allowed'); end if;
    res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'manager');
    if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;
  end if;
  select * into s from public.agenda_sales where id = p_sale and restaurant_id = r.id for update;
  if s.id is null then perform app.fail('not_found'); end if;
  if s.cancelled_at is not null then return jsonb_build_object('ok', true); end if;
  if coalesce(btrim(p_reason), '') = '' then perform app.fail('reason_required'); end if;
  if exists (select 1 from public.agenda_closings where restaurant_id = r.id and business_date = s.business_date) then perform app.fail('day_closed'); end if;
  update public.agenda_sales set cancelled_at = now(), cancelled_by = auth.uid(), cancelled_by_staff = p_staff_id, cancel_reason = left(btrim(p_reason), 200) where id = s.id;
  if s.customer_id is not null then
    select * into a from public.agenda_appointments where id = s.appointment_id;
    if a.id is not null and a.phone is not null and a.phone = s.phone then
      update public.customers set spent_cents = greatest(0, spent_cents - s.total_cents + a.price_cents) where id = s.customer_id;
    else
      update public.customers set spent_cents = greatest(0, spent_cents - s.total_cents), visits = greatest(0, visits - 1) where id = s.customer_id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.agenda_sale_cancel(uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.agenda_sale_cancel(uuid, uuid, text, uuid, text) to authenticated;

-- the closing remembers who closed (the person unlocked on the till)
drop function if exists public.agenda_close_day(uuid, date, bigint, jsonb, text);
create or replace function public.agenda_close_day(p_restaurant_id uuid, p_date date, p_counted_cash_cents bigint, p_unpaid jsonb default '[]'::jsonb, p_note text default null, p_staff_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; d date; up jsonb; e jsonb; why text; expected bigint; tot jsonb; out jsonb := '[]'::jsonb; diff bigint;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  d := coalesce(p_date, app.business_date(r));
  if d > app.business_date(r) then perform app.fail('invalid_date'); end if;
  if p_counted_cash_cents is null or p_counted_cash_cents not between 0 and 10000000000 then perform app.fail('invalid_request', 'counted_cash'); end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where id = p_staff_id and restaurant_id = r.id) then perform app.fail('invalid_request', 'staff'); end if;
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
  insert into public.agenda_closings (restaurant_id, business_date, counted_cash_cents, expected_cash_cents, cash_diff_cents, totals, unpaid, note, closed_by, closed_by_staff)
  values (r.id, d, p_counted_cash_cents, expected, diff, tot, out, nullif(left(btrim(p_note), 300), ''), auth.uid(), p_staff_id);
  return jsonb_build_object('ok', true, 'expected_cash_cents', expected, 'counted_cash_cents', p_counted_cash_cents, 'cash_diff_cents', diff, 'totals', tot);
end $$;
revoke all on function public.agenda_close_day(uuid, date, bigint, jsonb, text, uuid) from public, anon;
grant execute on function public.agenda_close_day(uuid, date, bigint, jsonb, text, uuid) to authenticated;

-- the day of the till also says who took each payment and who closed
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

notify pgrst, 'reload schema';
