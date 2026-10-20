-- =============================================================================
-- LOYALTY, step 4: a bill of 0 DH
--
-- A reward (or an approved manager discount) may now cover the whole bill. Such a bill is closed with NO payment:
-- nothing is paid, so no payment record exists and the fiscal ticket has an empty payment list; it still gets its
-- number, its place in the hash chain, VAT of 0 and it shows in the Z report (discount included).
--   * pos_redeem_reward / rewards_settle: the rewards together may equal the bill, never exceed it.
--   * pos_pay_order: an empty payment list is accepted only when the bill total is 0.
--   * the Z report counts an open bill that has dishes even when its total is 0, so it cannot be left behind
--     when the day is closed.
-- =============================================================================

create or replace function app.rewards_settle(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.orders; x public.order_rewards; tot bigint; sub bigint;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null or o.closed_at is not null then return; end if;
  if not exists (select 1 from public.order_rewards where order_id = o.id) then return; end if;   -- no records: leave the bill alone
  if not exists (select 1 from public.order_rewards where order_id = o.id and released_at is null) then
    if o.discount_kind = 'loyalty' then
      update public.orders set discount_cents = 0, discount_kind = null, discount_by_staff_id = null where id = o.id;
    end if;
    return;
  end if;
  if o.status = 'cancelled' or o.discount_kind is distinct from 'loyalty' then
    perform app.rewards_release(o.id);
    return;
  end if;
  -- a free dish whose dish is no longer on the bill (or fewer units than free ones): the newest one goes back
  loop
    select r.* into x from public.order_rewards r
     where r.order_id = o.id and r.released_at is null and r.kind = 'item'
       and (select count(*) from public.order_rewards z where z.order_id = o.id and z.released_at is null and z.menu_item_id = r.menu_item_id)
           > (select coalesce(sum(l.quantity), 0) from public.order_lines l where l.restaurant_id = o.restaurant_id and l.order_id = o.id and l.menu_item_id = r.menu_item_id)
     order by r.created_at desc, r.id limit 1;
    exit when x.id is null;
    perform app.rewards_release(o.id, x.id);
  end loop;
  -- the rewards may cover the whole bill but never more: newest first until they fit
  sub := (select coalesce(sum(line_total_cents), 0) from public.order_lines where restaurant_id = o.restaurant_id and order_id = o.id);
  loop
    select coalesce(sum(cents), 0) into tot from public.order_rewards where order_id = o.id and released_at is null;
    exit when tot = 0 or tot <= sub;
    select * into x from public.order_rewards where order_id = o.id and released_at is null order by created_at desc, id limit 1;
    perform app.rewards_release(o.id, x.id);
  end loop;
  if tot = 0 then
    update public.orders set discount_cents = 0, discount_kind = null, discount_by_staff_id = null where id = o.id;
  elsif tot <> o.discount_cents then
    update public.orders set discount_cents = tot, discount_by_staff_id = null where id = o.id;
  end if;
end $$;
revoke all on function app.rewards_settle(uuid) from public, anon, authenticated;

create or replace function public.pos_redeem_reward(p_order_id uuid, p_reward_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; c public.customers; rw jsonb; need int; val bigint; lbl text; item uuid;
        mx int; used int; sofar bigint; qty int; free int; rid uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if not coalesce((r.loyalty ->> 'enabled')::boolean, false) or not coalesce((r.loyalty ->> 'customers')::boolean, false) then
    perform app.fail('loyalty_off');
  end if;
  if o.customer_id is null then perform app.fail('no_customer'); end if;
  if o.discount_cents > 0 and o.discount_kind is distinct from 'loyalty' then perform app.fail('remove_discount_first'); end if;

  select x into rw from jsonb_array_elements(app.loyalty_rewards(r.loyalty)) x where x ->> 'id' = p_reward_id;
  if rw is null then perform app.fail('reward_not_found'); end if;
  need := greatest(1, (rw ->> 'points')::int);

  mx := coalesce((r.loyalty ->> 'max_per_order')::int, 1);
  select count(*), coalesce(sum(cents), 0) into used, sofar from public.order_rewards where order_id = o.id and released_at is null;
  if used >= greatest(1, least(10, mx)) then perform app.fail('max_rewards_reached'); end if;

  if rw ->> 'kind' = 'item' then
    item := (rw ->> 'item_id')::uuid;
    select min(unit_price_cents), coalesce(sum(quantity), 0) into val, qty from public.order_lines
     where restaurant_id = o.restaurant_id and order_id = o.id and menu_item_id = item;
    if val is null then perform app.fail('reward_item_not_in_order'); end if;
    select count(*) into free from public.order_rewards where order_id = o.id and released_at is null and menu_item_id = item;
    if free >= qty then perform app.fail('reward_item_all_free'); end if;
    lbl := coalesce(nullif(rw ->> 'label', ''), (select name ->> 'fr' from public.menu_items where restaurant_id = o.restaurant_id and id = item));
  else
    val := greatest(0, (rw ->> 'cents')::bigint);
  end if;
  -- all rewards together may cover the whole bill (it is then closed at 0 DH) but never more
  if o.subtotal_cents < sofar + val then perform app.fail('order_too_small'); end if;

  select * into c from public.customers where restaurant_id = o.restaurant_id and id = o.customer_id for update;
  if c.points < need then perform app.fail('not_enough_points'); end if;
  -- every reward on a bill belongs to the customer of the bill
  if exists (select 1 from public.order_rewards where order_id = o.id and released_at is null and customer_id <> c.id) then
    perform app.fail('remove_discount_first');
  end if;
  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = points - need where id = c.id;
  insert into public.order_rewards (restaurant_id, order_id, customer_id, reward_id, kind, menu_item_id, name, points, cents)
  values (o.restaurant_id, o.id, c.id, p_reward_id, rw ->> 'kind', item, lbl, need, val) returning id into rid;
  insert into public.loyalty_ledger (restaurant_id, customer_id, order_id, points, reason, reward_name, order_reward_id)
  values (o.restaurant_id, c.id, o.id, -need, 'redeem', lbl, rid);
  update public.orders set discount_cents = sofar + val, discount_kind = 'loyalty', discount_by_staff_id = null where id = o.id
  returning * into o;
  return jsonb_build_object('ok', true, 'order_reward_id', rid, 'discount_cents', o.discount_cents, 'total_cents', o.total_cents, 'points', c.points - need);
end $$;
revoke all on function public.pos_redeem_reward(uuid, text) from public, anon;
grant execute on function public.pos_redeem_reward(uuid, text) to authenticated;

create or replace function public.pos_pay_order(
  p_order_id uuid, p_payments jsonb, p_staff_id uuid default null, p_buyer jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  r public.restaurants;
  c public.customers;
  p jsonb;
  on_account bigint := 0;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null then perform app.fail('order_already_closed'); end if;
  -- a bill of 0 DH (a reward or an approved discount covers everything) needs no payment at all
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) > 20
     or (jsonb_array_length(p_payments) = 0 and o.total_cents <> 0) then
    perform app.fail('invalid_request', 'payments');
  end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff where restaurant_id = o.restaurant_id and id = p_staff_id) then
    perform app.fail('not_found', 'staff');
  end if;
  for p in select * from jsonb_array_elements(p_payments) loop
    if (p ->> 'method') not in ('cash', 'card', 'transfer', 'other', 'account')
       or (p ->> 'amount_cents') !~ '^[0-9]{1,12}$' or (p ->> 'amount_cents')::bigint <= 0
       or coalesce(p ->> 'tip_cents', '0') !~ '^[0-9]{1,12}$' then
      perform app.fail('invalid_request', 'payment');
    end if;
    if p ->> 'method' = 'account' then
      -- no tip on credit: a tip is money handed to the staff now
      if coalesce((p ->> 'tip_cents')::bigint, 0) <> 0 then perform app.fail('invalid_request', 'tip_on_account'); end if;
      on_account := on_account + (p ->> 'amount_cents')::bigint;
    end if;
  end loop;

  if on_account > 0 then
    if not coalesce((r.loyalty ->> 'customers')::boolean, false) or not coalesce((r.loyalty ->> 'credit')::boolean, false) then
      perform app.fail('credit_off');
    end if;
    if o.customer_id is null then perform app.fail('no_customer'); end if;
    select * into c from public.customers where restaurant_id = r.id and id = o.customer_id for update;
    if c.id is null then perform app.fail('no_customer'); end if;
    if not c.credit_allowed then perform app.fail('credit_not_allowed'); end if;
    if c.balance_cents + on_account > coalesce(c.credit_limit_cents, 0) then
      perform app.fail('credit_limit', format('balance=%s limit=%s', c.balance_cents, coalesce(c.credit_limit_cents, 0)));
    end if;
  end if;

  for p in select * from jsonb_array_elements(p_payments) loop
    insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents, staff_id)
    values (o.restaurant_id, o.id, p ->> 'method', (p ->> 'amount_cents')::bigint,
            coalesce((p ->> 'tip_cents')::bigint, 0), coalesce(p_staff_id, o.staff_id));
  end loop;
  return public.close_order(o.id, p_staff_id, p_buyer);
