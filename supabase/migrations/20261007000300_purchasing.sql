-- =============================================================================
-- 0032 PURCHASING: suppliers and purchase orders
-- =============================================================================
-- Suppliers with their WhatsApp number. Purchase orders (BC-0001...) made by
-- hand or in one click from "what to buy" (one order per supplier), sent on
-- WhatsApp, then received: what really came in, at what price. Receiving
-- writes the purchases, so the live stock goes up and the dish costs follow
-- the new prices at once. Managers and owners only.
-- =============================================================================

create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  phone         text check (phone is null or phone ~ '^[0-9]{6,15}$'),   -- WhatsApp, international digits (2126...)
  email         text check (length(email) <= 120),
  contact       text check (length(contact) <= 80),
  -- days it delivers (1 = Monday ... 7 = Sunday) and how long after the order
  delivery_days int[] not null default '{}' check (delivery_days <@ array[1,2,3,4,5,6,7]),
  lead_days     integer not null default 1 check (lead_days between 0 and 30),
  note          text check (length(note) <= 300),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
create unique index if not exists suppliers_name_idx on public.suppliers (restaurant_id, lower(btrim(name)));
drop trigger if exists suppliers_same_tenant on public.suppliers;
create trigger suppliers_same_tenant before update on public.suppliers
  for each row execute function app.forbid_restaurant_change();

alter table public.ingredients add column if not exists supplier_id uuid;
alter table public.ingredients drop constraint if exists ingredients_supplier_fk;
alter table public.ingredients add constraint ingredients_supplier_fk
  foreign key (restaurant_id, supplier_id) references public.suppliers (restaurant_id, id) on delete set null (supplier_id);

-- the suppliers typed so far on ingredients become real suppliers
insert into public.suppliers (restaurant_id, name)
select distinct on (restaurant_id, lower(btrim(supplier))) restaurant_id, btrim(supplier)
  from public.ingredients where nullif(btrim(supplier), '') is not null
on conflict do nothing;
update public.ingredients g set supplier_id = s.id
  from public.suppliers s
 where s.restaurant_id = g.restaurant_id and lower(btrim(s.name)) = lower(btrim(g.supplier)) and g.supplier_id is null;

create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  supplier_id   uuid,
  number        bigint not null,
  doc_number    text not null,
  status        text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  expected_on   date,
  note          text check (length(note) <= 300),
  sent_at       timestamptz,
  received_at   timestamptz,
  received_on   date,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, number),
  foreign key (restaurant_id, supplier_id) references public.suppliers (restaurant_id, id) on delete set null (supplier_id)
);
create index if not exists purchase_orders_idx on public.purchase_orders (restaurant_id, created_at desc);

