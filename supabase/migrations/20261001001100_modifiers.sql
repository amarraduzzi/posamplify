-- =============================================================================
-- 0024 EXTRAS AND SET MENUS (modifiers)
-- =============================================================================
-- A group of options linked to dishes:
--   "Suppléments" (0 to 3, + 5 DH each), "Cuisson" (exactly 1, free),
--   "Formule petit-déj": "Boisson" (exactly 1 of café/thé/jus) + "Viennoiserie" (exactly 1).
-- The till and the QR menu send WHICH options; the database checks they belong
-- to the dish, enforces min/max, adds the prices and writes them on the line
-- (name "Burger + Fromage, Bacon"), so tickets, kitchen bons and the fiscal
-- record all carry them.
-- =============================================================================

create table public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null check (app.valid_i18n(name, 60)),
  min_select    integer not null default 0 check (min_select between 0 and 20),
  max_select    integer check (max_select is null or (max_select between 1 and 20)),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  check (max_select is null or max_select >= min_select)
);
create table public.modifier_options (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id      uuid not null,
  name          jsonb not null check (app.valid_i18n(name, 60)),
  price_cents   bigint not null default 0 check (price_cents between 0 and 100000000),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, group_id) references public.modifier_groups (restaurant_id, id) on delete cascade
);
create index modifier_options_group_idx on public.modifier_options (restaurant_id, group_id, sort_order);
create table public.item_modifier_groups (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  menu_item_id  uuid not null,
  group_id      uuid not null,
  sort_order    integer not null default 0,
  primary key (menu_item_id, group_id),
  foreign key (restaurant_id, menu_item_id) references public.menu_items (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, group_id) references public.modifier_groups (restaurant_id, id) on delete cascade
);
create index item_modifier_groups_idx on public.item_modifier_groups (restaurant_id, group_id);
create trigger modifier_groups_same_tenant before update on public.modifier_groups
  for each row execute function app.forbid_restaurant_change();
create trigger modifier_options_same_tenant before update on public.modifier_options
  for each row execute function app.forbid_restaurant_change();

-- like the menu: the till reads, managers edit
alter table public.modifier_groups      enable row level security;
alter table public.modifier_options     enable row level security;
alter table public.item_modifier_groups enable row level security;
grant select, insert, update, delete on public.modifier_groups      to authenticated;
grant select, insert, update, delete on public.modifier_options     to authenticated;
grant select, insert, update, delete on public.item_modifier_groups to authenticated;
do $$
declare t text;
begin
  foreach t in array array['modifier_groups', 'modifier_options', 'item_modifier_groups'] loop
    execute format($f$
      create policy %1$s_select on public.%1$s for select to authenticated
        using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));
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
create trigger audit_modifier_groups after insert or update or delete on public.modifier_groups
  for each row execute function app.audit();
create trigger audit_modifier_options after insert or update or delete on public.modifier_options
  for each row execute function app.audit();

-- what was chosen, as written by the trigger: [{id, group_id, name, price_cents}]
alter table public.order_lines add column if not exists modifiers jsonb not null default '[]'::jsonb;

-- ------------------------------------------------------------ the line trigger
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


-- ------------------------------------------------------------ the guest menu
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
    'ordering_enabled', app.is_writable(r),
    'table', case when t.id is not null
                  then jsonb_build_object('label', t.label, 'token', t.qr_token) end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon) order by c.sort_order, c.created_at, c.id)
      from public.categories c
      where c.restaurant_id = r.id and c.active
        and exists (select 1 from public.menu_items i
                    where i.restaurant_id = r.id and i.category_id = c.id and i.active)
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'category_id', i.category_id, 'name', i.name,
        'description', i.description, 'price_cents', i.price_cents,
        'image_url', i.image_url, 'tags', i.tags, 'available', i.available,
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
      where i.restaurant_id = r.id and i.active and c.active
    ), '[]'::jsonb)
  );
end $$;


-- ------------------------------------------------------------ guest orders
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
                             delivery_address, note)
  values (r.id, v_client, current_date, 0, 'qr', v_type, t.id, v_name, v_phone,
          case when v_type = 'delivery' then v_address end, v_note)
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
     where i.restaurant_id = r.id and i.id = v_item_id and i.active and c.active;
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
  return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'status', o.status, 'duplicate', false);
end $$;

