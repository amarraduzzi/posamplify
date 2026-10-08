-- =============================================================================
-- Own delivery: couriers, dispatch from the till, the courier's phone page, proof of delivery
-- * couriers: name, phone, a secret token for their page (no app, no login).
-- * orders: courier_id, delivery_status (assigned, picked_up, delivered, failed), times,
--   delivery_code (4 digits the guest gives the courier: proof of delivery), courier note.
-- * courier_orders / courier_update: the courier's page (anon, by token). A wrong code is
--   counted; after 5 the order must be closed from the till.
-- * get_order_status: the guest's tracking page shows the code and the courier's first name.
-- * courier_report: deliveries, problems, delivery time and cash still to bring back.
-- =============================================================================
create table if not exists public.couriers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 40),
  phone         text check (length(phone) <= 30),
  active        boolean not null default true,
  token         text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
alter table public.couriers enable row level security;
grant select, insert, update, delete on public.couriers to authenticated;
drop policy if exists couriers_select on public.couriers;
drop policy if exists couriers_insert on public.couriers;
drop policy if exists couriers_update on public.couriers;
drop policy if exists couriers_delete on public.couriers;
create policy couriers_select on public.couriers for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy couriers_insert on public.couriers for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy couriers_update on public.couriers for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy couriers_delete on public.couriers for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

alter table public.orders
  add column if not exists courier_id uuid,
  add column if not exists delivery_status text check (delivery_status in ('assigned', 'picked_up', 'delivered', 'failed')),
  add column if not exists picked_up_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_code text check (delivery_code ~ '^[0-9]{4}$'),
  add column if not exists delivery_note text check (length(delivery_note) <= 200),
  add column if not exists delivery_tries smallint not null default 0;
alter table public.orders drop constraint if exists orders_courier_fk;
alter table public.orders add constraint orders_courier_fk foreign key (restaurant_id, courier_id) references public.couriers (restaurant_id, id) on delete set null (courier_id);
create index if not exists orders_courier_idx on public.orders (courier_id, created_at) where courier_id is not null;

-- paid orders stay frozen, except their delivery (a prepaid order is delivered after payment)
create or replace function app.orders_before_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.restaurant_id <> old.restaurant_id or new.id <> old.id
     or new.client_id <> old.client_id or new.business_date <> old.business_date
     or new.ticket_number <> old.ticket_number or new.source <> old.source
     or new.created_at <> old.created_at then
    raise exception 'order identity fields cannot be changed' using errcode = '42501';
  end if;

  -- a closed order is frozen, except the kitchen can still mark it served and the courier deliver it
  if old.closed_at is not null then
    if (to_jsonb(new) - '{status,updated_at,courier_id,delivery_status,picked_up_at,delivered_at,delivery_note,delivery_tries,delivery_code}'::text[]) <> (to_jsonb(old) - '{status,updated_at,courier_id,delivery_status,picked_up_at,delivered_at,delivery_note,delivery_tries,delivery_code}'::text[])
       or new.status = 'cancelled' then
      raise exception 'order is closed, use a credit note to correct it' using errcode = '42501';
    end if;
  end if;

  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled order cannot be reopened' using errcode = '42501';
  end if;

  if app.is_client() then
    -- discount, cancellation and closing only through server functions,
    -- which check the manager PIN and write the audit trail
    if new.discount_cents <> old.discount_cents
       or new.discount_by_staff_id is distinct from old.discount_by_staff_id
       or new.cancelled_at is distinct from old.cancelled_at
       or new.cancelled_by_staff_id is distinct from old.cancelled_by_staff_id
       or new.cancel_reason is distinct from old.cancel_reason
       or (new.status = 'cancelled' and old.status <> 'cancelled')
       or new.closed_at is distinct from old.closed_at
       or new.fiscal_document_id is distinct from old.fiscal_document_id then
      raise exception 'use the dedicated function for discounts, cancellation and payment'
        using errcode = '42501';
    end if;
  end if;

  if old.closed_at is null then
    new.subtotal_cents := (
      select coalesce(sum(l.line_total_cents), 0)
      from public.order_lines l
      where l.restaurant_id = new.restaurant_id and l.order_id = new.id
    );
    -- a percentage promo code follows the order when dishes are added or removed
    if new.promo_id is not null and new.discount_kind = 'promo' then
      new.discount_cents := coalesce((select round(new.subtotal_cents * p.value / 10000.0)::bigint from public.promotions p
                                       where p.id = new.promo_id and p.discount_type = 'percent'), new.discount_cents);
    end if;
    if new.discount_cents > new.subtotal_cents then
      new.discount_cents := new.subtotal_cents;
    end if;
    new.total_cents := new.subtotal_cents - new.discount_cents;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- every delivery order gets its code (not security definer: runs as the caller)
create or replace function app.orders_delivery_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.order_type = 'delivery' and new.delivery_code is null then
    new.delivery_code := lpad(floor(random() * 10000)::int::text, 4, '0');
  end if;
  if tg_op = 'UPDATE' and new.courier_id is distinct from old.courier_id and new.courier_id is not null then
    new.delivery_status := coalesce(nullif(new.delivery_status, 'failed'), 'assigned');
    new.delivery_tries := 0;
  end if;
  return new;
end $$;
drop trigger if exists orders_delivery_code on public.orders;
create trigger orders_delivery_code before insert or update on public.orders
  for each row execute function app.orders_delivery_code();

