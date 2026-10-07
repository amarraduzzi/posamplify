-- =============================================================================
-- 0036 PROMOTIONS AND MENUS BY TIME
-- =============================================================================
-- happy_hour  a percentage off chosen dishes or categories, on chosen days and
--             hours (and dates): applied by the database to every line, at the
--             till and online, the ticket shows the reduced price
-- code        a promo code (percentage or amount off the order), at the till or
--             online, with a minimum order, a number of uses, once per phone
-- Categories can have a schedule (days, hours, dates): breakfast in the
-- morning, a "Ftour" menu at sunset during Ramadan. Outside it they are hidden
-- online and cannot be ordered.
-- =============================================================================

create table if not exists public.promotions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind          text not null check (kind in ('happy_hour', 'code')),
  name          text not null check (length(btrim(name)) between 1 and 60),
  active        boolean not null default true,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'amount')),
  value         bigint not null check (value > 0),              -- percent: basis points (2000 = 20 %); amount: centimes
  category_ids  uuid[] not null default '{}',                   -- happy hour: these categories ...
  item_ids      uuid[] not null default '{}',                   -- ... and these dishes (both empty = the whole menu)
  days          int[] not null default '{1,2,3,4,5,6,7}' check (days <@ array[1,2,3,4,5,6,7]),
  start_time    time,                                           -- local time; null = all day
  end_time      time,
  starts_on     date,
  ends_on       date,
  code          text check (code is null or code ~ '^[A-Z0-9_-]{3,20}$'),
  min_order_cents bigint not null default 0 check (min_order_cents >= 0),
  max_uses      integer check (max_uses is null or max_uses > 0),
  once_per_phone boolean not null default false,
  channels      text[] not null default '{pos,online}' check (channels <@ array['pos', 'online']),
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  check ((kind = 'code') = (code is not null)),
  check (discount_type = 'percent' and value <= 10000 or discount_type = 'amount' and kind = 'code')
);
create unique index if not exists promotions_code_idx on public.promotions (restaurant_id, code) where code is not null;

alter table public.order_lines
  add column if not exists promo_id uuid,
  add column if not exists list_price_cents bigint;
alter table public.orders add column if not exists promo_id uuid;
alter table public.orders drop constraint if exists orders_discount_kind_check;
alter table public.orders add constraint orders_discount_kind_check check (discount_kind in ('loyalty', 'promo'));
alter table public.categories
  add column if not exists schedule jsonb check (schedule is null or jsonb_typeof(schedule) = 'object');

alter table public.promotions enable row level security;
grant select, insert, update, delete on public.promotions to authenticated;
drop policy if exists promotions_select on public.promotions;
drop policy if exists promotions_insert on public.promotions;
drop policy if exists promotions_update on public.promotions;
drop policy if exists promotions_delete on public.promotions;
create policy promotions_select on public.promotions for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
create policy promotions_insert on public.promotions for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy promotions_update on public.promotions for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy promotions_delete on public.promotions for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
drop trigger if exists audit_promotions on public.promotions;
create trigger audit_promotions after insert or update or delete on public.promotions
  for each row execute function app.audit();

-- ------------------------------------------------------------ time rules
-- days 1 = Monday ... 7 = Sunday; a time range past midnight runs into the next day
create or replace function app.in_window(days int[], t1 time, t2 time, d1 date, d2 date, tz text, at_time timestamptz)
returns boolean language plpgsql immutable set search_path = '' as $$
declare loc timestamp := at_time at time zone tz; t time := loc::time; dow int := extract(isodow from loc)::int; day date := loc::date;
begin
  if t1 is null or t2 is null or t1 = t2 then
    return dow = any (days) and (d1 is null or day >= d1) and (d2 is null or day <= d2);
  end if;
  if t1 < t2 then
    return t >= t1 and t < t2 and dow = any (days) and (d1 is null or day >= d1) and (d2 is null or day <= d2);
  end if;
  -- past midnight: from t1 today, or until t2 counted on the day before
  if t >= t1 then return dow = any (days) and (d1 is null or day >= d1) and (d2 is null or day <= d2); end if;
  if t < t2 then
    return ((dow + 5) % 7 + 1) = any (days) and (d1 is null or day - 1 >= d1) and (d2 is null or day - 1 <= d2);
  end if;
  return false;
