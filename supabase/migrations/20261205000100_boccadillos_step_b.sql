-- Boccadillos mode (stap B): name required, unpaid QR orders expire, refund of a paid order
-- through the existing cancel button (manager PIN), and a tiny public flag for the guest app.
-- Restaurants with the mode off are not affected.

-- ------------------------------------------------------------ name required (QR, kiosk and table)
create or replace function app.orders_boccadillos_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source = 'qr' and nullif(btrim(coalesce(new.customer_name, '')), '') is null then
    perform 1 from public.restaurants r where r.id = new.restaurant_id and r.boccadillos;
    if found then perform app.fail('customer_required'); end if;
  end if;
  return new;
end $$;
drop trigger if exists orders_boccadillos_name on public.orders;
create trigger orders_boccadillos_name before insert on public.orders
  for each row execute function app.orders_boccadillos_name();

-- ------------------------------------------------------------ flag for the guest app (public)
create or replace function public.get_boccadillos(p_slug text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.boccadillos from public.restaurants r
                    where r.slug = lower(p_slug) and r.status <> 'cancelled'), false)
$$;
revoke all on function public.get_boccadillos(text) from public;
grant execute on function public.get_boccadillos(text) to anon, authenticated;

-- ------------------------------------------------------------ unpaid orders expire
-- Called by the till every minute while the mode is on. Default 20 minutes
-- (restaurants.pos_settings.unpaid_minutes, between 5 and 240).
create or replace function public.expire_unpaid_qr(p_restaurant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.restaurants;
  mins integer;
  n integer;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if not r.boccadillos then return 0; end if;
  mins := case when coalesce(r.pos_settings ->> 'unpaid_minutes', '') ~ '^[0-9]{1,3}$'
               then least(240, greatest(5, (r.pos_settings ->> 'unpaid_minutes')::int)) else 20 end;
  update public.orders o
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Non payée : expirée'
   where o.restaurant_id = r.id and o.source = 'qr' and o.status = 'new'
     and o.prepaid_at is null and o.closed_at is null
     and o.created_at < now() - make_interval(mins => mins)
     and not exists (select 1 from public.payments p where p.restaurant_id = o.restaurant_id and p.order_id = o.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_unpaid_qr(uuid) from public, anon;
grant execute on function public.expire_unpaid_qr(uuid) to authenticated;

-- ------------------------------------------------------------ cancel a paid (prepaid) order = refund
-- Same as before, except: a prepaid order may be cancelled with a reason and a manager PIN;
-- its cash payment is then removed (the money goes back to the guest).
create or replace function public.cancel_order(
  p_order_id uuid, p_reason text, p_manager_staff_id uuid default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders; res text; has_lines boolean; free boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_closed_use_credit_note'); end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', true);
  end if;
  if o.prepaid_at is null and exists (select 1 from public.payments where restaurant_id = o.restaurant_id and order_id = o.id) then
    perform app.fail('remove_payments_first');
  end if;
  select exists (select 1 from public.order_lines where restaurant_id = o.restaurant_id and order_id = o.id)
    into has_lines;
  -- nothing to pay (empty, or only free items): no reason or manager needed. A prepaid order always needs both.
  free := o.prepaid_at is null and (not has_lines or o.total_cents = 0);
  if not free then
    if nullif(btrim(p_reason), '') is null then perform app.fail('reason_required'); end if;
    res := app.check_staff_pin(o.restaurant_id, p_manager_staff_id, p_pin, 'manager');
    if res <> 'ok' then
      return jsonb_build_object('ok', false, 'error', res);
    end if;
  end if;
  if o.prepaid_at is not null then
    delete from public.payments where restaurant_id = o.restaurant_id and order_id = o.id;
  end if;
  update public.orders
     set status = 'cancelled', cancelled_at = now(),
         cancelled_by_staff_id = case when not free then p_manager_staff_id end,
         cancel_reason = left(coalesce(nullif(btrim(p_reason), ''), case when free then 'Table libérée (0 MAD)' end), 200)
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;
