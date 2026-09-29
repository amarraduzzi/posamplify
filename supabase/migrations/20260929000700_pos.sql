-- =============================================================================
-- 0007 TILL (POS) SUPPORT
-- =============================================================================
-- New in this migration:
--   * restaurants.pos_settings: printer names, idle lock, receipt footer
--   * pos_merge_orders(): one running bill per table (QR orders join it)
--   * pos_pay_order(): payments + closing + fiscal ticket in ONE transaction
--   * get_order_status() follows merged orders, so the guest keeps tracking
-- Earlier migrations are already live and are never edited: changes to
-- existing functions are made here with CREATE OR REPLACE.
-- =============================================================================

-- {"printers": {"receipt": "TICKET", "stations": {"bar": "BAR", "kitchen": "CUISINE"}},
--  "idle_lock_minutes": 10, "receipt_footer": "Merci de votre visite"}
alter table public.restaurants
  add column pos_settings jsonb not null default '{}'::jsonb
  check (jsonb_typeof(pos_settings) = 'object');
grant update (pos_settings) on public.restaurants to authenticated;

-- Where a merged order went (guest tracking keeps working after a merge).
create table app.order_redirects (
  from_order_id uuid primary key,
  to_order_id   uuid not null,
  created_at    timestamptz not null default now()
);
alter table app.order_redirects enable row level security;
revoke all on app.order_redirects from public, anon, authenticated;

-- Lines may now be moved between open orders by server functions.
create or replace function app.order_lines_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  it public.menu_items;
  v  public.item_variants;
  c  public.categories;
  r  public.restaurants;
  lang text;
