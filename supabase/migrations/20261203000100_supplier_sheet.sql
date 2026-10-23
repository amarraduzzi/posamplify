-- The supplier sheet: everything about one supplier in one place.
--   * suppliers: address, city, the Moroccan identifiers the accountant needs (ICE 15 digits, IF, RC), the RIB
--     (24 digits), the usual way of paying and the minimum order.
--   * supplier_products: which products a supplier delivers, with HIS reference, his packaging (text, for the
--     order), the agreed price per purchase unit of the product, and whether he is the usual supplier of it.
--     A product can come from several suppliers; one is the usual one (ingredients.supplier_id follows it, so
--     everything that already reads ingredients.supplier_id keeps working). The links of before become usual
--     suppliers.
--   * a purchase order line gets the agreed price of its supplier when it comes with no price or with the
--     product's general price (orders made from the forecast, from the production plan, or by hand).
set lock_timeout = '10s';

alter table public.suppliers
  add column if not exists address text check (length(address) <= 200),
  add column if not exists city text check (length(city) <= 60),
  add column if not exists ice text check (ice ~ '^[0-9]{15}$'),
  add column if not exists if_number text check (if_number ~ '^[0-9]{1,12}$'),
  add column if not exists rc text check (length(rc) <= 30),
  add column if not exists rib text check (rib ~ '^[0-9]{24}$'),
  add column if not exists pay_method text check (pay_method in ('cash', 'transfer', 'check', 'card')),
  add column if not exists min_order_cents bigint check (min_order_cents between 0 and 10000000000);

create table if not exists public.supplier_products (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  supplier_id    uuid not null,
  ingredient_id  uuid not null,
  ref            text check (length(ref) <= 40),
  pack_label     text check (length(pack_label) <= 40),
  price_cents    bigint check (price_cents between 0 and 10000000000),   -- per purchase unit of the product
  is_main        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (supplier_id, ingredient_id),
  foreign key (restaurant_id, supplier_id) references public.suppliers (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, ingredient_id) references public.ingredients (restaurant_id, id) on delete cascade
);
create unique index if not exists supplier_products_main_idx on public.supplier_products (ingredient_id) where is_main;
create index if not exists supplier_products_ing_idx on public.supplier_products (restaurant_id, ingredient_id);

alter table public.supplier_products enable row level security;
grant select, insert, update, delete on public.supplier_products to authenticated;
drop policy if exists supplier_products_select on public.supplier_products;
drop policy if exists supplier_products_write on public.supplier_products;
create policy supplier_products_select on public.supplier_products for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy supplier_products_write on public.supplier_products for all to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop trigger if exists supplier_products_touch on public.supplier_products;
create trigger supplier_products_touch before update on public.supplier_products
  for each row execute function app.touch_updated_at();
drop trigger if exists supplier_products_same_tenant on public.supplier_products;
create trigger supplier_products_same_tenant before update on public.supplier_products
  for each row execute function app.forbid_restaurant_change();

-- ------------------------------------------------------------ the usual supplier, both ways
-- a link marked usual: the other links of that product are no longer usual, and the product follows
create or replace function app.supplier_products_main()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ing uuid; main uuid;
begin
  if current_setting('app.sp_sync', true) = '1' then return null; end if;
  perform set_config('app.sp_sync', '1', true);
  for ing in select distinct x from unnest(array[case when tg_op <> 'DELETE' then new.ingredient_id end, case when tg_op <> 'INSERT' then old.ingredient_id end]) x where x is not null loop
    select supplier_id into main from public.supplier_products where ingredient_id = ing and is_main;
    update public.ingredients set supplier_id = main where id = ing and supplier_id is distinct from main;
  end loop;
  perform set_config('app.sp_sync', '', true);
  return null;
end $$;
-- before the row is written: only one usual supplier per product
create or replace function app.supplier_products_one_main()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_main and (tg_op = 'INSERT' or not old.is_main or old.ingredient_id <> new.ingredient_id) then
    perform set_config('app.sp_sync', '1', true);
    update public.supplier_products set is_main = false where ingredient_id = new.ingredient_id and id <> new.id and is_main;
    perform set_config('app.sp_sync', '', true);
  end if;
  return new;
end $$;
drop trigger if exists supplier_products_one_main on public.supplier_products;
create trigger supplier_products_one_main before insert or update of is_main, ingredient_id on public.supplier_products
  for each row execute function app.supplier_products_one_main();

drop trigger if exists supplier_products_main on public.supplier_products;
create trigger supplier_products_main after insert or update of is_main, ingredient_id or delete on public.supplier_products
  for each row execute function app.supplier_products_main();

-- the supplier chosen on the product sheet (or by an import) becomes the usual one, linked if needed
create or replace function app.ingredients_supplier_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('app.sp_sync', true) = '1' then return null; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then return null; end if;
  perform set_config('app.sp_sync', '1', true);
  update public.supplier_products set is_main = false where ingredient_id = new.id and is_main and supplier_id is distinct from new.supplier_id;
  if new.supplier_id is not null then
    insert into public.supplier_products (restaurant_id, supplier_id, ingredient_id, is_main)
    values (new.restaurant_id, new.supplier_id, new.id, true)
    on conflict (supplier_id, ingredient_id) do update set is_main = true;
  end if;
  perform set_config('app.sp_sync', '', true);
  return null;
end $$;
drop trigger if exists ingredients_supplier_link on public.ingredients;
create trigger ingredients_supplier_link after insert or update of supplier_id on public.ingredients
  for each row execute function app.ingredients_supplier_link();

-- the links of before
insert into public.supplier_products (restaurant_id, supplier_id, ingredient_id, is_main)
select g.restaurant_id, g.supplier_id, g.id, true from public.ingredients g where g.supplier_id is not null
on conflict (supplier_id, ingredient_id) do nothing;

-- ------------------------------------------------------------ the agreed price on an order line
create or replace function app.po_line_agreed_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare agreed bigint; general bigint;
begin
  select sp.price_cents into agreed
    from public.purchase_orders o
    join public.supplier_products sp on sp.supplier_id = o.supplier_id and sp.ingredient_id = new.ingredient_id
   where o.id = new.order_id and sp.price_cents is not null;
  if agreed is null then return new; end if;
  select purchase_price_cents into general from public.ingredients where id = new.ingredient_id;
  if new.unit_price_cents is null or new.unit_price_cents is not distinct from general then new.unit_price_cents := agreed; end if;
  return new;
end $$;
drop trigger if exists po_line_agreed_price on public.purchase_order_lines;
create trigger po_line_agreed_price before insert on public.purchase_order_lines
  for each row execute function app.po_line_agreed_price();

notify pgrst, 'reload schema';