end $$;

create or replace function app.promo_live(p public.promotions, r public.restaurants, at_time timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p.active and app.in_window(p.days, p.start_time, p.end_time, p.starts_on, p.ends_on, r.timezone, at_time)
$$;

-- the best happy hour for a dish right now (its id and its percentage)
create or replace function app.happy_hour_for(r public.restaurants, it public.menu_items, at_time timestamptz)
returns table (id uuid, value bigint) language sql stable security definer set search_path = '' as $$
  select p.id, p.value from public.promotions p
   where p.restaurant_id = r.id and p.kind = 'happy_hour' and app.promo_live(p, r, at_time)
     and ((cardinality(p.category_ids) = 0 and cardinality(p.item_ids) = 0)
          or it.category_id = any (p.category_ids) or it.id = any (p.item_ids))
   order by p.value desc limit 1
$$;

-- categories with a schedule: {"days":[1..7], "from":"HH:MM", "to":"HH:MM", "start_on":"YYYY-MM-DD", "end_on":"YYYY-MM-DD"}
create or replace function app.category_open(c public.categories, r public.restaurants, at_time timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select c.schedule is null or c.schedule = '{}'::jsonb or app.in_window(
    coalesce((select array_agg(x::int) from jsonb_array_elements_text(c.schedule -> 'days') x), '{1,2,3,4,5,6,7}'),
    nullif(c.schedule ->> 'from', '')::time, nullif(c.schedule ->> 'to', '')::time,
    nullif(c.schedule ->> 'start_on', '')::date, nullif(c.schedule ->> 'end_on', '')::date, r.timezone, at_time)
$$;

-- ------------------------------------------------------------ promo codes
-- Checks a code for an open order and sets the discount (replaces a manual one).
create or replace function app.apply_promo_code(p_order_id uuid, p_code text, p_channel text)
returns public.orders language plpgsql security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; p public.promotions; used int; d bigint;
begin
  select * into o from public.orders where id = p_order_id for update;
  select * into r from public.restaurants where id = o.restaurant_id;
  select * into p from public.promotions where restaurant_id = r.id and code = upper(btrim(p_code)) and kind = 'code';
  if p.id is null or not app.promo_live(p, r, now()) or not (p_channel = any (p.channels)) then perform app.fail('promo_invalid'); end if;
  if o.discount_kind = 'loyalty' then perform app.fail('remove_discount_first'); end if;
  if o.subtotal_cents < p.min_order_cents then perform app.fail('promo_minimum', p.min_order_cents::text); end if;
  select count(*) into used from public.orders where restaurant_id = r.id and promo_id = p.id and status <> 'cancelled' and id <> o.id;
  if p.max_uses is not null and used >= p.max_uses then perform app.fail('promo_used_up'); end if;
  if p.once_per_phone then
    if o.customer_phone is null then perform app.fail('promo_phone_required'); end if;
    if exists (select 1 from public.orders where restaurant_id = r.id and promo_id = p.id and status <> 'cancelled' and id <> o.id
                 and app.norm_phone(customer_phone) = app.norm_phone(o.customer_phone)) then
      perform app.fail('promo_already_used');
    end if;
  end if;
  d := case when p.discount_type = 'percent' then round(o.subtotal_cents * p.value / 10000.0)::bigint else least(p.value, o.subtotal_cents) end;
  update public.orders set promo_id = p.id, discount_kind = 'promo', discount_cents = d, discount_by_staff_id = null where id = o.id
  returning * into o;
  return o;
end $$;
revoke all on function app.apply_promo_code(uuid, text, text) from public, anon, authenticated;

-- a percentage code follows the order when dishes are added or removed (in the totals trigger)
drop trigger if exists orders_a_promo_follow on public.orders;
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

  -- a closed order is frozen, except the kitchen can still mark it served
  if old.closed_at is not null then
    if (to_jsonb(new) - '{status,updated_at}'::text[]) <> (to_jsonb(old) - '{status,updated_at}'::text[])
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

-- the till types a code
create or replace function public.pos_apply_promo(p_order_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  o := app.apply_promo_code(o.id, p_code, 'pos');
  return jsonb_build_object('ok', true, 'discount_cents', o.discount_cents, 'total_cents', o.total_cents);
end $$;
-- and can take it off again
create or replace function public.pos_remove_promo(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_not_open'); end if;
  if o.discount_kind = 'promo' then
    update public.orders set promo_id = null, discount_kind = null, discount_cents = 0 where id = o.id returning * into o;
  end if;
  return jsonb_build_object('ok', true, 'total_cents', o.total_cents);
end $$;

-- guests check a code before ordering (shows the discount in the basket)
create or replace function public.check_promo_code(p_slug text, p_code text, p_subtotal_cents bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; p public.promotions;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  select * into p from public.promotions where restaurant_id = r.id and code = upper(btrim(p_code)) and kind = 'code';
  if r.id is null or p.id is null or not app.promo_live(p, r, now()) or not ('online' = any (p.channels)) then perform app.fail('promo_invalid'); end if;
  if coalesce(p_subtotal_cents, 0) < p.min_order_cents then perform app.fail('promo_minimum', p.min_order_cents::text); end if;
  return jsonb_build_object('code', p.code, 'name', p.name, 'discount_type', p.discount_type, 'value', p.value, 'min_order_cents', p.min_order_cents);
end $$;

-- how much each promotion gave away and brought in (managers)
create or replace function public.promo_report(p_restaurant_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id, p.name, p.kind,
           (select count(distinct l.order_id) from public.order_lines l join public.orders o on o.id = l.order_id
             where l.restaurant_id = p.restaurant_id and l.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to)
         + (select count(*) from public.orders o where o.restaurant_id = p.restaurant_id and o.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to) orders,
           (select coalesce(sum((l.list_price_cents - l.unit_price_cents) * l.quantity), 0) from public.order_lines l join public.orders o on o.id = l.order_id
             where l.restaurant_id = p.restaurant_id and l.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to)
         + (select coalesce(sum(o.discount_cents), 0) from public.orders o where o.restaurant_id = p.restaurant_id and o.promo_id = p.id and o.closed_at is not null and o.business_date between p_from and p_to) given_cents,
           (select coalesce(sum(o.total_cents), 0) from public.orders o where o.restaurant_id = p.restaurant_id and o.closed_at is not null and o.business_date between p_from and p_to
             and (o.promo_id = p.id or exists (select 1 from public.order_lines l where l.order_id = o.id and l.promo_id = p.id))) revenue_cents
      from public.promotions p where p.restaurant_id = p_restaurant_id order by p.created_at) x);
end $$;

revoke all on function public.pos_apply_promo(uuid, text) from public, anon;
revoke all on function public.pos_remove_promo(uuid) from public, anon;
revoke all on function public.check_promo_code(text, text, bigint) from public;
revoke all on function public.promo_report(uuid, date, date) from public, anon;
grant execute on function public.pos_apply_promo(uuid, text) to authenticated;
grant execute on function public.pos_remove_promo(uuid) to authenticated;
grant execute on function public.check_promo_code(text, text, bigint) to anon, authenticated;
grant execute on function public.promo_report(uuid, date, date) to authenticated;

-- ------------------------------------------------------------ lines: the happy hour price
create or replace function app.order_lines_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  it public.menu_items;
  mods jsonb;
  add_price bigint;
  n_found int;
  n_asked int;
  names text;
  g record;
  v  public.item_variants;
  c  public.categories;
  r  public.restaurants;
  lang text;
  hh record;
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
       or new.modifiers is distinct from old.modifiers
       or new.created_at <> old.created_at then
      raise exception 'only quantity, note, station and kitchen status can change on a line'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- INSERT
  -- a server function copying an existing line (splitting a bill) keeps its exact name and price
  if not app.is_client() and coalesce(current_setting('app.copy_line', true), '') = 'on' then
    return new;
  end if;
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
    -- extras and menu choices: only options of groups linked to this dish, priced here
    if jsonb_typeof(new.modifiers) <> 'array' then new.modifiers := '[]'::jsonb; end if;
    select count(distinct x ->> 'id') into n_asked from jsonb_array_elements(new.modifiers) x;
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'group_id', o.group_id,
                     'name', coalesce(o.name ->> lang, o.name ->> 'fr', (select value #>> '{}' from jsonb_each(o.name) limit 1)),
                     'price_cents', o.price_cents) order by ig.sort_order, gr.sort_order, o.sort_order, o.created_at), '[]'::jsonb),
           coalesce(sum(o.price_cents), 0), count(*),
           string_agg(coalesce(o.name ->> lang, o.name ->> 'fr', (select value #>> '{}' from jsonb_each(o.name) limit 1)), ', '
                      order by ig.sort_order, gr.sort_order, o.sort_order, o.created_at)
      into mods, add_price, n_found, names
      from (select distinct app.try_uuid(x ->> 'id') id from jsonb_array_elements(new.modifiers) x) s
      join public.modifier_options o on o.restaurant_id = new.restaurant_id and o.id = s.id and o.active
      join public.modifier_groups gr on gr.restaurant_id = new.restaurant_id and gr.id = o.group_id and gr.active
      join public.item_modifier_groups ig on ig.restaurant_id = new.restaurant_id and ig.group_id = gr.id and ig.menu_item_id = it.id;
    if n_found <> n_asked then
      raise exception 'modifier not available' using errcode = '23503';
    end if;
    for g in select gr.id, gr.min_select, gr.max_select,
                    (select count(*) from jsonb_array_elements(mods) m where (m ->> 'group_id')::uuid = gr.id) chosen
               from public.item_modifier_groups ig
               join public.modifier_groups gr on gr.restaurant_id = new.restaurant_id and gr.id = ig.group_id and gr.active
              where ig.restaurant_id = new.restaurant_id and ig.menu_item_id = it.id
                and exists (select 1 from public.modifier_options o where o.restaurant_id = new.restaurant_id and o.group_id = gr.id and o.active) loop
      if g.chosen < g.min_select or (g.max_select is not null and g.chosen > g.max_select) then
        raise exception 'modifier choice required' using errcode = '23514';
      end if;
    end loop;
    new.modifiers := mods;
    -- happy hour: a percentage off the dish (options keep their price)
    select * into hh from app.happy_hour_for(r, it, now());
    if hh.id is not null then
      new.list_price_cents := new.unit_price_cents + add_price;
      new.promo_id := hh.id;
      new.unit_price_cents := new.unit_price_cents - round(new.unit_price_cents * hh.value / 10000.0)::bigint;
    end if;
    new.unit_price_cents := new.unit_price_cents + add_price;
    if names is not null then
      new.name := left(new.name || ' + ' || names, 120);
    end if;
  else
    new.modifiers := '[]'::jsonb;
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

-- ------------------------------------------------------------ the public menu
create or replace function public.get_menu(p_slug text, p_table_token text default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  r public.restaurants;
  t public.dining_tables;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then
    return null;
  end if;

  if p_table_token is not null then
    select * into t from public.dining_tables
     where restaurant_id = r.id and qr_token = p_table_token and active;
  end if;

  return jsonb_build_object(
    'restaurant', jsonb_build_object(
      'id', r.id, 'slug', r.slug, 'name', r.name, 'languages', r.languages,
      'currency', r.currency, 'branding', r.branding, 'opening_hours', r.opening_hours,
      'timezone', r.timezone, 'phone', r.phone, 'address', r.address, 'city', r.city,
      'accept_dine_in', r.accept_dine_in, 'accept_takeaway', r.accept_takeaway,
      'accept_delivery', r.accept_delivery
    ),
    'ordering_enabled', app.qr_ordering(r),
    'online', jsonb_build_object(
      'prep_minutes', app.online_prep(r),
      'delivery_fee_cents', coalesce((r.online ->> 'delivery_fee_cents')::bigint, 0),
      'delivery_min_cents', coalesce((r.online ->> 'delivery_min_cents')::bigint, 0),
      'delivery_free_from_cents', (r.online ->> 'delivery_free_from_cents')::bigint,
      'delivery_area', r.online ->> 'delivery_area',
      'schedule', coalesce((r.online ->> 'schedule')::boolean, true),
      'paused', coalesce((r.online ->> 'paused_until')::timestamptz > now(), false),
      'paused_until', case when (r.online ->> 'paused_until')::timestamptz > now() then r.online ->> 'paused_until' end,
      'open_now', app.open_at(r, now())),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'value', p.value, 'until', p.end_time) order by p.value desc), '[]'::jsonb)
                     from public.promotions p where p.restaurant_id = r.id and p.kind = 'happy_hour' and app.promo_live(p, r, now())),
    'codes', exists (select 1 from public.promotions p where p.restaurant_id = r.id and p.kind = 'code' and p.active and 'online' = any (p.channels)),
    'table', case when t.id is not null
                  then jsonb_build_object('label', t.label, 'token', t.qr_token) end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon) order by c.sort_order, c.created_at, c.id)
      from public.categories c
      where c.restaurant_id = r.id and c.active and app.category_open(c, r, now())
        and exists (select 1 from public.menu_items i
                    where i.restaurant_id = r.id and i.category_id = c.id and i.active)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category_id', i.category_id, 'name', i.name,
        'description', i.description, 'price_cents', i.price_cents,
        'image_url', i.image_url, 'tags', i.tags, 'available', i.available,
        'promo_bp', (select p.value from app.happy_hour_for(r, i, now()) p),
        'variants', coalesce((
          select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_cents', v.price_cents)
                           order by v.sort_order, v.price_cents, v.id)
          from public.item_variants v
          where v.restaurant_id = r.id and v.menu_item_id = i.id and v.active
        ), '[]'::jsonb),
        'modifier_groups', coalesce((
          select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
                   'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)
                                                order by o.sort_order, o.created_at), '[]'::jsonb)
                                 from public.modifier_options o where o.restaurant_id = r.id and o.group_id = g.id and o.active))
                 order by ig.sort_order, g.sort_order, g.created_at)
          from public.item_modifier_groups ig
          join public.modifier_groups g on g.restaurant_id = r.id and g.id = ig.group_id and g.active
          where ig.restaurant_id = r.id and ig.menu_item_id = i.id
            and exists (select 1 from public.modifier_options o where o.restaurant_id = r.id and o.group_id = g.id and o.active)
        ), '[]'::jsonb)
      ) order by c.sort_order, c.created_at, i.sort_order, i.created_at, i.id)
      from public.menu_items i
      join public.categories c on c.restaurant_id = i.restaurant_id and c.id = i.category_id
      where i.restaurant_id = r.id and i.active and c.active and app.category_open(c, r, now())
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.place_order(p_slug text, p_order jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.restaurants;
  t          public.dining_tables;
  o          public.orders;
  it         public.menu_items;
  v          public.item_variants;
  line       jsonb;
  v_client   uuid;
  v_type     text;
  v_qty      int;
  v_item_id  uuid;
  v_var_id   uuid;
  v_name     text;
  v_phone    text;
  v_address  text;
  v_note     text;
  has_variants boolean;
  v_wanted   timestamptz;
  v_loc      jsonb;
  v_fee      bigint;
begin
  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    perform app.fail('invalid_request');
  end if;

  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then
    perform app.fail('restaurant_not_found');
  end if;
  if not app.is_writable(r) then
    perform app.fail('ordering_unavailable');
  end if;
  if not app.qr_ordering(r) then
    perform app.fail('qr_ordering_off');
  end if;

  v_client := app.try_uuid(p_order ->> 'client_id');
  if v_client is null then
    perform app.fail('invalid_request', 'client_id');
  end if;

  -- Idempotency: the same client_id always returns the same order.
  select * into o from public.orders where restaurant_id = r.id and client_id = v_client;
  if o.id is not null then
    return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                              'total_cents', o.total_cents, 'status', o.status, 'duplicate', true);
  end if;

  v_type    := p_order ->> 'order_type';
  v_name    := nullif(btrim(p_order #>> '{customer,name}'), '');
  v_phone   := nullif(btrim(p_order #>> '{customer,phone}'), '');
  v_address := nullif(btrim(p_order #>> '{customer,address}'), '');
  v_note    := nullif(btrim(p_order ->> 'note'), '');

  if v_type = 'dine_in' then
    if not r.accept_dine_in then perform app.fail('order_type_unavailable'); end if;
    select * into t from public.dining_tables
     where restaurant_id = r.id and qr_token = (p_order ->> 'table_token') and active;
    if t.id is null then perform app.fail('invalid_table'); end if;
  elsif v_type = 'takeaway' then
    if not r.accept_takeaway then perform app.fail('order_type_unavailable'); end if;
    if v_name is null or v_phone is null then perform app.fail('customer_required'); end if;
  elsif v_type = 'delivery' then
    if not r.accept_delivery then perform app.fail('order_type_unavailable'); end if;
    if v_name is null or v_phone is null or v_address is null then perform app.fail('customer_required'); end if;
  else
    perform app.fail('invalid_request', 'order_type');
  end if;

  -- online orders (take-away and delivery, no table): pause, opening hours, a time asked for
  if t.id is null then
    if coalesce((r.online ->> 'paused_until')::timestamptz > now(), false) then perform app.fail('online_paused'); end if;
    if nullif(p_order ->> 'wanted_at', '') is not null then
      begin v_wanted := (p_order ->> 'wanted_at')::timestamptz;
      exception when others then perform app.fail('invalid_request', 'wanted_at'); end;
      if v_wanted < now() + make_interval(mins => app.online_prep(r) - 5) or v_wanted > now() + interval '7 days'
         or not coalesce((r.online ->> 'schedule')::boolean, true) then
        perform app.fail('invalid_request', 'wanted_at');
      end if;
      if not app.open_at(r, v_wanted) then perform app.fail('closed'); end if;
    elsif not app.open_at(r, now()) then
      perform app.fail('closed');
    end if;
    if v_type = 'delivery' and jsonb_typeof(p_order -> 'location') = 'object' then
      if (p_order #>> '{location,lat}') ~ '^-?[0-9]{1,2}(\.[0-9]+)?$' and (p_order #>> '{location,lng}') ~ '^-?[0-9]{1,3}(\.[0-9]+)?$' then
        v_loc := jsonb_build_object('lat', round((p_order #>> '{location,lat}')::numeric, 6), 'lng', round((p_order #>> '{location,lng}')::numeric, 6));
      end if;
    end if;
    -- the same phone cannot flood the restaurant
    if (select count(*) from public.orders where restaurant_id = r.id and source = 'qr' and table_id is null
          and customer_phone = v_phone and created_at > now() - interval '10 minutes') >= 4 then
      perform app.fail('rate_limited');
    end if;
  end if;
  if length(v_note) > 300 or length(v_name) > 60 or length(v_phone) > 30 or length(v_address) > 300 then
    perform app.fail('invalid_request', 'too_long');
  end if;
  if jsonb_typeof(p_order -> 'items') <> 'array'
     or jsonb_array_length(p_order -> 'items') not between 1 and 50 then
    perform app.fail('invalid_request', 'items');
  end if;

  -- Basic abuse protection for a public endpoint.
  if t.id is not null and (
       select count(*) from public.orders
        where restaurant_id = r.id and table_id = t.id and source = 'qr'
          and created_at > now() - interval '10 minutes') >= 8 then
    perform app.fail('rate_limited');
  end if;
  if (select count(*) from public.orders
       where restaurant_id = r.id and source = 'qr'
         and created_at > now() - interval '10 minutes') >= 150 then
    perform app.fail('rate_limited');
  end if;

  insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source,
                             order_type, table_id, customer_name, customer_phone,
                             delivery_address, note, wanted_at, delivery_location)
  values (r.id, v_client, current_date, 0, 'qr', v_type, t.id, v_name, v_phone,
          case when v_type = 'delivery' then v_address end, v_note, v_wanted, v_loc)
  returning * into o;

  for line in select * from jsonb_array_elements(p_order -> 'items') loop
    v_item_id := app.try_uuid(line ->> 'item_id');
    v_var_id  := app.try_uuid(line ->> 'variant_id');
    v_qty     := case when (line ->> 'quantity') ~ '^[0-9]{1,3}$' then (line ->> 'quantity')::int end;

    if v_qty is null or v_qty not between 1 and 20 then
      perform app.fail('invalid_request', 'quantity');
    end if;
    if length(line ->> 'note') > 200 then
      perform app.fail('invalid_request', 'too_long');
    end if;

    select i.* into it from public.menu_items i
      join public.categories c on c.restaurant_id = i.restaurant_id and c.id = i.category_id
     where i.restaurant_id = r.id and i.id = v_item_id and i.active and c.active and app.category_open(c, r, coalesce(v_wanted, now()));
    if it.id is null then
      perform app.fail('item_unavailable', coalesce(v_item_id::text, ''));
    end if;
    if not it.available then
      perform app.fail('item_sold_out', it.id::text);
    end if;

    select exists (select 1 from public.item_variants
                    where restaurant_id = r.id and menu_item_id = it.id and active)
      into has_variants;
    if has_variants then
      select * into v from public.item_variants
       where restaurant_id = r.id and menu_item_id = it.id and id = v_var_id and active;
      if v.id is null then
        perform app.fail('variant_required', it.id::text);
      end if;
    elsif v_var_id is not null then
      perform app.fail('invalid_request', 'variant');
    end if;

    -- name / price / vat / station are filled from the menu by the line trigger
    if line ? 'modifiers' and (jsonb_typeof(line -> 'modifiers') <> 'array' or jsonb_array_length(line -> 'modifiers') > 30) then
      perform app.fail('invalid_request', 'modifiers');
    end if;
    -- options are checked and priced by the line trigger (never the browser's prices)
    insert into public.order_lines (restaurant_id, order_id, menu_item_id, variant_id,
                                    name, unit_price_cents, quantity, vat_bp, note, modifiers)
    values (r.id, o.id, it.id, case when has_variants then v.id end,
            '-', 0, v_qty, 0, nullif(btrim(line ->> 'note'), ''),
            coalesce((select jsonb_agg(jsonb_build_object('id', x)) from jsonb_array_elements_text(line -> 'modifiers') x), '[]'::jsonb));
  end loop;

  select * into o from public.orders where id = o.id;
  -- delivery: a minimum order and a fee (free from an amount), the fee is a line of the ticket
  if v_type = 'delivery' then
    if o.subtotal_cents < coalesce((r.online ->> 'delivery_min_cents')::bigint, 0) then
      perform app.fail('below_minimum', (r.online ->> 'delivery_min_cents'));
    end if;
    v_fee := coalesce((r.online ->> 'delivery_fee_cents')::bigint, 0);
    if v_fee > 0 and (nullif(r.online ->> 'delivery_free_from_cents', '') is null
                      or o.subtotal_cents < (r.online ->> 'delivery_free_from_cents')::bigint) then
      insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, station, kitchen_sent_at, ready_at)
      values (r.id, o.id, null, 'Livraison', v_fee, 1, 2000, 'kitchen', now(), now());
      select * into o from public.orders where id = o.id;
    end if;
  end if;
  -- a promo code typed by the guest (checked and priced here)
  if nullif(btrim(p_order ->> 'promo_code'), '') is not null then
    perform app.apply_promo_code(o.id, p_order ->> 'promo_code', 'online');
    select * into o from public.orders where id = o.id;
  end if;
  return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'status', o.status, 'duplicate', false);
end $$;
