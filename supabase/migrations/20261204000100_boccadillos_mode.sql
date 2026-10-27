-- Boccadillos mode (stap A): a per-restaurant switch (platform admin only) and the
-- "pay first, then kitchen" rule for QR orders.
--
--   * restaurants.boccadillos: off by default. Owners cannot change it (no column grant);
--     only admin_set_boccadillos() (platform admin) can.
--   * orders.prepaid_at: set ONLY by pos_collect_prepaid(). The cash is recorded as a normal
--     payment row at that moment, the order goes to "preparing" (= the kitchen), and the order
--     is closed at handover with the existing close_order() (which checks paid = total).
--   * While prepaid: lines cannot be added, removed or changed in quantity, and the payment
--     cannot be deleted by the till. A prepaid order cannot be cancelled through cancel_order()
--     (it refuses while payments exist); a refund function comes in a later step.
-- Restaurants with the switch off are not affected by any of this.

alter table public.restaurants
  add column if not exists boccadillos boolean not null default false;

alter table public.orders
  add column if not exists prepaid_at timestamptz;

-- ------------------------------------------------------------ platform switch
create or replace function public.admin_set_boccadillos(p_restaurant_id uuid, p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants;
begin
  perform app.require_platform_admin();
  if p_on is null then perform app.fail('invalid_request', 'on'); end if;
  update public.restaurants set boccadillos = p_on where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('boccadillos', r.boccadillos);
end $$;
revoke all on function public.admin_set_boccadillos(uuid, boolean) from public, anon;
grant execute on function public.admin_set_boccadillos(uuid, boolean) to authenticated;

-- ------------------------------------------------------------ guards
-- the till cannot set or clear prepaid_at itself
create or replace function app.orders_prepaid_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client() then
    if tg_op = 'INSERT' and new.prepaid_at is not null then
      raise exception 'use pos_collect_prepaid()' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.prepaid_at is distinct from old.prepaid_at then
      raise exception 'use pos_collect_prepaid()' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_prepaid_guard on public.orders;
create trigger orders_prepaid_guard before insert or update on public.orders
  for each row execute function app.orders_prepaid_guard();

-- a prepaid order keeps its lines: the money already taken matches them
create or replace function app.prepaid_lines_guard()
returns trigger language plpgsql set search_path = '' as $$
declare oid_ uuid; rid uuid;
begin
  if tg_op = 'DELETE' then
    if app.purging() then return old; end if;
    oid_ := old.order_id; rid := old.restaurant_id;
  else
    oid_ := new.order_id; rid := new.restaurant_id;
    if tg_op = 'UPDATE' and new.quantity = old.quantity then return new; end if;
  end if;
  perform 1 from public.orders o
   where o.restaurant_id = rid and o.id = oid_ and o.prepaid_at is not null;
  if found then
    raise exception 'order is already paid: lines cannot change' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists order_lines_prepaid_guard on public.order_lines;
create trigger order_lines_prepaid_guard before insert or update or delete on public.order_lines
  for each row execute function app.prepaid_lines_guard();

-- the till cannot delete the payment of a prepaid order
create or replace function app.prepaid_payment_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client() and not app.purging() then
    perform 1 from public.orders o
     where o.restaurant_id = old.restaurant_id and o.id = old.order_id and o.prepaid_at is not null;
    if found then
      raise exception 'order is already paid: payment cannot be removed' using errcode = '42501';
    end if;
  end if;
  return old;
end $$;
drop trigger if exists payments_prepaid_guard on public.payments;
create trigger payments_prepaid_guard before delete on public.payments
  for each row execute function app.prepaid_payment_guard();

-- ------------------------------------------------------------ collect cash, then kitchen
-- Only for a pending QR order of a restaurant with boccadillos mode on.
-- Records the cash payment for the full total and moves the order to "preparing".
create or replace function public.pos_collect_prepaid(p_order_id uuid, p_staff_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  r public.restaurants;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if not r.boccadillos then perform app.fail('mode_off'); end if;
  if o.closed_at is not null then perform app.fail('order_already_closed'); end if;
  if o.status = 'cancelled' then perform app.fail('order_cancelled'); end if;
  if o.prepaid_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'total_cents', o.total_cents);
  end if;
  if o.source <> 'qr' or o.status <> 'new' then perform app.fail('invalid_request', 'not_pending_qr'); end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff where restaurant_id = r.id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  if not exists (select 1 from public.order_lines where restaurant_id = r.id and order_id = o.id) then
    perform app.fail('order_empty');
  end if;
  if exists (select 1 from public.payments where restaurant_id = r.id and order_id = o.id) then
    perform app.fail('invalid_request', 'already_has_payments');
  end if;

  if o.total_cents > 0 then
    insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents, staff_id)
    values (r.id, o.id, 'cash', o.total_cents, 0, coalesce(p_staff_id, o.staff_id));
  end if;
  update public.orders set prepaid_at = now(), status = 'preparing' where id = o.id;
  return jsonb_build_object('ok', true, 'already', false, 'total_cents', o.total_cents);
end $$;
revoke all on function public.pos_collect_prepaid(uuid, uuid) from public, anon;
grant execute on function public.pos_collect_prepaid(uuid, uuid) to authenticated;