create or replace function public.courier_orders(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.couriers; r public.restaurants;
begin
  select * into c from public.couriers where token = p_token and active;
  if c.id is null or length(coalesce(p_token, '')) < 20 then perform app.fail('not_found'); end if;
  select * into r from public.restaurants where id = c.restaurant_id;
  return jsonb_build_object(
    'courier', jsonb_build_object('name', c.name),
    'restaurant', jsonb_build_object('name', r.name, 'phone', r.phone, 'address', r.address, 'city', r.city, 'timezone', r.timezone),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'ticket_number', o.ticket_number, 'status', o.delivery_status, 'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
        'address', o.delivery_address, 'location', o.delivery_location, 'total_cents', o.total_cents, 'paid', o.closed_at is not null,
        'note', o.note, 'wanted_at', o.wanted_at, 'eta_at', o.eta_at, 'kitchen_ready', o.status in ('ready', 'served'),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('q', l.quantity, 'name', l.name) order by l.created_at), '[]'::jsonb)
                    from public.order_lines l where l.order_id = o.id and l.menu_item_id is not null)
      ) order by o.delivery_status = 'picked_up' desc, o.created_at), '[]'::jsonb)
      from public.orders o
     where o.courier_id = c.id and o.status <> 'cancelled' and o.delivery_status in ('assigned', 'picked_up')
       and o.created_at > now() - interval '24 hours'),
    'done_today', (select count(*) from public.orders o where o.courier_id = c.id and o.delivery_status = 'delivered'
                     and o.delivered_at > now() - interval '16 hours'),
    'cash_to_return_cents', (select coalesce(sum(o.total_cents), 0) from public.orders o where o.courier_id = c.id and o.delivery_status = 'delivered'
                     and o.closed_at is null and o.status <> 'cancelled' and o.delivered_at > now() - interval '24 hours'));
end $$;

create or replace function public.courier_update(p_token text, p_order_id uuid, p_action text, p_code text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.couriers; o public.orders;
begin
  select * into c from public.couriers where token = p_token and active;
  if c.id is null or length(coalesce(p_token, '')) < 20 then perform app.fail('not_found'); end if;
  select * into o from public.orders where id = p_order_id and courier_id = c.id for update;
  if o.id is null or o.status = 'cancelled' then perform app.fail('not_found'); end if;
  if p_action = 'picked_up' then
    if o.delivery_status <> 'assigned' then perform app.fail('invalid_request'); end if;
    update public.orders set delivery_status = 'picked_up', picked_up_at = now(),
           status = case when status in ('new', 'preparing') then 'ready' else status end where id = o.id;
  elsif p_action = 'delivered' then
    if o.delivery_status not in ('assigned', 'picked_up') then perform app.fail('invalid_request'); end if;
    if o.delivery_tries >= 5 then perform app.fail('too_many_tries'); end if;
    if coalesce(btrim(p_code), '') <> o.delivery_code then
      update public.orders set delivery_tries = delivery_tries + 1 where id = o.id;
      return jsonb_build_object('ok', false, 'error', 'wrong_code', 'tries_left', 4 - o.delivery_tries);
    end if;
    update public.orders set delivery_status = 'delivered', delivered_at = now(), picked_up_at = coalesce(picked_up_at, now()),
           status = case when status <> 'cancelled' then 'served' else status end where id = o.id;
  elsif p_action = 'failed' then
    if nullif(btrim(p_note), '') is null or length(p_note) > 200 then perform app.fail('reason_required'); end if;
    update public.orders set delivery_status = 'failed', delivery_note = btrim(p_note) where id = o.id;
  else
    perform app.fail('invalid_request');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', o.status, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'created_at', o.created_at,
                            'order_type', o.order_type, 'eta_at', o.eta_at, 'wanted_at', o.wanted_at,
                            'restaurant_phone', (select phone from public.restaurants where id = o.restaurant_id),
                            'delivery_status', o.delivery_status,
                            'delivery_code', case when o.order_type = 'delivery' and coalesce(o.delivery_status, 'assigned') in ('assigned', 'picked_up') then o.delivery_code end,
                            'courier', (select split_part(c.name, ' ', 1) from public.couriers c where c.id = o.courier_id))
  from public.orders o
  where o.id = coalesce((select to_order_id from app.order_redirects where from_order_id = p_order_id), p_order_id)
    and o.created_at > now() - interval '24 hours'
    and (o.source = 'qr' or exists (select 1 from app.order_redirects r where r.from_order_id = p_order_id))
$$;

create or replace function public.courier_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  return (select coalesce(jsonb_agg(x order by x.delivered desc), '[]'::jsonb) from (
    select c.id, c.name, c.active,
           count(o.id) filter (where o.delivery_status = 'delivered') delivered,
           count(o.id) filter (where o.delivery_status = 'failed') failed,
           count(o.id) filter (where o.delivery_status in ('assigned', 'picked_up')) on_the_way,
           round(avg(extract(epoch from (o.delivered_at - o.picked_up_at)) / 60) filter (where o.delivery_status = 'delivered' and o.picked_up_at is not null)) avg_minutes,
           coalesce(sum(o.total_cents) filter (where o.delivery_status = 'delivered' and o.closed_at is null and o.status <> 'cancelled'), 0) cash_to_return_cents,
           coalesce(sum(o.total_cents) filter (where o.delivery_status = 'delivered'), 0) delivered_cents
      from public.couriers c
      left join public.orders o on o.courier_id = c.id and o.business_date between p_from and p_to
     where c.restaurant_id = p_restaurant_id
     group by c.id, c.name, c.active
  ) x);
end $$;

revoke all on function public.courier_orders(text), public.courier_update(text, uuid, text, text, text), public.courier_report(uuid, date, date) from public;
grant execute on function public.courier_orders(text), public.courier_update(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.courier_report(uuid, date, date) to authenticated;
grant execute on function public.get_order_status(uuid) to anon, authenticated;
