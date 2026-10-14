-- =============================================================================
-- Catering (traiteur): quotes, confirmed orders, deposits, invoicing through the till's fiscal system
--
-- * A catering order (CT-0001) has a customer, an event date, pickup or delivery, and lines: a dish of
--   the menu, a preparation (200 mini-croissants) or free text, each with its own price (catering
--   prices are not the shop prices).
-- * quote -> confirmed -> delivered; cancelled at any time before invoicing.
-- * Deposits and the balance are noted as they come (cash, card, transfer, other).
-- * Confirmed orders feed the production plan of their event day (app.catering_needs).
-- * "Facturer": once fully paid, one server call creates a closed order (source 'catering') with the
--   catering lines and payments, through close_order: a numbered ticket, or an invoice with the
--   customer's ICE. The stock comes out as for any sale (preparations included). After that the
--   catering order is frozen.
-- =============================================================================

-- ------------------------------------------------------------ orders can come from catering
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('qr', 'pos', 'phone', 'glovo', 'catering'));

-- ------------------------------------------------------------ tables
create table if not exists public.catering_orders (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  number             integer not null,
  status             text not null default 'quote' check (status in ('quote', 'confirmed', 'delivered', 'cancelled')),
  customer_name      text not null check (length(btrim(customer_name)) between 1 and 80),
  customer_phone     text check (length(customer_phone) <= 30),
  company            text check (length(company) <= 80),
  ice                text check (ice ~ '^[0-9]{15}$'),
  event_date         date not null,
  event_time         time,
  mode               text not null default 'pickup' check (mode in ('pickup', 'delivery')),
  address            text check (length(address) <= 300),
  guests             integer check (guests between 1 and 100000),
  note               text check (length(note) <= 1000),
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents between 0 and 100000000),
  order_id           uuid,
  invoiced_at        timestamptz,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, id),
  unique (restaurant_id, number),
  foreign key (restaurant_id, order_id) references public.orders (restaurant_id, id)
);
create index if not exists catering_orders_day_idx on public.catering_orders (restaurant_id, event_date);

create table if not exists public.catering_lines (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  catering_id      uuid not null,
  menu_item_id     uuid,
  ingredient_id    uuid,
  name             text not null check (length(btrim(name)) between 1 and 120),
  unit_price_cents bigint not null check (unit_price_cents between 0 and 100000000),
  qty              integer not null check (qty between 1 and 100000),
  vat_bp           integer check (vat_bp between 0 and 10000),
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (restaurant_id, id),
  check (menu_item_id is null or ingredient_id is null),
  foreign key (restaurant_id, catering_id) references public.catering_orders (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, menu_item_id) references public.menu_items (restaurant_id, id) on delete set null (menu_item_id),
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete set null (ingredient_id)
);
create index if not exists catering_lines_idx on public.catering_lines (restaurant_id, catering_id, sort_order);

create table if not exists public.catering_payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  catering_id   uuid not null,
  kind          text not null default 'deposit' check (kind in ('deposit', 'balance')),
  method        text not null check (method in ('cash', 'card', 'transfer', 'other')),
  amount_cents  bigint not null check (amount_cents between 1 and 100000000),
  paid_on       date not null default current_date,
  note          text check (length(note) <= 200),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, catering_id) references public.catering_orders (restaurant_id, id) on delete cascade
);
create index if not exists catering_payments_idx on public.catering_payments (restaurant_id, catering_id);

-- ------------------------------------------------------------ rules
-- the number is given by the server; the link to the till order only by catering_invoice; an invoiced
-- order is frozen (lines, payments and the order itself)
create or replace function app.catering_orders_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.number := app.next_counter(new.restaurant_id, 'catering');
    if app.is_client() then new.order_id := null; new.invoiced_at := null; end if;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.order_id is not null and not app.purging() then
      raise exception 'catering invoiced' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.restaurant_id <> old.restaurant_id or new.number <> old.number then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if app.is_client() then
    if old.order_id is not null then raise exception 'catering invoiced' using errcode = '42501'; end if;
    new.order_id := old.order_id; new.invoiced_at := old.invoiced_at;
  end if;
  new.created_at := old.created_at; new.updated_at := now();
  return new;
