-- =============================================================================
-- AMPLIFY AGENDA (11): the salon's products and their stock
--
-- Two kinds of product: for sale (shampoo, masks: sold at the till, on the ticket) and for the
-- salon's own use (colour tubes, oxidant, foil: only in the stock). Each product keeps its stock in
-- pieces; every change is a line in the stock moves (sale, cancelled sale, delivery, correction), so
-- the stock always has an explanation. A sale at the till takes the pieces off by itself; a
-- cancelled ticket puts them back. Below the alert level the salon sees it.
-- =============================================================================

create table if not exists public.agenda_products (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 80),
  category       text check (length(category) <= 40),
  kind           text not null default 'retail' check (kind in ('retail', 'usage')),
  price_cents    bigint check (price_cents between 0 and 10000000),
  cost_cents     bigint check (cost_cents between 0 and 10000000),
  stock          integer not null default 0 check (stock between -100000 and 1000000),
  min_stock      integer check (min_stock between 0 and 100000),
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (restaurant_id, id),
  check (kind = 'usage' or price_cents is not null)
);
create index if not exists agenda_products_idx on public.agenda_products (restaurant_id, active, sort_order);

create table if not exists public.agenda_stock_moves (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  product_id     uuid not null,
  kind           text not null check (kind in ('sale', 'cancel', 'delivery', 'correction', 'start')),
  qty            integer not null check (qty <> 0 and qty between -100000 and 100000),
  unit_cost_cents bigint check (unit_cost_cents between 0 and 10000000),
  sale_id        uuid,
  note           text check (length(note) <= 200),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  foreign key (restaurant_id, product_id) references public.agenda_products (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, sale_id) references public.agenda_sales (restaurant_id, id) on delete set null (sale_id)
);
create index if not exists agenda_stock_moves_idx on public.agenda_stock_moves (restaurant_id, product_id, created_at desc);

alter table public.agenda_sale_lines add column if not exists product_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'agenda_sale_lines_product_fk') then
    alter table public.agenda_sale_lines add constraint agenda_sale_lines_product_fk foreign key (restaurant_id, product_id)
      references public.agenda_products (restaurant_id, id) on delete set null (product_id);
  end if;
end $$;

drop trigger if exists agenda_products_same_tenant on public.agenda_products;
create trigger agenda_products_same_tenant before update on public.agenda_products for each row execute function app.forbid_restaurant_change();
drop trigger if exists agenda_stock_moves_same_tenant on public.agenda_stock_moves;
create trigger agenda_stock_moves_same_tenant before update on public.agenda_stock_moves for each row execute function app.forbid_restaurant_change();

-- the catalogue: the till sees it (the products for sale), the owner and managers change it.
-- The stock itself is only changed by the moves below, never by hand.
alter table public.agenda_products enable row level security;
revoke all on public.agenda_products from anon, authenticated;
grant select on public.agenda_products to authenticated;
grant insert (restaurant_id, name, category, kind, price_cents, cost_cents, min_stock, active, sort_order) on public.agenda_products to authenticated;
grant update (name, category, kind, price_cents, cost_cents, min_stock, active, sort_order) on public.agenda_products to authenticated;
grant delete on public.agenda_products to authenticated;
drop policy if exists agenda_products_select on public.agenda_products;
create policy agenda_products_select on public.agenda_products for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
drop policy if exists agenda_products_write on public.agenda_products;
create policy agenda_products_write on public.agenda_products for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop policy if exists agenda_products_update on public.agenda_products;
create policy agenda_products_update on public.agenda_products for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop policy if exists agenda_products_delete on public.agenda_products;
create policy agenda_products_delete on public.agenda_products for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[])
         and not exists (select 1 from public.agenda_stock_moves m where m.product_id = agenda_products.id and m.kind in ('sale', 'cancel')));

alter table public.agenda_stock_moves enable row level security;
revoke all on public.agenda_stock_moves from anon, authenticated;
grant select on public.agenda_stock_moves to authenticated;
drop policy if exists agenda_stock_moves_select on public.agenda_stock_moves;
create policy agenda_stock_moves_select on public.agenda_stock_moves for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- every move changes the stock
create or replace function app.agenda_stock_move()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.agenda_products set stock = greatest(-100000, least(1000000, stock + new.qty)) where id = new.product_id;
  return new;
end $$;
drop trigger if exists agenda_stock_moves_apply on public.agenda_stock_moves;
create trigger agenda_stock_moves_apply after insert on public.agenda_stock_moves for each row execute function app.agenda_stock_move();

-- a product sold at the till leaves the stock
create or replace function app.agenda_sale_line_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.product_id is not null then
    insert into public.agenda_stock_moves (restaurant_id, product_id, kind, qty, sale_id)
    values (new.restaurant_id, new.product_id, 'sale', -new.quantity, new.sale_id);
  end if;
  return new;
end $$;
drop trigger if exists agenda_sale_lines_stock on public.agenda_sale_lines;
create trigger agenda_sale_lines_stock after insert on public.agenda_sale_lines for each row execute function app.agenda_sale_line_stock();