begin
  if tg_op = 'DELETE' then
    if app.purging() then
      return old;
    end if;
    if app.is_client() then
      perform app.assert_order_open(old.restaurant_id, old.order_id);
    else
      -- server functions and cascades: only block when the order still exists and is closed
      perform 1 from public.orders o
       where o.restaurant_id = old.restaurant_id and o.id = old.order_id and o.closed_at is not null;
      if found then
        raise exception 'order is closed' using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  perform app.assert_order_open(new.restaurant_id, new.order_id);

  if tg_op = 'UPDATE' then
    -- server functions (pos_merge_orders) may move a line to another open
    -- order of the same restaurant; clients never can
    if new.order_id <> old.order_id and app.is_client() then
      raise exception 'only quantity, note, station and kitchen status can change on a line'
        using errcode = '42501';
    end if;
    if new.order_id <> old.order_id then
      perform app.assert_order_open(old.restaurant_id, old.order_id);
    end if;
    if new.restaurant_id <> old.restaurant_id
       or new.menu_item_id is distinct from old.menu_item_id
       or new.variant_id is distinct from old.variant_id
       or new.unit_price_cents <> old.unit_price_cents
       or new.name <> old.name or new.vat_bp <> old.vat_bp
       or new.created_at <> old.created_at then
      raise exception 'only quantity, note, station and kitchen status can change on a line'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT
  select * into r from public.restaurants where id = new.restaurant_id;
  lang := r.languages[1];
  if new.menu_item_id is not null then
    select * into it from public.menu_items
     where restaurant_id = new.restaurant_id and id = new.menu_item_id;
    select * into c from public.categories
     where restaurant_id = new.restaurant_id and id = it.category_id;
    new.name := coalesce(it.name ->> lang, it.name ->> 'fr', (select value #>> '{}' from jsonb_each(it.name) limit 1), 'Article');
    new.unit_price_cents := it.price_cents;
    new.vat_bp := coalesce(it.vat_bp, r.default_vat_bp);
    new.station := coalesce(it.station, c.station, 'kitchen');
    if new.variant_id is not null then
      select * into v from public.item_variants
       where restaurant_id = new.restaurant_id and id = new.variant_id and menu_item_id = it.id;
      if v.id is null then
        raise exception 'variant does not belong to item' using errcode = '23503';
      end if;
      new.name := new.name || ' (' || coalesce(v.name ->> lang, v.name ->> 'fr', '') || ')';
      new.unit_price_cents := v.price_cents;
    end if;
  else
    if new.variant_id is not null then
      raise exception 'variant without item' using errcode = '23503';
    end if;
    if new.vat_bp is null then
      new.vat_bp := r.default_vat_bp;
    end if;
  end if;
  if app.is_client() then
    new.created_at := now();
    new.kitchen_sent_at := null;
  end if;
  return new;
end $$;

-- After a line moves, both the old and the new order recompute their totals.
create or replace function app.order_lines_after_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.orders set updated_at = now()
     where restaurant_id = old.restaurant_id and id = old.order_id and closed_at is null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.order_id <> old.order_id) then
    update public.orders set updated_at = now()
     where restaurant_id = new.restaurant_id and id = new.order_id and closed_at is null;
  end if;
  return null;
end $$;

-- Merge open orders into one (e.g. a QR order joins the table's running bill).
-- Sources must be open and unpaid; they are removed after their lines move.
create or replace function public.pos_merge_orders(p_target uuid, p_sources uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.orders;
  s public.orders;
  sid uuid;
begin
  select * into t from public.orders where id = p_target for update;
  if t.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(t.restaurant_id, 'device', true);
  if t.closed_at is not null or t.status = 'cancelled' then perform app.fail('order_not_open'); end if;

  foreach sid in array coalesce(p_sources, '{}') loop
    continue when sid = t.id;
    select * into s from public.orders where id = sid and restaurant_id = t.restaurant_id for update;
    if s.id is null then perform app.fail('not_found'); end if;
    if s.closed_at is not null or s.status = 'cancelled' then perform app.fail('order_not_open'); end if;
    if exists (select 1 from public.payments where restaurant_id = s.restaurant_id and order_id = s.id) then
      perform app.fail('remove_payments_first');
    end if;
    update public.order_lines set order_id = t.id
     where restaurant_id = t.restaurant_id and order_id = s.id;
    update public.orders
       set note = nullif(concat_ws(' / ', t.note, s.note), ''),
           table_id = coalesce(t.table_id, s.table_id),
           customer_name = coalesce(t.customer_name, s.customer_name),
           customer_phone = coalesce(t.customer_phone, s.customer_phone)
     where id = t.id
    returning * into t;
    insert into app.order_redirects (from_order_id, to_order_id) values (s.id, t.id)
    on conflict (from_order_id) do update set to_order_id = excluded.to_order_id;
    update app.order_redirects set to_order_id = t.id where to_order_id = s.id;
    delete from public.orders where id = s.id;
  end loop;

  select * into t from public.orders where id = t.id;
  return jsonb_build_object('order_id', t.id, 'ticket_number', t.ticket_number,
                            'subtotal_cents', t.subtotal_cents, 'total_cents', t.total_cents);
end $$;

-- Pay and close in one go: add the payments, then issue the fiscal ticket.
-- p_payments = [{"method": "cash", "amount_cents": 15000, "tip_cents": 1000}, ...]
-- amount_cents excludes the tip; together the amounts must equal the total.
create or replace function public.pos_pay_order(
  p_order_id uuid, p_payments jsonb, p_staff_id uuid default null, p_buyer jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  p jsonb;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_already_closed'); end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) not between 1 and 20 then
    perform app.fail('invalid_request', 'payments');
  end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff where restaurant_id = o.restaurant_id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  for p in select * from jsonb_array_elements(p_payments) loop
    if (p ->> 'method') not in ('cash', 'card', 'transfer', 'other')
       or (p ->> 'amount_cents') !~ '^[0-9]{1,12}$' or (p ->> 'amount_cents')::bigint <= 0
       or coalesce(p ->> 'tip_cents', '0') !~ '^[0-9]{1,12}$' then
      perform app.fail('invalid_request', 'payment');
    end if;
    insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents, staff_id)
    values (o.restaurant_id, o.id, p ->> 'method', (p ->> 'amount_cents')::bigint,
            coalesce((p ->> 'tip_cents')::bigint, 0), coalesce(p_staff_id, o.staff_id));
  end loop;
  return public.close_order(o.id, p_staff_id, p_buyer);
end $$;

-- Guest tracking follows merged orders.
create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', o.status, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'created_at', o.created_at)
  from public.orders o
  where o.id = coalesce((select to_order_id from app.order_redirects where from_order_id = p_order_id), p_order_id)
    and o.created_at > now() - interval '24 hours'
    and (o.source = 'qr' or exists (select 1 from app.order_redirects r where r.from_order_id = p_order_id))
$$;

revoke all on function public.pos_merge_orders(uuid, uuid[]) from public, anon;
revoke all on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.pos_merge_orders(uuid, uuid[]) to authenticated;
grant execute on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) to authenticated;
revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_order_status(uuid) to anon, authenticated;

-- Realtime: the kitchen and till also follow payments closing orders.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders, public.order_lines;
  end if;
end $$;
