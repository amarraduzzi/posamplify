-- =============================================================================
-- 0006 SERVER FUNCTIONS (called from the apps via supabase.rpc)
-- =============================================================================
-- Error convention: functions raise with a short machine readable MESSAGE
-- (e.g. 'invalid_table', 'ordering_unavailable'); the apps translate it.
-- PIN failures do NOT raise but return {"ok": false, "error": "..."} so the
-- failed attempt counter is committed (see app.check_staff_pin).
-- =============================================================================

create or replace function app.try_uuid(v text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return v::uuid;
exception when others then
  return null;
end $$;

create or replace function app.fail(code text, detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', code using errcode = 'P0001', detail = coalesce(detail, '');
end $$;

create or replace function app.i18n_first(v jsonb, langs text[])
returns text
language sql immutable
set search_path = ''
as $$
  select coalesce(
    (select v ->> l from unnest(langs) l where v ? l limit 1),
    (select e.value #>> '{}' from jsonb_each(v) e limit 1)
  )
$$;

-- =============================================================================
-- PUBLIC (guest) FUNCTIONS
-- =============================================================================

-- Everything the QR menu needs in one call. Only published data, never the
-- fiscal identity, staff, or anything else internal.
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
        ), '[]'::jsonb)
      ) order by c.sort_order, c.created_at, i.sort_order, i.created_at, i.id)
      from public.menu_items i
      join public.categories c on c.restaurant_id = i.restaurant_id and c.id = i.category_id
      where i.restaurant_id = r.id and i.active and c.active
    ), '[]'::jsonb)
  );
end $$;

-- A guest places an order. The browser sends WHAT it wants (item ids, variant
-- ids, quantities), never prices: every price comes from the database.
--
-- p_order = {
--   "client_id": "<uuid generated in the browser>",      -- makes retries safe
--   "order_type": "dine_in" | "takeaway" | "delivery",
--   "table_token": "k7f2q...",                           -- dine_in only
--   "customer": {"name": "...", "phone": "...", "address": "..."},
--   "note": "no onions please",
--   "items": [{"item_id": "<uuid>", "variant_id": "<uuid>|null", "quantity": 2, "note": "..."}]
-- }
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
    insert into public.order_lines (restaurant_id, order_id, menu_item_id, variant_id,
                                    name, unit_price_cents, quantity, vat_bp, note)
    values (r.id, o.id, it.id, case when has_variants then v.id end,
            '-', 0, v_qty, 0, nullif(btrim(line ->> 'note'), ''));
  end loop;

  select * into o from public.orders where id = o.id;
  return jsonb_build_object('order_id', o.id, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'status', o.status, 'duplicate', false);
end $$;

-- Guest order tracking ("your order is being prepared"). The order id is a
-- random UUID only the guest's browser knows.
create or replace function public.get_order_status(p_order_id uuid)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', o.status, 'ticket_number', o.ticket_number,
                            'total_cents', o.total_cents, 'created_at', o.created_at)
  from public.orders o
  where o.id = p_order_id and o.source = 'qr' and o.created_at > now() - interval '24 hours'
$$;

-- =============================================================================
-- TILL (device) FUNCTIONS
-- =============================================================================

