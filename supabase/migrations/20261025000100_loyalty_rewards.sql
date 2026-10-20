-- =============================================================================
-- LOYALTY, step 2: several rewards, and products as rewards
--
-- restaurants.loyalty -> 'rewards' is a list (at most 8) of
--   {"id": "cafe", "kind": "item", "points": 50, "item_id": "<menu item>", "label": "Café"}   a free dish
--   {"id": "r20",  "kind": "discount", "points": 150, "cents": 5000}                          money off the bill
-- Without a list, the single reward of before (reward_points / reward_cents) keeps working as the only one,
-- so no restaurant changes until the owner sets up rewards.
-- A free dish is the price of ONE unit of that dish on the open order (the cheapest if it is there several
-- times): the guest must be ordering it. It uses the same order discount as a money reward, so a discount
-- and a reward still exclude each other, and the team report keeps ignoring loyalty rewards.
-- =============================================================================

alter table public.loyalty_ledger add column if not exists reward_name text check (length(reward_name) <= 80);

-- the rewards of a restaurant, the old single reward included
create or replace function app.loyalty_rewards(p_loyalty jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_loyalty -> 'rewards') = 'array' and jsonb_array_length(p_loyalty -> 'rewards') > 0 then p_loyalty -> 'rewards'
    else jsonb_build_array(jsonb_build_object('id', 'legacy', 'kind', 'discount',
           'points', greatest(1, coalesce((p_loyalty ->> 'reward_points')::int, 100)),
           'cents', greatest(0, coalesce((p_loyalty ->> 'reward_cents')::bigint, 5000))))
  end
$$;

-- what an owner may save in the list: the shape is checked here, whoever writes it
create or replace function app.loyalty_check()
returns trigger language plpgsql set search_path = '' as $$
declare rw jsonb; ids text[] := '{}'; k text;
begin
  if new.loyalty -> 'rewards' is null then return new; end if;
  if jsonb_typeof(new.loyalty -> 'rewards') <> 'array' or jsonb_array_length(new.loyalty -> 'rewards') > 8 then
    raise exception 'invalid rewards' using errcode = '22023';
  end if;
  for rw in select x from jsonb_array_elements(new.loyalty -> 'rewards') x loop
    k := rw ->> 'kind';
    if jsonb_typeof(rw) <> 'object' or coalesce(rw ->> 'id', '') !~ '^[a-z0-9_-]{1,24}$' or (rw ->> 'id') = any (ids)
       or coalesce(rw ->> 'points', '') !~ '^[0-9]{1,6}$' or (rw ->> 'points')::int < 1
       or length(coalesce(rw ->> 'label', '')) > 80 then
      raise exception 'invalid reward' using errcode = '22023';
    end if;
    ids := ids || (rw ->> 'id');
    if k = 'discount' then
      if coalesce(rw ->> 'cents', '') !~ '^[0-9]{1,9}$' or (rw ->> 'cents')::bigint < 1 then raise exception 'invalid reward' using errcode = '22023'; end if;
    elsif k = 'item' then
      if coalesce(rw ->> 'item_id', '') !~ '^[0-9a-f-]{36}$'
         or not exists (select 1 from public.menu_items where restaurant_id = new.id and id = (rw ->> 'item_id')::uuid) then
        raise exception 'invalid reward' using errcode = '22023';
      end if;
    else
      raise exception 'invalid reward' using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists restaurants_loyalty_check on public.restaurants;
create trigger restaurants_loyalty_check before insert or update of loyalty on public.restaurants
  for each row execute function app.loyalty_check();