create table if not exists public.purchase_order_lines (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  order_id         uuid not null,
  ingredient_id    uuid not null,
  units            numeric(14, 3) not null check (units > 0 and units < 1000000),   -- in purchase units (kg, caisse...)
  unit_price_cents bigint check (unit_price_cents between 0 and 100000000),        -- expected price of one purchase unit
  received_units   numeric(14, 3) check (received_units >= 0 and received_units < 1000000),
  received_cents   bigint check (received_cents between 0 and 10000000000),
  purchase_id      uuid,
  sort_order       integer not null default 0,
  unique (restaurant_id, id),
  unique (order_id, ingredient_id),
  foreign key (restaurant_id, order_id) references public.purchase_orders (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create index if not exists purchase_order_lines_idx on public.purchase_order_lines (restaurant_id, order_id);

alter table public.stock_purchases
  add column if not exists supplier_id uuid,
  add column if not exists purchase_order_id uuid;
alter table public.stock_purchases drop constraint if exists stock_purchases_supplier_fk;
alter table public.stock_purchases add constraint stock_purchases_supplier_fk
  foreign key (restaurant_id, supplier_id) references public.suppliers (restaurant_id, id) on delete set null (supplier_id);

-- ------------------------------------------------------------ guards
create or replace function app.purchase_orders_before()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.number := app.next_counter(new.restaurant_id, 'purchase_order');
    new.doc_number := 'BC-' || lpad(new.number::text, 4, '0');
    if app.is_client() then new.status := 'draft'; new.sent_at := null; new.received_at := null; new.received_on := null; end if;
    return new;
  end if;
  new.number := old.number; new.doc_number := old.doc_number;
  if app.is_client() then
    -- received is set by receiving only, and a received order is final
    if old.status = 'received' then raise exception 'purchase order received' using errcode = '22023', hint = 'po_received'; end if;
    if new.status = 'received' then raise exception 'use po_receive' using errcode = '22023'; end if;
    new.received_at := old.received_at; new.received_on := old.received_on;
    if new.status = 'sent' and old.status = 'draft' then new.sent_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_before on public.purchase_orders;
create trigger purchase_orders_before before insert or update on public.purchase_orders
  for each row execute function app.purchase_orders_before();

create or replace function app.purchase_order_lines_guard()
returns trigger language plpgsql set search_path = '' as $$
declare st text;
begin
  if not app.is_client() then return coalesce(new, old); end if;
  select status into st from public.purchase_orders where id = coalesce(new.order_id, old.order_id);
  if st in ('received', 'cancelled') then
    raise exception 'purchase order closed' using errcode = '22023', hint = 'po_closed';
  end if;
  if tg_op <> 'DELETE' then new.received_units := null; new.received_cents := null; new.purchase_id := null; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists purchase_order_lines_guard on public.purchase_order_lines;
create trigger purchase_order_lines_guard before insert or update or delete on public.purchase_order_lines
  for each row execute function app.purchase_order_lines_guard();

-- a purchase with a supplier keeps its name too (lists, old reports)
create or replace function app.stock_purchases_supplier()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.supplier_id is not null and nullif(btrim(coalesce(new.supplier, '')), '') is null then
    select name into new.supplier from public.suppliers where restaurant_id = new.restaurant_id and id = new.supplier_id;
  end if;
  return new;
end $$;
drop trigger if exists stock_purchases_supplier on public.stock_purchases;
create trigger stock_purchases_supplier before insert on public.stock_purchases
  for each row execute function app.stock_purchases_supplier();

-- ------------------------------------------------------------ security
alter table public.suppliers            enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_lines enable row level security;
grant select, insert, update, delete on public.suppliers            to authenticated;
grant select, insert, update, delete on public.purchase_orders      to authenticated;
grant select, insert, update, delete on public.purchase_order_lines to authenticated;
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'purchase_orders', 'purchase_order_lines'] loop
    execute format($f$
      drop policy if exists %1$s_select on public.%1$s;
      drop policy if exists %1$s_insert on public.%1$s;
      drop policy if exists %1$s_update on public.%1$s;
      drop policy if exists %1$s_delete on public.%1$s;
      create policy %1$s_select on public.%1$s for select to authenticated
        using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
        with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
    $f$, t);
  end loop;
end $$;
drop trigger if exists audit_purchase_orders on public.purchase_orders;
create trigger audit_purchase_orders after update or delete on public.purchase_orders
  for each row execute function app.audit();

-- ------------------------------------------------------------ actions
-- One click from "what to buy": one draft order per supplier (products without supplier together).
create or replace function public.po_from_forecast(p_restaurant_id uuid, p_ingredient_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; f jsonb; x record; po uuid; made uuid[] := '{}'; last_sup uuid; first boolean := true; units numeric;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  if p_ingredient_ids is null or cardinality(p_ingredient_ids) = 0 then perform app.fail('invalid_request', 'ingredients'); end if;
  f := public.stock_forecast(r.id);
  for x in
    select g.id, g.supplier_id, g.purchase_qty, g.base_unit, g.purchase_price_cents,
           coalesce((i ->> 'to_buy')::numeric, 0) to_buy, s.lead_days
      from jsonb_array_elements(f -> 'items') i
      join public.ingredients g on g.restaurant_id = r.id and g.id = (i ->> 'ingredient_id')::uuid
      left join public.suppliers s on s.restaurant_id = r.id and s.id = g.supplier_id
     where g.id = any (p_ingredient_ids)
     order by g.supplier_id nulls last, g.name loop
    -- buy the way one buys: half kilos / litres, whole crates and pieces; at least one unit
    units := x.to_buy / x.purchase_qty;
    units := greatest(case when x.purchase_qty = 1000 and x.base_unit <> 'pc' then ceil(units * 2) / 2 else ceil(units) end,
                      case when x.purchase_qty = 1000 and x.base_unit <> 'pc' then 0.5 else 1 end);
    if first or x.supplier_id is distinct from last_sup then
      insert into public.purchase_orders (restaurant_id, supplier_id, expected_on)
      values (r.id, x.supplier_id, app.business_date(r) + coalesce(x.lead_days, 1))
      returning id into po;
      made := made || po; last_sup := x.supplier_id; first := false;
    end if;
    insert into public.purchase_order_lines (restaurant_id, order_id, ingredient_id, units, unit_price_cents, sort_order)
    values (r.id, po, x.id, units, x.purchase_price_cents, (select count(*) from public.purchase_order_lines where order_id = po) * 10)
    on conflict (order_id, ingredient_id) do nothing;
  end loop;
  return jsonb_build_object('ok', true, 'orders', to_jsonb(made));
end $$;

-- Receive an order: what came in (in purchase units) and what was paid per line. Missing lines = not delivered.
create or replace function public.po_receive(p_order_id uuid, p_lines jsonb, p_received_on date default null, p_after_count boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; r public.restaurants; l public.purchase_order_lines; g public.ingredients; x jsonb;
        v_units numeric; v_cents bigint; pid uuid; dt date; n int := 0; alerts jsonb := '[]'; old_unit numeric; new_unit numeric; sup text;
begin
  select * into po from public.purchase_orders where id = p_order_id for update;
  if po.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(po.restaurant_id, 'manager', true);
  if po.status in ('received', 'cancelled') then perform app.fail('po_closed'); end if;
  if jsonb_typeof(p_lines) <> 'array' then perform app.fail('invalid_request', 'lines'); end if;
  dt := coalesce(p_received_on, app.business_date(r));
  if dt > app.business_date(r) then perform app.fail('invalid_date'); end if;
  select name into sup from public.suppliers where restaurant_id = r.id and id = po.supplier_id;
  for x in select * from jsonb_array_elements(p_lines) loop
    select * into l from public.purchase_order_lines where restaurant_id = r.id and order_id = po.id and id = app.try_uuid(x ->> 'line_id');
    if l.id is null then perform app.fail('not_found', 'line'); end if;
    v_units := nullif(x ->> 'units', '')::numeric;
    v_cents := nullif(x ->> 'total_cents', '')::bigint;
    if v_units is null or v_units < 0 or v_units >= 1000000 or (v_cents is not null and (v_cents < 0 or v_cents > 10000000000)) then
      perform app.fail('invalid_request', 'line');
    end if;
    pid := null;
    if v_units > 0 then
      select * into g from public.ingredients where restaurant_id = r.id and id = l.ingredient_id;
      old_unit := g.purchase_price_cents;
      insert into public.stock_purchases (restaurant_id, ingredient_id, purchased_on, qty, total_cents, supplier, supplier_id, purchase_order_id, after_count)
      values (r.id, g.id, dt, v_units * g.purchase_qty, v_cents, sup, po.supplier_id, po.id, p_after_count)
      returning id into pid;
      n := n + 1;
      -- price up by more than 5 % compared with the last known price
      if v_cents is not null and v_cents > 0 and old_unit is not null and old_unit > 0 then
        new_unit := v_cents / v_units;
        if new_unit > old_unit * 1.05 then
          alerts := alerts || jsonb_build_object('ingredient_id', g.id, 'name', g.name, 'purchase_unit', g.purchase_unit,
                                                 'old_cents', old_unit, 'new_cents', round(new_unit)::bigint,
                                                 'bp', round((new_unit - old_unit) * 10000 / old_unit)::int);
        end if;
      end if;
    end if;
    update public.purchase_order_lines set received_units = v_units, received_cents = v_cents, purchase_id = pid where id = l.id;
  end loop;
  update public.purchase_orders set status = 'received', received_at = now(), received_on = dt where id = po.id;
  return jsonb_build_object('ok', true, 'purchases', n, 'price_alerts', alerts,
    'total_cents', (select coalesce(sum(received_cents), 0) from public.purchase_order_lines where order_id = po.id));
end $$;

-- Last prices per supplier for one ingredient (to compare).
create or replace function public.supplier_prices(p_ingredient_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare g public.ingredients;
begin
  select * into g from public.ingredients where id = p_ingredient_id;
  if g.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(g.restaurant_id, 'manager', false);
  return (select coalesce(jsonb_agg(x order by (x ->> 'unit_cents')::numeric), '[]'::jsonb) from (
    select distinct on (coalesce(p.supplier_id::text, lower(btrim(coalesce(p.supplier, '')))))
           jsonb_build_object('supplier_id', p.supplier_id, 'supplier', coalesce(s.name, nullif(btrim(p.supplier), ''), '—'),
                              'purchased_on', p.purchased_on,
                              'unit_cents', round(p.total_cents * g.purchase_qty / p.qty)::bigint) x
      from public.stock_purchases p left join public.suppliers s on s.id = p.supplier_id
     where p.restaurant_id = g.restaurant_id and p.ingredient_id = g.id and p.total_cents > 0
     order by coalesce(p.supplier_id::text, lower(btrim(coalesce(p.supplier, '')))), p.purchased_on desc, p.created_at desc) y);
end $$;

revoke all on function public.po_from_forecast(uuid, uuid[]) from public, anon;
revoke all on function public.po_receive(uuid, jsonb, date, boolean) from public, anon;
revoke all on function public.supplier_prices(uuid) from public, anon;
grant execute on function public.po_from_forecast(uuid, uuid[]) to authenticated;
grant execute on function public.po_receive(uuid, jsonb, date, boolean) to authenticated;
grant execute on function public.supplier_prices(uuid) to authenticated;
