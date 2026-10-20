-- =============================================================================
-- LOYALTY, step 3: every reward used on a bill is its own record
--
-- Before: a reward was ONE discount on the whole bill (orders.discount_cents), so a second reward, a second free
-- dish, or taking a mistake back was not possible.
-- Now: public.order_rewards has one row per reward used on an open bill (which reward, which dish, how many points,
-- how much). The loyalty discount of the bill is the SUM of its active rows (orders.discount_kind stays 'loyalty',
-- so the reports keep ignoring it).
--   * restaurants.loyalty -> 'max_per_order' (1..10, default 1): how many rewards one bill can carry. Default 1 = nothing
--     changes for a restaurant until the owner raises it.
--   * A free dish belongs to one unit of that dish on the bill: never more free units than ordered units.
--   * The sum of the rewards always stays BELOW the bill (a 0 DH bill is a separate step).
--   * Any reward can be taken off an open bill that has no payment yet (pos_release_reward): the points come back.
--   * Points also come back when the bill is cancelled, when a manager discount replaces the rewards, when the
--     customer of the bill is changed, or when the dish of a free-dish reward / the bill itself becomes too small.
--   * A reward and a manager discount or promo code still exclude each other.
-- =============================================================================

create table if not exists public.order_rewards (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id      uuid not null,
  customer_id   uuid not null,   -- no foreign key on purpose, like orders.customer_id (right to be forgotten)
  reward_id     text not null,
  kind          text not null check (kind in ('item', 'discount')),
  menu_item_id  uuid,
  name          text check (length(name) <= 80),
  points        integer not null check (points > 0),
  cents         bigint not null check (cents >= 0),
  created_at    timestamptz not null default now(),
  released_at   timestamptz,     -- set when the reward is taken back (the row stays as history)
  foreign key (restaurant_id, order_id) references public.orders (restaurant_id, id) on delete cascade
);
create index if not exists order_rewards_order_idx on public.order_rewards (order_id) where released_at is null;
create index if not exists order_rewards_order_all_idx on public.order_rewards (restaurant_id, order_id);

alter table public.order_rewards enable row level security;
grant select on public.order_rewards to authenticated;
drop policy if exists order_rewards_select on public.order_rewards;
create policy order_rewards_select on public.order_rewards for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('device'))::uuid[]));

alter table public.loyalty_ledger add column if not exists order_reward_id uuid;
create index if not exists loyalty_ledger_reward_idx on public.loyalty_ledger (order_reward_id) where order_reward_id is not null;

-- open bills that already carry a reward (step 2 and before) get their record, so they can be taken back too
insert into public.order_rewards (restaurant_id, order_id, customer_id, reward_id, kind, name, points, cents)
select o.restaurant_id, o.id, o.customer_id, 'legacy', 'discount', l.reward_name, -l.points, o.discount_cents
  from public.orders o
  join lateral (select points, reward_name from public.loyalty_ledger
                 where restaurant_id = o.restaurant_id and order_id = o.id and reason = 'redeem'
                 order by created_at desc limit 1) l on true
 where o.closed_at is null and o.status <> 'cancelled' and o.discount_kind = 'loyalty' and o.discount_cents > 0
   and o.customer_id is not null and l.points < 0
   and not exists (select 1 from public.order_rewards z where z.order_id = o.id);
update public.loyalty_ledger l set order_reward_id = z.id
  from public.order_rewards z
 where z.reward_id = 'legacy' and l.order_id = z.order_id and l.reason = 'redeem' and l.order_reward_id is null;