-- a cancelled ticket puts its products back
create or replace function app.agenda_sale_cancel_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null then
    insert into public.agenda_stock_moves (restaurant_id, product_id, kind, qty, sale_id)
    select l.restaurant_id, l.product_id, 'cancel', l.quantity, l.sale_id
      from public.agenda_sale_lines l where l.sale_id = new.id and l.product_id is not null;
  end if;
  return new;
end $$;
drop trigger if exists agenda_sales_cancel_stock on public.agenda_sales;
create trigger agenda_sales_cancel_stock after update of cancelled_at on public.agenda_sales for each row execute function app.agenda_sale_cancel_stock();

-- a delivery (+), a correction (+/-) or the starting stock of a new product: owner and managers.
-- A delivery with its unit price also updates the purchase price of the product.
create or replace function public.agenda_stock_add(p_restaurant_id uuid, p_product uuid, p_kind text, p_qty integer, p_unit_cost_cents bigint default null, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare r public.restaurants; pr public.agenda_products;
begin
  r := app.require_role(p_restaurant_id, 'manager', true);
  select * into pr from public.agenda_products where id = p_product and restaurant_id = r.id for update;
  if pr.id is null then perform app.fail('not_found'); end if;
  if p_kind not in ('delivery', 'correction', 'start') or p_qty is null or p_qty = 0 or abs(p_qty) > 100000 then perform app.fail('invalid_request', 'qty'); end if;
  if p_kind = 'delivery' and p_qty < 0 then perform app.fail('invalid_request', 'qty'); end if;
  if p_kind = 'correction' and coalesce(btrim(p_note), '') = '' then perform app.fail('reason_required'); end if;
  if p_unit_cost_cents is not null and p_unit_cost_cents not between 0 and 10000000 then perform app.fail('invalid_request', 'cost'); end if;
  insert into public.agenda_stock_moves (restaurant_id, product_id, kind, qty, unit_cost_cents, note)
  values (r.id, pr.id, p_kind, p_qty, p_unit_cost_cents, nullif(left(btrim(p_note), 200), ''));
  if p_kind = 'delivery' and p_unit_cost_cents is not null then
    update public.agenda_products set cost_cents = p_unit_cost_cents where id = pr.id;
  end if;
  return jsonb_build_object('stock', (select stock from public.agenda_products where id = pr.id));
end $$;
revoke all on function public.agenda_stock_add(uuid, uuid, text, integer, bigint, text) from public, anon;
grant execute on function public.agenda_stock_add(uuid, uuid, text, integer, bigint, text) to authenticated;

-- the till takes products: the checkout knows product lines
create or replace function public.agenda_checkout(p_restaurant_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.restaurants; d date; a public.agenda_appointments; q public.agenda_queue; l jsonb; v public.agenda_services;
  sid uuid; num int; sub bigint := 0; disc bigint; tot bigint; tip bigint; cash bigint; card bigint;
  ph text; nm text; who uuid; cust uuid; i int := 0; ln_staff uuid; ln_name text; ln_qty int; ln_unit bigint; ln_kind text; pr public.agenda_products;
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
    -- a product of the catalogue: only one for sale, of this salon
    if nullif(l ->> 'product_id', '') is not null and not exists (select 1 from public.agenda_products where id = (l ->> 'product_id')::uuid and restaurant_id = r.id and kind = 'retail') then
      perform app.fail('invalid_request', 'product');
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
    ln_kind := coalesce(l ->> 'kind', 'service'); v := null; pr := null;
    if nullif(l ->> 'service_id', '') is not null then select * into v from public.agenda_services where id = (l ->> 'service_id')::uuid; end if;
    if nullif(l ->> 'product_id', '') is not null then select * into pr from public.agenda_products where id = (l ->> 'product_id')::uuid; ln_kind := 'product'; end if;
    ln_name := coalesce(nullif(btrim(l ->> 'name'), ''), pr.name, v.name ->> 'fr', v.name ->> 'ar', v.name ->> 'en', 'Prestation');
    ln_staff := coalesce(nullif(l ->> 'staff_id', '')::uuid, case when ln_kind = 'service' then who end);
    insert into public.agenda_sale_lines (restaurant_id, sale_id, kind, service_id, product_id, name, quantity, unit_cents, staff_id, sort)
    values (r.id, sid, ln_kind, v.id, pr.id, left(ln_name, 80), coalesce((l ->> 'quantity')::int, 1), (l ->> 'unit_cents')::bigint, ln_staff, i);
    i := i + 1;
  end loop;

  return jsonb_build_object('id', sid, 'number', num, 'business_date', d, 'total_cents', tot, 'tip_cents', tip,
                            'cash_cents', cash, 'card_cents', card, 'name', nm, 'phone', ph);
end $$;
revoke all on function public.agenda_checkout(uuid, jsonb) from public, anon;
grant execute on function public.agenda_checkout(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
