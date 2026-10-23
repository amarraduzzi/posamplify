-- LOYALTY savings: what is earned on a visit can be spent from the NEXT visit on (the next business day).
-- "Spendable" = the points minus what was earned today (earnings undone at the counter do not count).
-- Applies to the savings mode (cagnotte); the rewards of before keep their rules.
set lock_timeout = '10s';

create or replace function app.loyalty_spendable(r public.restaurants, c public.customers)
returns int language sql stable security definer set search_path = '' as $$
  select greatest(0, c.points - coalesce((
    select sum(l.points) from public.loyalty_ledger l
     where l.restaurant_id = r.id and l.customer_id = c.id and l.reason = 'earn' and l.points > 0 and l.undone_at is null
       and l.created_at >= now() - interval '2 days'
       and app.business_date(r, l.created_at) = app.business_date(r)), 0))::int
$$;
revoke all on function app.loyalty_spendable(public.restaurants, public.customers) from public;

-- for the till: the savings, what can be spent now, and what waits for tomorrow
create or replace function public.loyalty_spendable(p_restaurant_id uuid, p_customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c public.customers; sp int;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  select * into c from public.customers where restaurant_id = r.id and id = p_customer_id;
  if c.id is null then perform app.fail('not_found'); end if;
  sp := app.loyalty_spendable(r, c);
  return jsonb_build_object('points', c.points, 'spendable', sp, 'today', c.points - sp);
end $$;
revoke all on function public.loyalty_spendable(uuid, uuid) from public, anon;
grant execute on function public.loyalty_spendable(uuid, uuid) to authenticated;

-- the counter shows the same
CREATE OR REPLACE FUNCTION app.loyalty_counter_customer(r restaurants, c customers)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'visits', c.visits,
    'spendable', app.loyalty_spendable(r, c),
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'kind', x ->> 'kind', 'points', (x ->> 'points')::int,
               'cents', x -> 'cents', 'label', coalesce(nullif(x ->> 'label', ''), mi.name ->> 'fr'),
               'affordable', c.points >= (x ->> 'points')::int)
             order by (x ->> 'points')::int, x ->> 'id')
      from jsonb_array_elements(app.loyalty_rewards(r.loyalty)) x
      left join public.menu_items mi on x ->> 'kind' = 'item' and mi.restaurant_id = r.id and mi.id = (x ->> 'item_id')::uuid
    ), '[]'::jsonb),
    'wallet', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'label', w.label, 'source', w.source, 'expires_at', w.expires_at)
             order by w.created_at)
      from public.loyalty_wallet w
      where w.restaurant_id = r.id and w.customer_id = c.id and w.status = 'open' and (w.expires_at is null or w.expires_at > now())
    ), '[]'::jsonb))
$function$;
revoke all on function app.loyalty_counter_customer(public.restaurants, public.customers) from public;

create or replace function public.pos_redeem_value(p_order_id uuid, p_cents bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; c public.customers; sp int; need int; val bigint; sofar bigint; rid uuid; mn int;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if not coalesce((r.loyalty ->> 'enabled')::boolean, false) or not coalesce((r.loyalty ->> 'customers')::boolean, false) then
    perform app.fail('loyalty_off');
  end if;
  if not app.loyalty_is_value(r.loyalty) then perform app.fail('not_value_mode'); end if;
  if o.customer_id is null then perform app.fail('no_customer'); end if;
  if o.discount_cents > 0 and o.discount_kind is distinct from 'loyalty' then perform app.fail('remove_discount_first'); end if;
  if exists (select 1 from public.order_rewards where order_id = o.id and released_at is null and reward_id = 'value') then
    perform app.fail('already_used');
  end if;
  if p_cents is not null and (p_cents <= 0 or p_cents >= 100000000) then perform app.fail('invalid_request', 'cents'); end if;

  select * into c from public.customers where restaurant_id = o.restaurant_id and id = o.customer_id for update;
  if exists (select 1 from public.order_rewards where order_id = o.id and released_at is null and customer_id <> c.id) then
    perform app.fail('remove_discount_first');
  end if;
  mn := coalesce((r.loyalty ->> 'min_points')::int, 0);
  sp := app.loyalty_spendable(r, c);
  -- what was earned today waits for the next visit
  if sp <= 0 or sp < mn then perform app.fail(case when c.points > sp and c.points >= greatest(mn, 1) then 'earned_today' else 'not_enough_points' end); end if;

  select coalesce(sum(cents), 0) into sofar from public.order_rewards where order_id = o.id and released_at is null;
  val := least(sp::bigint * 100, o.subtotal_cents - sofar, coalesce(p_cents, 100000000));
  if val <= 0 then perform app.fail('order_too_small'); end if;
  need := ceil(val / 100.0)::int;

  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = points - need where id = c.id;
  insert into public.order_rewards (restaurant_id, order_id, customer_id, reward_id, kind, menu_item_id, name, points, cents)
  values (o.restaurant_id, o.id, c.id, 'value', 'discount', null, 'Cagnotte', need, val) returning id into rid;
  insert into public.loyalty_ledger (restaurant_id, customer_id, order_id, points, reason, reward_name, order_reward_id)
  values (o.restaurant_id, c.id, o.id, -need, 'redeem', 'Cagnotte', rid);
  update public.orders set discount_cents = sofar + val, discount_kind = 'loyalty', discount_by_staff_id = null where id = o.id
  returning * into o;
  return jsonb_build_object('ok', true, 'order_reward_id', rid, 'cents', val, 'discount_cents', o.discount_cents,
                            'total_cents', o.total_cents, 'points', c.points - need);
end $$;

create or replace function public.loyalty_counter_spend(p_restaurant_id uuid, p_customer_id uuid, p_cents bigint, p_staff_id uuid, p_pin text, p_client_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; c public.customers; sp int; res text; l public.loyalty_ledger; need int; lbl text; wid uuid; mn int;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, true);
  if p_client_id is null then perform app.fail('invalid_request', 'client_id'); end if;
  if not app.loyalty_is_value(r.loyalty) then perform app.fail('not_value_mode'); end if;

  select * into l from public.loyalty_ledger where restaurant_id = r.id and client_id = p_client_id;
  if l.id is not null then
    select * into c from public.customers where restaurant_id = r.id and id = l.customer_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'ledger_id', l.id, 'label', l.reward_name, 'customer', app.loyalty_counter_customer(r, c));
  end if;

  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;
  if p_cents is null or p_cents <= 0 or p_cents >= 100000000 then perform app.fail('invalid_request', 'cents'); end if;

  select * into c from public.customers where restaurant_id = r.id and id = p_customer_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  need := ceil(p_cents / 100.0)::int;
  mn := coalesce((r.loyalty ->> 'min_points')::int, 0);
  sp := app.loyalty_spendable(r, c);
  if sp < need or sp < mn then perform app.fail(case when c.points >= need and c.points >= mn then 'earned_today' else 'not_enough_points' end); end if;
  lbl := 'Cagnotte ' || rtrim(to_char(p_cents::numeric / 100, 'FM999999990.##'), '.') || ' DH';

  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = points - need where id = c.id returning * into c;
  insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason, reward_name, source, staff_id, client_id)
  values (r.id, c.id, -need, 'redeem', left(lbl, 80), 'counter', p_staff_id, p_client_id) returning * into l;
  wid := app.loyalty_wallet_add(r.id, c.id, 'points', jsonb_build_object('id', 'value', 'kind', 'discount', 'points', need, 'cents', p_cents),
                                lbl, null, p_staff_id, l.id);
  return jsonb_build_object('ok', true, 'ledger_id', l.id, 'wallet_id', wid, 'label', lbl, 'customer', app.loyalty_counter_customer(r, c));