-- Staff login on the till: returns who is working.
create or replace function public.verify_staff_pin(p_restaurant_id uuid, p_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare res text; s public.staff;
begin
  perform app.require_role(p_restaurant_id, 'device', false);
  res := app.check_staff_pin(p_restaurant_id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then
    return jsonb_build_object('ok', false, 'error', res);
  end if;
  select * into s from public.staff where id = p_staff_id;
  return jsonb_build_object('ok', true, 'staff',
    jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role));
end $$;

-- Owner / manager account sets or resets a staff PIN (4 to 6 digits).
create or replace function public.set_staff_pin(p_staff_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.staff;
begin
  select * into s from public.staff where id = p_staff_id;
  if s.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(s.restaurant_id, 'manager', true);
  if p_pin !~ '^[0-9]{4,6}$' then perform app.fail('invalid_pin_format'); end if;
  insert into app.staff_pins (staff_id, pin_hash)
  values (s.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (staff_id) do update
    set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
end $$;

-- Discount on an open order, authorised by a manager PIN.
create or replace function public.apply_discount(
  p_order_id uuid, p_discount_cents bigint, p_manager_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders; res text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if p_discount_cents is null or p_discount_cents < 0 or p_discount_cents > o.subtotal_cents then
    perform app.fail('invalid_amount');
  end if;
  res := app.check_staff_pin(o.restaurant_id, p_manager_staff_id, p_pin, 'manager');
  if res <> 'ok' then
    return jsonb_build_object('ok', false, 'error', res);
  end if;
  update public.orders
     set discount_cents = p_discount_cents,
         discount_by_staff_id = case when p_discount_cents > 0 then p_manager_staff_id end
   where id = o.id
  returning * into o;
  return jsonb_build_object('ok', true, 'subtotal_cents', o.subtotal_cents,
                            'discount_cents', o.discount_cents, 'total_cents', o.total_cents);
end $$;

-- Cancel an open order. Needs a manager PIN once it has lines.
create or replace function public.cancel_order(
  p_order_id uuid, p_reason text, p_manager_staff_id uuid default null, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders; res text; has_lines boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_closed_use_credit_note'); end if;
  if o.status = 'cancelled' then
    return jsonb_build_object('ok', true);
  end if;
  if exists (select 1 from public.payments where restaurant_id = o.restaurant_id and order_id = o.id) then
    perform app.fail('remove_payments_first');
  end if;
  select exists (select 1 from public.order_lines where restaurant_id = o.restaurant_id and order_id = o.id)
    into has_lines;
  if has_lines then
    if nullif(btrim(p_reason), '') is null then perform app.fail('reason_required'); end if;
    res := app.check_staff_pin(o.restaurant_id, p_manager_staff_id, p_pin, 'manager');
    if res <> 'ok' then
      return jsonb_build_object('ok', false, 'error', res);
    end if;
  end if;
  update public.orders
     set status = 'cancelled', cancelled_at = now(),
         cancelled_by_staff_id = case when has_lines then p_manager_staff_id end,
         cancel_reason = left(btrim(p_reason), 200)
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

-- -----------------------------------------------------------------------------
-- Fiscal document builder (shared by close_order and issue_credit_note)
-- -----------------------------------------------------------------------------
create or replace function app.insert_fiscal_document(
  r public.restaurants,
  p_doc_type text,
  p_order_id uuid,
  p_original_id uuid,
  p_lines jsonb,          -- [{name, qty, unit_ttc, total_ttc, vat_bp}] (before discount)
  p_discount bigint,
  p_payments jsonb,       -- [{method, amount, tip}]
  p_buyer jsonb,
  p_reason text,
  p_staff_id uuid,
  p_sign int default 1    -- -1 for credit notes
)
returns public.fiscal_documents
language plpgsql
security definer
set search_path = ''
as $$
declare
  d          public.fiscal_documents;
  v_series   text := case p_doc_type when 'ticket' then 'T' when 'invoice' then 'F' else 'A' end;
  v_year     int := extract(year from (now() at time zone r.timezone))::int;
  subtotal   bigint;
  alloc_left bigint;
  biggest    int;
  lines_out  jsonb := '[]'::jsonb;
  l          jsonb;
  idx        int := 0;
  l_ttc      bigint;
  l_disc     bigint;
  prev       text;
begin
  select coalesce(sum((x ->> 'total_ttc')::bigint), 0) into subtotal from jsonb_array_elements(p_lines) x;
  alloc_left := coalesce(p_discount, 0);

  -- index of the largest line: absorbs the rounding remainder of the discount
  select (i - 1)::int into biggest
    from jsonb_array_elements(p_lines) with ordinality as e(x, i)
   order by (x ->> 'total_ttc')::bigint desc, i limit 1;

  -- spread the order discount over the lines proportionally, then split each
  -- line in HT + VAT (prices are VAT inclusive)
  for l in select x from jsonb_array_elements(p_lines) x loop
    l_ttc := (l ->> 'total_ttc')::bigint;
    if idx = biggest then
      l_disc := 0; -- assigned after the loop
    elsif subtotal > 0 then
      l_disc := (coalesce(p_discount, 0) * l_ttc) / subtotal;
    else
      l_disc := 0;
    end if;
    alloc_left := alloc_left - l_disc;
    lines_out := lines_out || jsonb_build_array(l || jsonb_build_object('discount', l_disc));
    idx := idx + 1;
  end loop;
  if biggest is not null then
    lines_out := jsonb_set(lines_out, array[biggest::text, 'discount'], to_jsonb(alloc_left));
  end if;

  select jsonb_agg(
           x || jsonb_build_object(
             'net_ttc', p_sign * ((x ->> 'total_ttc')::bigint - (x ->> 'discount')::bigint),
             'ht',      p_sign * round(((x ->> 'total_ttc')::bigint - (x ->> 'discount')::bigint) * 10000.0
                                       / (10000 + (x ->> 'vat_bp')::int))::bigint
           )
           || jsonb_build_object('unit_ttc', p_sign * (x ->> 'unit_ttc')::bigint,
                                 'total_ttc', p_sign * (x ->> 'total_ttc')::bigint,
                                 'discount', p_sign * (x ->> 'discount')::bigint)
           order by i)
    into lines_out
    from jsonb_array_elements(lines_out) with ordinality e(x, i);
  lines_out := coalesce(lines_out, '[]'::jsonb);
  select coalesce(jsonb_agg(x || jsonb_build_object('vat', (x ->> 'net_ttc')::bigint - (x ->> 'ht')::bigint) order by i), '[]')
    into lines_out
    from jsonb_array_elements(lines_out) with ordinality e(x, i);

  d.id := gen_random_uuid();
  d.restaurant_id := r.id;
  d.doc_type := p_doc_type;
  d.series := v_series;
  d.fiscal_year := v_year;
  d.number := app.next_counter(r.id, 'fiscal:' || v_series || ':' || v_year);
  d.doc_number := v_series || '-' || v_year || '-' || lpad(d.number::text, 6, '0');
  d.chain_index := app.next_counter(r.id, 'fiscal:chain');
  d.order_id := p_order_id;
  d.original_document_id := p_original_id;
  d.business_date := app.business_date(r);
  d.issued_at := now();
  d.currency := r.currency;
  d.seller := jsonb_build_object('name', r.name, 'legal_name', r.legal_name, 'ice', r.ice,
                                 'if', r.tax_id, 'rc', r.rc, 'address', r.address, 'city', r.city);
  d.buyer := p_buyer;
  d.lines := lines_out;
  select coalesce(jsonb_agg(jsonb_build_object('vat_bp', s.rate, 'ht', s.sum_ht, 'vat', s.sum_vat, 'ttc', s.sum_ttc)
                            order by s.rate), '[]')
    into d.vat_breakdown
    from (select (x ->> 'vat_bp')::int rate, sum((x ->> 'ht')::bigint) sum_ht,
                 sum((x ->> 'vat')::bigint) sum_vat, sum((x ->> 'net_ttc')::bigint) sum_ttc
            from jsonb_array_elements(lines_out) x group by 1) s;
  d.payments := coalesce(p_payments, '[]'::jsonb);
  d.discount_cents := p_sign * coalesce(p_discount, 0);
  select coalesce(sum((x ->> 'ht')::bigint), 0), coalesce(sum((x ->> 'vat')::bigint), 0),
         coalesce(sum((x ->> 'net_ttc')::bigint), 0)
    into d.total_ht_cents, d.total_vat_cents, d.total_ttc_cents
    from jsonb_array_elements(lines_out) x;
  d.reason := p_reason;
  d.staff_id := p_staff_id;

  select f.hash into prev from public.fiscal_documents f
   where f.restaurant_id = r.id and f.chain_index = d.chain_index - 1;
  d.prev_hash := prev;
  d.hash := app.fiscal_hash(prev, app.fiscal_payload(d));
  d.created_at := now();

  insert into public.fiscal_documents select d.*;
  return d;
end $$;
revoke all on function app.insert_fiscal_document(public.restaurants, text, uuid, uuid, jsonb, bigint, jsonb, jsonb, text, uuid, int)
  from public, anon, authenticated;

-- Close a fully paid order: freezes it and issues the numbered fiscal ticket.
-- The sum of the payments must equal the order total exactly (the till UI
-- handles change for cash).
create or replace function public.close_order(
  p_order_id uuid, p_staff_id uuid default null, p_buyer jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  r public.restaurants;
  paid bigint;
  d public.fiscal_documents;
  lines jsonb;
  pays jsonb;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_already_closed'); end if;
  if o.status = 'cancelled' then perform app.fail('order_cancelled'); end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff where restaurant_id = r.id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  if p_buyer is not null and (jsonb_typeof(p_buyer) <> 'object'
       or (p_buyer ? 'ice' and (p_buyer ->> 'ice') !~ '^[0-9]{15}$')) then
    perform app.fail('invalid_buyer');
  end if;
  if exists (select 1 from public.day_closures
              where restaurant_id = r.id and business_date = app.business_date(r)) then
    perform app.fail('day_closed');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', l.name, 'qty', l.quantity, 'unit_ttc', l.unit_price_cents,
           'total_ttc', l.line_total_cents, 'vat_bp', l.vat_bp) order by l.created_at, l.id), '[]')
    into lines
    from public.order_lines l where l.restaurant_id = r.id and l.order_id = o.id;
  if jsonb_array_length(lines) = 0 then perform app.fail('order_empty'); end if;

  select coalesce(sum(amount_cents), 0),
         coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amount_cents,
                                               'tip', tip_cents, 'staff_id', staff_id)
                            order by created_at, id), '[]')
    into paid, pays
    from public.payments where restaurant_id = r.id and order_id = o.id;
  if paid <> o.total_cents then
    perform app.fail('payment_mismatch', format('paid=%s total=%s', paid, o.total_cents));
  end if;

  d := app.insert_fiscal_document(r, case when p_buyer ? 'ice' then 'invoice' else 'ticket' end,
                                  o.id, null, lines, o.discount_cents, pays, p_buyer, null,
                                  coalesce(p_staff_id, o.staff_id), 1);

  update public.orders set closed_at = now(), fiscal_document_id = d.id where id = o.id;
  return to_jsonb(d);