end $$;
revoke all on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) to authenticated;

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
  ),
  settled as (
    select method, -sum(amount_cents) amount from public.customer_account_ledger
     where restaurant_id = p_restaurant_id and business_date = p_date and kind = 'payment' group by method
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
    'account_sales_cents', (select coalesce(sum(amount), 0) from pays where method = 'account'),
    'account_received', (select coalesce(jsonb_object_agg(method, amount), '{}') from settled),
    'account_received_cents', (select coalesce(sum(amount), 0) from settled),
    -- what should physically be in the drawer: float + cash sales + cash tips
    -- + ardoises paid back in cash - money taken out
    'expected_cash_cents',
       (select coalesce(sum(amount), 0) from cash where kind = 'float')
     + (select coalesce(sum(amount + tip), 0) from pays where method = 'cash')
     + (select coalesce(sum(amount), 0) from settled where method = 'cash')
     - (select coalesce(sum(amount), 0) from cash where kind in ('payout', 'deposit')),
    'open_orders', (select count(*) from public.orders
                     where restaurant_id = p_restaurant_id and business_date = p_date
                       and closed_at is null and status <> 'cancelled'
                       and (total_cents > 0 or exists (select 1 from public.order_lines l where l.restaurant_id = public.orders.restaurant_id and l.order_id = public.orders.id))),
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

notify pgrst, 'reload schema';