end $$;
drop trigger if exists catering_orders_guard on public.catering_orders;
create trigger catering_orders_guard before insert or update or delete on public.catering_orders
  for each row execute function app.catering_orders_guard();

create or replace function app.catering_children_guard()
returns trigger language plpgsql set search_path = '' as $$
declare cid uuid; rid uuid;
begin
  rid := case when tg_op = 'DELETE' then old.restaurant_id else new.restaurant_id end;
  cid := case when tg_op = 'DELETE' then old.catering_id else new.catering_id end;
  if tg_op = 'UPDATE' and (new.restaurant_id <> old.restaurant_id or new.catering_id <> old.catering_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if app.is_client() and exists (select 1 from public.catering_orders c where c.restaurant_id = rid and c.id = cid and c.order_id is not null) then
    raise exception 'catering invoiced' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists catering_lines_guard on public.catering_lines;
create trigger catering_lines_guard before insert or update or delete on public.catering_lines
  for each row execute function app.catering_children_guard();
drop trigger if exists catering_payments_guard on public.catering_payments;
create trigger catering_payments_guard before insert or update or delete on public.catering_payments
  for each row execute function app.catering_children_guard();

-- ------------------------------------------------------------ access: managers
do $$
declare t text;
begin
  foreach t in array array['catering_orders', 'catering_lines', 'catering_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (restaurant_id = any ((select app.my_restaurants(''manager''))::uuid[]))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (restaurant_id = any ((select app.my_writable_restaurants(''manager''))::uuid[]))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (restaurant_id = any ((select app.my_writable_restaurants(''manager''))::uuid[])) with check (restaurant_id = any ((select app.my_writable_restaurants(''manager''))::uuid[]))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (restaurant_id = any ((select app.my_writable_restaurants(''manager''))::uuid[]))', t || '_delete', t);
    execute format('drop trigger if exists %I on public.%I', 'audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()', 'audit_' || t, t);
  end loop;
end $$;

-- ------------------------------------------------------------ what a sale uses: catering preparations too
-- A catering line can be a preparation (200 mini-croissants) rather than a dish: once invoiced it comes
-- out of the stock like a dish would (and a credit note puts it back).
create or replace function app.order_usage(p_restaurant_id uuid, p_order_id uuid)
returns table (ingredient_id uuid, qty numeric) language sql stable security definer set search_path = '' as $$
  with l as (
    select menu_item_id, variant_id, quantity, modifiers,
           coalesce((select o.order_type = 'dine_in' from public.orders o where o.restaurant_id = p_restaurant_id and o.id = p_order_id), true) din
      from public.order_lines
     where restaurant_id = p_restaurant_id and order_id = p_order_id and menu_item_id is not null),
  u as (
    select rl.ingredient_id, l.quantity * rl.qty q
      from l join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.menu_item_id = l.menu_item_id
                                         and (rl.variant_id is null or rl.variant_id = l.variant_id)
                                         and (not rl.dine_in_only or l.din)
    union all
    select rl.ingredient_id, l.quantity * rl.qty
      from l cross join lateral jsonb_array_elements(l.modifiers) m
      join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.modifier_option_id = app.try_uuid(m ->> 'id')
                                         and (not rl.dine_in_only or l.din)
    union all
    select cl.ingredient_id, cl.qty::numeric
      from public.catering_orders c
      join public.catering_lines cl on cl.restaurant_id = c.restaurant_id and cl.catering_id = c.id
     where c.restaurant_id = p_restaurant_id and c.order_id = p_order_id and cl.ingredient_id is not null)
  select x.ingredient_id, sum(x.qty / (1 - g.waste_bp / 10000.0))
    from u
    cross join lateral app.prep_tree(p_restaurant_id, u.ingredient_id, u.q, true) x
    join public.ingredients g on g.restaurant_id = p_restaurant_id and g.id = x.ingredient_id
   group by x.ingredient_id
$$;
revoke all on function app.order_usage(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ the production plan
-- what the confirmed catering orders of a day need, at every level (the plan keeps the made-ahead
-- preparations); an order already invoiced or delivered is no longer to make
create or replace function app.catering_needs(p_restaurant_id uuid, p_date date)
returns table (ingredient_id uuid, qty numeric) language sql stable set search_path = '' as $$
  with l as (
    select cl.menu_item_id, cl.ingredient_id, cl.qty
      from public.catering_orders c
      join public.catering_lines cl on cl.restaurant_id = c.restaurant_id and cl.catering_id = c.id
     where c.restaurant_id = p_restaurant_id and c.event_date = p_date and c.status = 'confirmed' and c.order_id is null),
  u as (
    select rl.ingredient_id, l.qty * rl.qty q
      from l join public.recipe_lines rl on rl.restaurant_id = p_restaurant_id and rl.menu_item_id = l.menu_item_id
                                         and rl.variant_id is null and rl.modifier_option_id is null
    union all
    select l.ingredient_id, l.qty::numeric from l where l.ingredient_id is not null)
  select x.ingredient_id, sum(x.qty)
    from u cross join lateral app.prep_tree(p_restaurant_id, u.ingredient_id, u.q, false) x
   group by x.ingredient_id
$$;

-- the daily average leaves catering sales out (they are planned separately, by their event date)
create or replace function public.production_plan(p_restaurant_id uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; dt date; items jsonb;
begin
  r := app.require_role(p_restaurant_id, 'manager', false);
  dt := coalesce(p_date, app.business_date(r));
  with
  sold as (
    select od.business_date d, l.menu_item_id, l.variant_id, od.order_type = 'dine_in' din, sum(l.quantity) qty
      from public.order_lines l
      join public.orders od on od.restaurant_id = l.restaurant_id and od.id = l.order_id
     where l.restaurant_id = r.id and od.closed_at is not null and od.status <> 'cancelled' and od.source <> 'catering'
       and l.menu_item_id is not null and od.business_date >= dt - 28 and od.business_date < dt
     group by 1, 2, 3, 4),
  use_by_day as (
    select s.d, x.ingredient_id, sum(x.qty) qty
      from sold s
      join public.recipe_lines rl on rl.restaurant_id = r.id and rl.menu_item_id = s.menu_item_id
                                 and (rl.variant_id is null or rl.variant_id = s.variant_id)
                                 and (not rl.dine_in_only or s.din)
      cross join lateral app.prep_tree(r.id, rl.ingredient_id, s.qty * rl.qty, false) x
     group by 1, 2),
  days as (select count(distinct d) n, count(distinct d) filter (where extract(isodow from d) = extract(isodow from dt)) nw from sold),
  avg_use as (
    select u.ingredient_id,
           case when (select nw from days) >= 2
                then sum(u.qty) filter (where extract(isodow from u.d) = extract(isodow from dt)) / (select nw from days)
                else sum(u.qty) / nullif((select n from days), 0) end daily
      from use_by_day u group by 1),
  cat as (select * from app.catering_needs(r.id, dt)),
  made as (
    select ingredient_id, sum(qty) qty from public.production_batches
     where restaurant_id = r.id and produced_on = dt and cancelled_at is null group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
      'ingredient_id', g.id, 'name', g.name, 'base_unit', g.base_unit, 'purchase_unit', g.purchase_unit, 'batch_qty', g.purchase_qty,
      'stock_qty', g.stock_qty, 'daily', round(coalesce(a.daily, 0), 3), 'made_today', coalesce(m.qty, 0),
      'catering', round(coalesce(c.qty, 0), 3),
      'suggested', greatest(0, round(coalesce(a.daily, 0) + coalesce(c.qty, 0) - greatest(coalesce(g.stock_qty, 0), 0), 3)),
      'cost_cents', g.purchase_price_cents
    ) order by g.name), '[]'::jsonb)
    into items
    from public.ingredients g
    left join avg_use a on a.ingredient_id = g.id
    left join cat c on c.ingredient_id = g.id
    left join made m on m.ingredient_id = g.id
   where g.restaurant_id = r.id and g.active and g.is_preparation and g.made_ahead;
  return jsonb_build_object('date', dt, 'items', items);
end $$;
revoke all on function public.production_plan(uuid, date) from public, anon;
grant execute on function public.production_plan(uuid, date) to authenticated;

-- ------------------------------------------------------------ invoicing
-- Fully paid: a closed till order with the catering lines and payments, through close_order (ticket,
-- or invoice with the ICE). Lines above 999 pieces are split (the till's limit per line).
create or replace function public.catering_invoice(p_id uuid, p_buyer jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.catering_orders; r public.restaurants; o public.orders; l record; p record;
  total bigint; paid bigint; left_qty integer; n integer; k integer := 0; d jsonb; buyer jsonb := p_buyer;
begin
  select * into c from public.catering_orders where id = p_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(c.restaurant_id, 'manager', true);
  if c.order_id is not null then perform app.fail('already_invoiced'); end if;
  if c.status in ('quote', 'cancelled') then perform app.fail('not_confirmed'); end if;
  if not exists (select 1 from public.catering_lines where restaurant_id = r.id and catering_id = c.id) then perform app.fail('order_empty'); end if;
  select coalesce(sum(unit_price_cents * qty), 0) + c.delivery_fee_cents into total
    from public.catering_lines where restaurant_id = r.id and catering_id = c.id;
  select coalesce(sum(amount_cents), 0) into paid from public.catering_payments where restaurant_id = r.id and catering_id = c.id;
  if paid <> total then perform app.fail('not_fully_paid', format('paid=%s total=%s', paid, total)); end if;
  if buyer is null and c.ice is not null then
    buyer := jsonb_strip_nulls(jsonb_build_object('name', coalesce(c.company, c.customer_name), 'ice', c.ice, 'address', c.address));
  end if;

  insert into public.orders (restaurant_id, client_id, source, order_type, status, customer_name, customer_phone, delivery_address, note)
  values (r.id, gen_random_uuid(), 'catering', case when c.mode = 'delivery' then 'delivery' else 'takeaway' end, 'served',
          left(coalesce(c.company, c.customer_name), 60), c.customer_phone, c.address, 'Traiteur CT-' || lpad(c.number::text, 4, '0'))
  returning * into o;

  perform set_config('app.copy_line', 'on', true);
  for l in select * from public.catering_lines where restaurant_id = r.id and catering_id = c.id order by sort_order, created_at loop
    left_qty := l.qty;
    while left_qty > 0 loop
      n := least(left_qty, 999);
      k := k + 1;   -- the ticket lists the lines in the order of the catering order
      insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, station, kitchen_sent_at, served_at, created_at)
      values (r.id, o.id, l.menu_item_id, left(l.name, 120), l.unit_price_cents, n,
              coalesce(l.vat_bp, (select m.vat_bp from public.menu_items m where m.restaurant_id = r.id and m.id = l.menu_item_id), r.default_vat_bp),
              'kitchen', now(), now(), now() + make_interval(secs => k / 1000.0));
      left_qty := left_qty - n;
    end loop;
  end loop;
  if c.delivery_fee_cents > 0 then
    insert into public.order_lines (restaurant_id, order_id, name, unit_price_cents, quantity, vat_bp, station, kitchen_sent_at, served_at, created_at)
    values (r.id, o.id, 'Livraison', c.delivery_fee_cents, 1, r.default_vat_bp, 'kitchen', now(), now(), now() + make_interval(secs => (k + 1) / 1000.0));
  end if;
  perform set_config('app.copy_line', 'off', true);

  for p in select method, sum(amount_cents) amt from public.catering_payments where restaurant_id = r.id and catering_id = c.id group by method loop
    insert into public.payments (restaurant_id, order_id, method, amount_cents) values (r.id, o.id, p.method, p.amt);
  end loop;
  -- linked before closing: the ticket's stock trigger also takes the catering preparations out
  update public.catering_orders set order_id = o.id, invoiced_at = now(), status = 'delivered' where id = c.id;
  d := public.close_order(o.id, null, buyer);
  return jsonb_build_object('ok', true, 'order_id', o.id, 'document', d);
end $$;
revoke all on function public.catering_invoice(uuid, jsonb) from public, anon;
grant execute on function public.catering_invoice(uuid, jsonb) to authenticated;