-- use one reward on an open order: the discount is applied and the points are spent
create or replace function public.pos_redeem_reward(p_order_id uuid, p_reward_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.orders; r public.restaurants; c public.customers; rw jsonb; need int; val bigint; lbl text; item uuid;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if not coalesce((r.loyalty ->> 'enabled')::boolean, false) or not coalesce((r.loyalty ->> 'customers')::boolean, false) then
    perform app.fail('loyalty_off');
  end if;
  if o.customer_id is null then perform app.fail('no_customer'); end if;
  if o.discount_cents > 0 then perform app.fail('remove_discount_first'); end if;

  select x into rw from jsonb_array_elements(app.loyalty_rewards(r.loyalty)) x where x ->> 'id' = p_reward_id;
  if rw is null then perform app.fail('reward_not_found'); end if;
  need := greatest(1, (rw ->> 'points')::int);
  if rw ->> 'kind' = 'item' then
    item := (rw ->> 'item_id')::uuid;
    select min(unit_price_cents) into val from public.order_lines
     where restaurant_id = o.restaurant_id and order_id = o.id and menu_item_id = item;
    if val is null then perform app.fail('reward_item_not_in_order'); end if;
    lbl := coalesce(nullif(rw ->> 'label', ''), (select name ->> 'fr' from public.menu_items where restaurant_id = o.restaurant_id and id = item));
  else
    val := greatest(0, (rw ->> 'cents')::bigint);
  end if;
  -- the reward is for an order worth more than the reward (a 0 DH ticket cannot be paid)
  if o.subtotal_cents <= val then perform app.fail('order_too_small'); end if;

  select * into c from public.customers where restaurant_id = o.restaurant_id and id = o.customer_id for update;
  if c.points < need then perform app.fail('not_enough_points'); end if;
  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = points - need where id = c.id;
  insert into public.loyalty_ledger (restaurant_id, customer_id, order_id, points, reason, reward_name)
  values (o.restaurant_id, c.id, o.id, -need, 'redeem', lbl);
  update public.orders set discount_cents = val, discount_kind = 'loyalty', discount_by_staff_id = null where id = o.id
  returning * into o;
  return jsonb_build_object('ok', true, 'discount_cents', o.discount_cents, 'total_cents', o.total_cents, 'points', c.points - need);
end $$;
revoke all on function public.pos_redeem_reward(uuid, text) from public, anon;
grant execute on function public.pos_redeem_reward(uuid, text) to authenticated;

-- a till screen that is not updated yet still calls this: it uses the first money reward
create or replace function public.pos_redeem_points(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lo jsonb; rid text;
begin
  select loyalty into lo from public.restaurants where id = (select restaurant_id from public.orders where id = p_order_id);
  select x ->> 'id' into rid from jsonb_array_elements(app.loyalty_rewards(lo)) x where x ->> 'kind' = 'discount' limit 1;
  if rid is null then perform app.fail('reward_not_found'); end if;
  return public.pos_redeem_reward(p_order_id, rid);
end $$;

-- the customer's card: the list of rewards (a free dish comes with its name in every language and its photo)
create or replace function public.customer_card(p_slug text, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'branding', r.branding, 'languages', to_jsonb(r.languages)),
    'loyalty', jsonb_build_object(
      'enabled', coalesce((r.loyalty ->> 'enabled')::boolean, false),
      'per_dh', coalesce(r.loyalty -> 'per_dh', '10'::jsonb),
      'reward_points', coalesce(r.loyalty -> 'reward_points', '100'::jsonb),
      'reward_cents', coalesce(r.loyalty -> 'reward_cents', '5000'::jsonb),
      'rewards', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', x ->> 'id', 'kind', x ->> 'kind', 'points', (x ->> 'points')::int, 'cents', x -> 'cents',
                    'name', case when x ->> 'kind' = 'item' then coalesce(mi.name, jsonb_build_object('fr', x ->> 'label')) end,
                    'image_url', mi.image_url) order by (x ->> 'points')::int, x ->> 'id'), '[]'::jsonb)
                    from jsonb_array_elements(app.loyalty_rewards(r.loyalty)) x
                    left join public.menu_items mi on mi.restaurant_id = r.id and x ->> 'kind' = 'item' and mi.id::text = x ->> 'item_id')),
    'customer', jsonb_build_object(
      'name', nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''),
      'points', c.points, 'visits', c.visits, 'last_visit_at', c.last_visit_at),
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