end $$;

-- Full reversal of a ticket/invoice (refund), authorised by a manager PIN.
create or replace function public.issue_credit_note(
  p_document_id uuid, p_reason text, p_manager_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  src public.fiscal_documents;
  r   public.restaurants;
  d   public.fiscal_documents;
  res text;
  lines jsonb;
  pays jsonb;
begin
  select * into src from public.fiscal_documents where id = p_document_id;
  if src.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(src.restaurant_id, 'device', true);
  if src.doc_type = 'credit_note' then perform app.fail('cannot_credit_a_credit_note'); end if;
  if exists (select 1 from public.fiscal_documents
              where restaurant_id = r.id and original_document_id = src.id) then
    perform app.fail('already_credited');
  end if;
  if nullif(btrim(p_reason), '') is null then perform app.fail('reason_required'); end if;
  if exists (select 1 from public.day_closures
              where restaurant_id = r.id and business_date = app.business_date(r)) then
    perform app.fail('day_closed');
  end if;

  res := app.check_staff_pin(r.id, p_manager_staff_id, p_pin, 'manager');
  if res <> 'ok' then
    return jsonb_build_object('ok', false, 'error', res);
  end if;

  -- rebuild the original (positive, pre-discount) lines, the builder applies the sign
  select jsonb_agg(jsonb_build_object('name', x ->> 'name', 'qty', (x ->> 'qty')::int,
                                      'unit_ttc', (x ->> 'unit_ttc')::bigint,
                                      'total_ttc', (x ->> 'total_ttc')::bigint,
                                      'vat_bp', (x ->> 'vat_bp')::int) order by i)
    into lines from jsonb_array_elements(src.lines) with ordinality e(x, i);
  select coalesce(jsonb_agg(x || jsonb_build_object('amount', -(x ->> 'amount')::bigint,
                                                    'tip', -(x ->> 'tip')::bigint) order by i), '[]')
    into pays from jsonb_array_elements(src.payments) with ordinality e(x, i);

  d := app.insert_fiscal_document(r, 'credit_note', src.order_id, src.id, lines,
                                  src.discount_cents, pays, src.buyer, left(btrim(p_reason), 200),
                                  p_manager_staff_id, -1);
  return jsonb_build_object('ok', true, 'document', to_jsonb(d));
end $$;

-- -----------------------------------------------------------------------------
-- Day reports
-- -----------------------------------------------------------------------------
create or replace function app.day_totals(p_restaurant_id uuid, p_date date)
returns jsonb
language sql stable
security definer
set search_path = ''
as $$
  with docs as (
    select * from public.fiscal_documents
     where restaurant_id = p_restaurant_id and business_date = p_date
  ),
  pays as (
    select p ->> 'method' method, (p ->> 'amount')::bigint amount, (p ->> 'tip')::bigint tip
      from docs, jsonb_array_elements(docs.payments) p
  ),
  vat as (
    select (v ->> 'vat_bp')::int vat_bp, sum((v ->> 'ht')::bigint) ht,
           sum((v ->> 'vat')::bigint) vat, sum((v ->> 'ttc')::bigint) ttc
      from docs, jsonb_array_elements(docs.vat_breakdown) v group by 1
  ),
  cash as (
    select kind, sum(amount_cents) amount from public.cash_movements
     where restaurant_id = p_restaurant_id and business_date = p_date group by kind
  )
  select jsonb_build_object(
    'business_date', p_date,
    'tickets', (select count(*) from docs where doc_type <> 'credit_note'),
    'credit_notes', (select count(*) from docs where doc_type = 'credit_note'),
    'credit_notes_cents', (select coalesce(sum(total_ttc_cents), 0) from docs where doc_type = 'credit_note'),
    'revenue_ttc_cents', (select coalesce(sum(total_ttc_cents), 0) from docs),
    'revenue_ht_cents', (select coalesce(sum(total_ht_cents), 0) from docs),
    'vat_cents', (select coalesce(sum(total_vat_cents), 0) from docs),
    'discounts_cents', (select coalesce(sum(discount_cents), 0) from docs),
    'vat_breakdown', (select coalesce(jsonb_agg(to_jsonb(vat) order by vat_bp), '[]') from vat),
    'payments', (select coalesce(jsonb_object_agg(method, amount), '{}')
                   from (select method, sum(amount) amount from pays group by method) s),
    'tips_cents', (select coalesce(sum(tip), 0) from pays),
    'cash_float_cents', (select coalesce(sum(amount), 0) from cash where kind = 'float'),
    'cash_payouts_cents', (select coalesce(sum(amount), 0) from cash where kind = 'payout'),
    'cash_deposits_cents', (select coalesce(sum(amount), 0) from cash where kind = 'deposit'),
    -- what should physically be in the drawer: float + cash sales + cash tips - money taken out
    'expected_cash_cents',
       (select coalesce(sum(amount), 0) from cash where kind = 'float')
     + (select coalesce(sum(amount + tip), 0) from pays where method = 'cash')
     - (select coalesce(sum(amount), 0) from cash where kind in ('payout', 'deposit')),
    'open_orders', (select count(*) from public.orders
                     where restaurant_id = p_restaurant_id and business_date = p_date
                       and closed_at is null and status <> 'cancelled' and total_cents > 0),
    'cancelled_orders', (select count(*) from public.orders
                          where restaurant_id = p_restaurant_id and business_date = p_date
                            and status = 'cancelled'),
    'by_staff', (select coalesce(jsonb_agg(jsonb_build_object('staff_id', staff_id, 'name', name,
                                                              'revenue_ttc_cents', total) order by total desc), '[]')
                   from (select d.staff_id, s.name, sum(d.total_ttc_cents) total
                           from docs d left join public.staff s on s.id = d.staff_id
                          group by d.staff_id, s.name) x)
  )
$$;
revoke all on function app.day_totals(uuid, date) from public, anon, authenticated;

-- X report: live figures for a business day (default: today), does not close anything.
create or replace function public.day_report(p_restaurant_id uuid, p_business_date date default null)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare r public.restaurants; dt date;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  dt := coalesce(p_business_date, app.business_date(r));
  return app.day_totals(r.id, dt) || jsonb_build_object(
    'closed', exists (select 1 from public.day_closures where restaurant_id = r.id and business_date = dt));
end $$;

-- Z report: freezes the figures of a business day. Irreversible, so it needs a
-- manager PIN and no open orders may remain.
create or replace function public.close_day(
  p_restaurant_id uuid, p_business_date date, p_manager_staff_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.restaurants; res text; totals jsonb;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if p_business_date is null or p_business_date > app.business_date(r) then
    perform app.fail('invalid_date');
  end if;
  if exists (select 1 from public.day_closures where restaurant_id = r.id and business_date = p_business_date) then
    perform app.fail('day_closed');
  end if;
  res := app.check_staff_pin(r.id, p_manager_staff_id, p_pin, 'manager');
  if res <> 'ok' then
    return jsonb_build_object('ok', false, 'error', res);
  end if;
  totals := app.day_totals(r.id, p_business_date);
  if (totals ->> 'open_orders')::int > 0 then
    perform app.fail('open_orders', totals ->> 'open_orders');
  end if;
  insert into public.day_closures (restaurant_id, business_date, totals, closed_by_staff_id)
  values (r.id, p_business_date, totals, p_manager_staff_id);
  return jsonb_build_object('ok', true, 'totals', totals);
end $$;

-- Checks the hash chain of all fiscal documents of a restaurant.
create or replace function public.verify_fiscal_chain(p_restaurant_id uuid)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  d public.fiscal_documents;
  prev text := null;
  expected_index bigint := 1;
  n bigint := 0;
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  for d in select * from public.fiscal_documents
            where restaurant_id = p_restaurant_id order by chain_index loop
    if d.chain_index <> expected_index then
      return jsonb_build_object('ok', false, 'checked', n, 'broken_at', d.doc_number, 'error', 'gap');
    end if;
    if d.prev_hash is distinct from prev or d.hash <> app.fiscal_hash(prev, app.fiscal_payload(d)) then
      return jsonb_build_object('ok', false, 'checked', n, 'broken_at', d.doc_number, 'error', 'hash');
    end if;
    prev := d.hash;
    expected_index := expected_index + 1;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'checked', n);
end $$;

-- =============================================================================
-- PLATFORM ADMIN FUNCTIONS (you)
-- =============================================================================
create or replace function app.require_platform_admin()
returns void
language plpgsql stable
security definer
set search_path = ''
as $$
begin
  if not app.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;

create or replace function public.admin_create_restaurant(
  p_slug text, p_name text, p_owner_email text default null, p_is_demo boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare rid uuid; uid uuid;
begin
  perform app.require_platform_admin();
  insert into public.restaurants (slug, name, is_demo)
  values (lower(p_slug), p_name, p_is_demo)
  returning id into rid;
  if p_owner_email is not null then
    select id into uid from auth.users where lower(email) = lower(p_owner_email);
    if uid is null then perform app.fail('user_not_found', p_owner_email); end if;
    insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  end if;
  return rid;
end $$;

create or replace function public.admin_add_member(p_restaurant_id uuid, p_email text, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid;
begin
  perform app.require_platform_admin();
  select id into uid from auth.users where lower(email) = lower(p_email);
  if uid is null then perform app.fail('user_not_found', p_email); end if;
  insert into public.memberships (restaurant_id, user_id, role) values (p_restaurant_id, uid, p_role)
  on conflict (restaurant_id, user_id) do update set role = excluded.role;
end $$;

-- Pause for non-payment, activate after payment, extend a trial.
create or replace function public.admin_set_status(
  p_restaurant_id uuid, p_status public.restaurant_status, p_trial_ends_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  update public.restaurants
     set status = p_status,
         trial_ends_at = case when p_status = 'trial' then coalesce(p_trial_ends_at, trial_ends_at) else trial_ends_at end
   where id = p_restaurant_id;
  if not found then perform app.fail('not_found'); end if;
end $$;

-- Removes a DEMO restaurant with all its data (for nightly demo resets).
-- Real restaurants can never be purged: fiscal data must be kept 10 years.
create or replace function public.admin_purge_demo_restaurant(p_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_platform_admin();
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_demo) then
    perform app.fail('only_demo_restaurants_can_be_purged');
  end if;
  perform set_config('app.purge', 'on', true);
  delete from public.restaurants where id = p_restaurant_id;
  perform set_config('app.purge', 'off', true);
end $$;

-- =============================================================================
-- Who may call what
-- =============================================================================
revoke all on function public.get_menu(text, text) from public;
revoke all on function public.place_order(text, jsonb) from public;
revoke all on function public.get_order_status(uuid) from public;
grant execute on function public.get_menu(text, text) to anon, authenticated;
grant execute on function public.place_order(text, jsonb) to anon, authenticated;
grant execute on function public.get_order_status(uuid) to anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.verify_staff_pin(uuid, uuid, text)',
    'public.set_staff_pin(uuid, text)',
    'public.apply_discount(uuid, bigint, uuid, text)',
    'public.cancel_order(uuid, text, uuid, text)',
    'public.close_order(uuid, uuid, jsonb)',
    'public.issue_credit_note(uuid, text, uuid, text)',
    'public.day_report(uuid, date)',
    'public.close_day(uuid, date, uuid, text)',
    'public.verify_fiscal_chain(uuid)',
    'public.admin_create_restaurant(text, text, text, boolean)',
    'public.admin_add_member(uuid, text, public.member_role)',
    'public.admin_set_status(uuid, public.restaurant_status, timestamptz)',
    'public.admin_purge_demo_restaurant(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Realtime: the till and kitchen screens subscribe to new orders and lines.
-- Supabase Realtime applies the RLS policies above to every subscriber.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders, public.order_lines;
  end if;
end $$;