-- ------------------------------------------------------------ taking rewards back
-- Points come back and the 'redeem' line of the ledger disappears (it never happened); the record stays as history.
create or replace function app.rewards_release(p_order_id uuid, p_only uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare x public.order_rewards; n int := 0;
begin
  for x in select * from public.order_rewards
            where order_id = p_order_id and released_at is null and (p_only is null or id = p_only)
            order by created_at desc, id for update loop
    perform set_config('app.loyalty_internal', 'on', true);
    update public.customers set points = points + x.points where restaurant_id = x.restaurant_id and id = x.customer_id;
    delete from public.loyalty_ledger where order_reward_id = x.id;
    update public.order_rewards set released_at = now() where id = x.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function app.rewards_release(uuid, uuid) from public, anon, authenticated;

-- Makes the discount of an open bill follow its rewards, and gives back what no longer fits.
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
  -- the rewards must stay below the bill: newest first until they fit
  sub := (select coalesce(sum(line_total_cents), 0) from public.order_lines where restaurant_id = o.restaurant_id and order_id = o.id);
  loop
    select coalesce(sum(cents), 0) into tot from public.order_rewards where order_id = o.id and released_at is null;
    exit when tot = 0 or tot < sub;
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

-- dishes added, removed or changed on a bill with rewards: check the rewards again
create or replace function app.order_lines_rewards()
returns trigger language plpgsql security definer set search_path = '' as $$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  if exists (select 1 from public.order_rewards where order_id = oid and released_at is null) then
    perform app.rewards_settle(oid);
  end if;
  return null;
end $$;
drop trigger if exists order_lines_rewards on public.order_lines;
create trigger order_lines_rewards after insert or update or delete on public.order_lines
  for each row execute function app.order_lines_rewards();

-- the bill is cancelled, a manager discount replaces the rewards, or another customer is attached: points go back
create or replace function app.orders_rewards_back()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.order_rewards where order_id = new.id and released_at is null) then return null; end if;
  if (new.status = 'cancelled' and old.status <> 'cancelled')
     or (old.discount_kind = 'loyalty' and new.discount_kind is distinct from 'loyalty')
     or (old.discount_kind = 'loyalty' and new.discount_kind = 'loyalty' and old.discount_cents > 0 and new.discount_cents = 0 and new.subtotal_cents > 0)
     or (new.customer_id is distinct from old.customer_id and new.closed_at is null) then
    perform app.rewards_release(new.id);
    perform app.rewards_settle(new.id);
  end if;
  return null;
end $$;
drop trigger if exists orders_rewards_back on public.orders;
create trigger orders_rewards_back after update on public.orders
  for each row execute function app.orders_rewards_back();

-- ------------------------------------------------------------ what an owner may save
create or replace function app.loyalty_check()
returns trigger language plpgsql set search_path = '' as $$
declare rw jsonb; ids text[] := '{}'; k text;
begin
  if new.loyalty ? 'max_per_order' and (jsonb_typeof(new.loyalty -> 'max_per_order') <> 'number'
     or (new.loyalty ->> 'max_per_order') !~ '^[0-9]{1,2}$' or (new.loyalty ->> 'max_per_order')::int not between 1 and 10) then
    raise exception 'invalid rewards' using errcode = '22023';
  end if;
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

-- ------------------------------------------------------------ the till
-- use one reward on an open bill: a record is added, the points are spent, the discount follows the records
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
  -- all rewards together must stay below the bill (a 0 DH ticket cannot be paid)
  if o.subtotal_cents <= sofar + val then perform app.fail('order_too_small'); end if;

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

-- take one reward off an open bill (a mistake at the till): the points come back
create or replace function public.pos_release_reward(p_order_reward_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x public.order_rewards; o public.orders; pts int;
begin
  select * into x from public.order_rewards where id = p_order_reward_id;
  if x.id is null then perform app.fail('not_found'); end if;
  select * into o from public.orders where restaurant_id = x.restaurant_id and id = x.order_id for update;
  perform app.require_role(o.restaurant_id, 'device', true);
  if o.closed_at is not null or o.status = 'cancelled' then perform app.fail('order_not_open'); end if;
  if x.released_at is not null then perform app.fail('reward_not_found'); end if;
  if exists (select 1 from public.payments where restaurant_id = o.restaurant_id and order_id = o.id) then
    perform app.fail('remove_payments_first');
  end if;
  perform app.rewards_release(o.id, x.id);
  perform app.rewards_settle(o.id);
  select * into o from public.orders where id = o.id;
  select points into pts from public.customers where restaurant_id = x.restaurant_id and id = x.customer_id;
  return jsonb_build_object('ok', true, 'discount_cents', o.discount_cents, 'total_cents', o.total_cents, 'points', pts);
end $$;
revoke all on function public.pos_release_reward(uuid) from public, anon;
grant execute on function public.pos_release_reward(uuid) to authenticated;

notify pgrst, 'reload schema';