end $$;

create or replace function public.customer_card(p_slug text, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'branding', r.branding, 'languages', to_jsonb(r.languages)),
    'loyalty', jsonb_build_object(
      'enabled', coalesce((r.loyalty ->> 'enabled')::boolean, false),
      'mode', coalesce(r.loyalty ->> 'mode', 'rewards'),
      'percent', r.loyalty -> 'percent',
      'min_points', coalesce(r.loyalty -> 'min_points', '0'::jsonb),
      'per_dh', coalesce(r.loyalty -> 'per_dh', '10'::jsonb),
      'reward_points', coalesce(r.loyalty -> 'reward_points', '100'::jsonb),
      'reward_cents', coalesce(r.loyalty -> 'reward_cents', '5000'::jsonb),
      'rewards', case when app.loyalty_is_value(r.loyalty) then '[]'::jsonb else
                 (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', x ->> 'id', 'kind', x ->> 'kind', 'points', (x ->> 'points')::int, 'cents', x -> 'cents',
                    'name', case when x ->> 'kind' = 'item' then coalesce(mi.name, jsonb_build_object('fr', x ->> 'label')) end,
                    'image_url', mi.image_url) order by (x ->> 'points')::int, x ->> 'id'), '[]'::jsonb)
                    from jsonb_array_elements(app.loyalty_rewards(r.loyalty)) x
                    left join public.menu_items mi on mi.restaurant_id = r.id and x ->> 'kind' = 'item' and mi.id::text = x ->> 'item_id') end,
      -- savings: the dishes of the menu up to the savings, and a few just above (what comes next)
      'menu', case when not app.loyalty_is_value(r.loyalty) then '[]'::jsonb else
              (select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'price_cents', m.price_cents, 'image_url', m.image_url) order by m.price_cents desc, m.name ->> 'fr'), '[]'::jsonb)
                 from (select mi.name, mi.price_cents, mi.image_url from public.menu_items mi
                        where mi.restaurant_id = r.id and mi.active and mi.available and not coalesce(mi.sold_by_weight, false)
                          and mi.price_cents > 0 and mi.price_cents <= app.loyalty_spendable(r, c)::bigint * 100
                        order by mi.price_cents desc limit 24) m) end,
      'next', case when not app.loyalty_is_value(r.loyalty) then '[]'::jsonb else
              (select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'price_cents', m.price_cents, 'image_url', m.image_url) order by m.price_cents), '[]'::jsonb)
                 from (select mi.name, mi.price_cents, mi.image_url from public.menu_items mi
                        where mi.restaurant_id = r.id and mi.active and mi.available and not coalesce(mi.sold_by_weight, false)
                          and mi.price_cents > app.loyalty_spendable(r, c)::bigint * 100
                        order by mi.price_cents limit 3) m) end),
    'customer', jsonb_build_object(
      'name', nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''),
      'points', c.points, 'spendable', app.loyalty_spendable(r, c), 'visits', c.visits, 'last_visit_at', c.last_visit_at),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'at', l.created_at, 'name', l.reward_name) order by l.created_at desc)
                          from (select points, reason, created_at, reward_name from public.loyalty_ledger
                                 where restaurant_id = r.id and customer_id = c.id and reason in ('earn', 'redeem')
                                 order by created_at desc limit 8) l), '[]'::jsonb))
    from public.restaurants r
    join public.customers c on c.restaurant_id = r.id
   where r.slug = lower(p_slug) and r.status <> 'cancelled'
     and coalesce((r.loyalty ->> 'customers')::boolean, false)
     and c.card_key = p_key
$$;
revoke all on function public.customer_card(text, text) from public;
grant execute on function public.customer_card(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
