-- Boccadillos mode: orders typed in at the till (counter) are also paid first (cash), then sent to the kitchen.
-- Same function as before with ONE change: it accepted only guest (QR) orders, now also orders made at the till
-- (source 'pos'). It still refuses every restaurant that does not have boccadillos mode on ('mode_off'),
-- so normal restaurants are not affected.
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
  if o.source not in ('qr', 'pos') or o.status <> 'new' then perform app.fail('invalid_request', 'not_pending_qr'); end if;
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
