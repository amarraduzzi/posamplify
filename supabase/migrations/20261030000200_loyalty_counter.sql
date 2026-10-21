-- =============================================================================
-- AMPLIFY FIDÉLITÉ, the counter without a till (built in the SQL editor on 20 October, brought into the code
-- on 21 October exactly as it runs in production)
--
--   * product "loyalty": can be given to a restaurant alone, or next to site / orders; included with pos.
--   * the counter screen (admin app): find a customer by phone, turn a bill amount into points (same per_dh rule
--     as the till), give a reward for points, undo an operation the same business day (manager PIN).
--     Every action asks a staff PIN; a retried request never counts twice (client_id); at most
--     counter_daily_max bills per customer per day (default 3, 1 to 20).
--   * loyalty_wallet: rewards a customer won and has not used yet, with an end date. The counter gives them
--     once (loyalty_wallet_use); a later mechanic (the wheel) adds them with app.loyalty_wallet_add().
--   * customer_card_wallet: the open rewards on the customer's card page.
-- =============================================================================

-- ------------------------------------------------------------ the product
create or replace function app.has_loyalty(r public.restaurants)
returns boolean language sql stable set search_path = '' as $$
  select 'pos' = any (r.products) or 'loyalty' = any (r.products)
$$;

alter table public.restaurants drop constraint if exists restaurants_products_check;
alter table public.restaurants add constraint restaurants_products_check
  check (products <@ array['pos', 'profit', 'site', 'orders', 'loyalty'] and cardinality(products) between 1 and 5);

CREATE OR REPLACE FUNCTION public.admin_create_restaurant(p_slug text, p_name text, p_owner_email text DEFAULT NULL::text, p_is_demo boolean DEFAULT false, p_products text[] DEFAULT '{pos,profit}'::text[], p_city text DEFAULT NULL::text, p_theme text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rid uuid; uid uuid; prods text[];
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders', 'loyalty'));
  if prods is null then prods := '{pos,profit}'; end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) and loyalty are included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if 'loyalty' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'loyalty'); end if;
  if p_theme is not null and p_theme not in ('nuit', 'riad', 'moderne', 'atelier') then perform app.fail('invalid_request', 'theme'); end if;
  insert into public.restaurants (slug, name, is_demo, products, city, site)
  values (lower(p_slug), left(btrim(p_name), 80), p_is_demo, prods, nullif(btrim(p_city), ''),
          case when p_theme is null then '{}'::jsonb else jsonb_build_object('theme', p_theme) end)
  returning id into rid;
  if p_owner_email is not null then
    select id into uid from auth.users where lower(email) = lower(p_owner_email);
    if uid is null then perform app.fail('user_not_found', p_owner_email); end if;
    insert into public.memberships (restaurant_id, user_id, role) values (rid, uid, 'owner');
  end if;
  return rid;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_set_products(p_restaurant_id uuid, p_products text[], p_pos_plan text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare prods text[]; r public.restaurants;
begin
  perform app.require_platform_admin();
  prods := (select array_agg(distinct x order by x) from unnest(p_products) x where x in ('pos', 'profit', 'site', 'orders', 'loyalty'));
  if prods is null then perform app.fail('invalid_request', 'products'); end if;
  -- the website is included with POS and Profit; orders (Amplify Commandes) and loyalty are included with POS
  if 'site' = any (prods) and ('pos' = any (prods) or 'profit' = any (prods)) then prods := array_remove(prods, 'site'); end if;
  if 'orders' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'orders'); end if;
  if 'loyalty' = any (prods) and 'pos' = any (prods) then prods := array_remove(prods, 'loyalty'); end if;
  if p_pos_plan is not null and p_pos_plan not in ('essentiel', 'restaurant') then perform app.fail('invalid_request', 'plan'); end if;
  update public.restaurants set products = prods, pos_plan = coalesce(p_pos_plan, pos_plan)
   where id = p_restaurant_id returning * into r;
  if r.id is null then perform app.fail('not_found'); end if;
  return jsonb_build_object('products', r.products, 'pos_plan', r.pos_plan,
    'devices', (select count(*) from public.memberships where restaurant_id = r.id and role = 'device'));
end $function$;

-- ------------------------------------------------------------ the points book: counter operations
alter table public.loyalty_ledger
  add column if not exists source text check (source = 'counter'),
  add column if not exists staff_id uuid,
  add column if not exists amount_cents bigint check (amount_cents is null or amount_cents > 0),
  add column if not exists client_id uuid,
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid,
  add column if not exists undoes_id bigint;
create unique index if not exists loyalty_ledger_client_uq on public.loyalty_ledger (restaurant_id, client_id) where client_id is not null;

-- ------------------------------------------------------------ the wallet
create table if not exists public.loyalty_wallet (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  customer_id      uuid not null,
  source           text not null check (source ~ '^[a-z0-9_]{1,24}$'),
  reward           jsonb not null check (jsonb_typeof(reward) = 'object'),
  label            text not null check (length(label) between 1 and 80),
  status           text not null default 'open' check (status in ('open', 'used', 'expired', 'cancelled')),
  expires_at       timestamptz,
  used_at          timestamptz,
  used_by_staff_id uuid,
  ledger_id        bigint,
  created_at       timestamptz not null default now(),
  unique (restaurant_id, id),
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete cascade
);
create index if not exists loyalty_wallet_idx on public.loyalty_wallet (restaurant_id, customer_id, status);
alter table public.loyalty_wallet enable row level security;
revoke all on public.loyalty_wallet from public, anon, authenticated;
grant select on public.loyalty_wallet to authenticated;
drop policy if exists loyalty_wallet_select on public.loyalty_wallet;
create policy loyalty_wallet_select on public.loyalty_wallet for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- ------------------------------------------------------------ the counter setting
CREATE OR REPLACE FUNCTION app.loyalty_counter_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.loyalty ? 'counter_daily_max' and (jsonb_typeof(new.loyalty -> 'counter_daily_max') <> 'number'
     or (new.loyalty ->> 'counter_daily_max') !~ '^[0-9]{1,2}$' or (new.loyalty ->> 'counter_daily_max')::int not between 1 and 20) then
    raise exception 'invalid counter' using errcode = '22023';
  end if;
  return new;
end $function$;
drop trigger if exists restaurants_loyalty_counter_check on public.restaurants;
create trigger restaurants_loyalty_counter_check before insert or update of loyalty on public.restaurants
  for each row execute function app.loyalty_counter_check();

-- ------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION app.loyalty_wallet_add(p_restaurant_id uuid, p_customer_id uuid, p_source text, p_reward jsonb, p_label text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_used_by uuid DEFAULT NULL::uuid, p_ledger_id bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare wid uuid;
begin
  insert into public.loyalty_wallet (restaurant_id, customer_id, source, reward, label, expires_at, status, used_at, used_by_staff_id, ledger_id)
  values (p_restaurant_id, p_customer_id, p_source, p_reward, left(btrim(p_label), 80), p_expires_at,
          case when p_used_by is null then 'open' else 'used' end,
          case when p_used_by is null then null else now() end, p_used_by, p_ledger_id)
  returning id into wid;
  return wid;
end $function$;

CREATE OR REPLACE FUNCTION app.loyalty_counter_customer(r restaurants, c customers)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'visits', c.visits,
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

CREATE OR REPLACE FUNCTION app.loyalty_counter_guard(p_restaurant_id uuid, p_writable boolean)
 RETURNS restaurants
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', p_writable);
  if not app.has_loyalty(r) then perform app.fail('loyalty_not_available'); end if;
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) or not coalesce((r.loyalty ->> 'enabled')::boolean, false) then
    perform app.fail('loyalty_off');
  end if;
  return r;
end $function$;

revoke all on function app.loyalty_wallet_add(uuid, uuid, text, jsonb, text, timestamptz, uuid, bigint) from public;
revoke all on function app.loyalty_counter_customer(public.restaurants, public.customers) from public;
revoke all on function app.loyalty_counter_guard(uuid, boolean) from public;

-- ------------------------------------------------------------ the counter
CREATE OR REPLACE FUNCTION public.loyalty_counter_find(p_restaurant_id uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; c public.customers;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, false);
  select * into c from public.customers where restaurant_id = r.id and phone = app.norm_phone(p_phone);
  if c.id is null then return null; end if;
  return app.loyalty_counter_customer(r, c);
end $function$;
revoke all on function public.loyalty_counter_find(uuid, text) from public, anon;
grant execute on function public.loyalty_counter_find(uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.loyalty_counter_recent(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, false);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'at', l.created_at, 'reason', l.reason, 'points', l.points, 'amount_cents', l.amount_cents,
             'reward', l.reward_name, 'customer', coalesce(c.name, c.phone), 'phone', c.phone,
             'staff', s.name, 'undone', l.undone_at is not null,
             'can_undo', l.undone_at is null and l.reason in ('earn', 'redeem')
                         and app.business_date(r, l.created_at) = app.business_date(r))
           order by l.created_at desc, l.id desc)
    from (select * from public.loyalty_ledger
           where restaurant_id = r.id and source = 'counter'
           order by created_at desc, id desc limit 30) l
    join public.customers c on c.restaurant_id = l.restaurant_id and c.id = l.customer_id
    left join public.staff s on s.restaurant_id = l.restaurant_id and s.id = l.staff_id
  ), '[]'::jsonb);
end $function$;
revoke all on function public.loyalty_counter_recent(uuid) from public, anon;
grant execute on function public.loyalty_counter_recent(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.loyalty_counter_earn(p_restaurant_id uuid, p_phone text, p_amount_cents bigint, p_staff_id uuid, p_pin text, p_client_id uuid, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; c public.customers; cid uuid; res text; l public.loyalty_ledger;
        per int; pts int; cap int; today int;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, true);
  if p_client_id is null then perform app.fail('invalid_request', 'client_id'); end if;
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 1000000 then perform app.fail('invalid_amount'); end if;

  -- a retry of the same request returns the first result, nothing is counted twice
  select * into l from public.loyalty_ledger where restaurant_id = r.id and client_id = p_client_id;
  if l.id is not null then
    select * into c from public.customers where restaurant_id = r.id and id = l.customer_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'ledger_id', l.id, 'points_added', l.points, 'customer', app.loyalty_counter_customer(r, c));
  end if;

  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;

  cid := app.customer_for(r.id, p_phone, p_name);
  if cid is null then perform app.fail('invalid_phone'); end if;
  select * into c from public.customers where restaurant_id = r.id and id = cid for update;

  per := greatest(1, coalesce((r.loyalty ->> 'per_dh')::int, 10));
  pts := floor(p_amount_cents / 100.0 / per)::int;
  if pts < 1 then perform app.fail('amount_too_small'); end if;

  cap := coalesce((r.loyalty ->> 'counter_daily_max')::int, 3);
  select count(*) into today from public.loyalty_ledger x
   where x.restaurant_id = r.id and x.customer_id = c.id and x.source = 'counter' and x.reason = 'earn' and x.undone_at is null
     and app.business_date(r, x.created_at) = app.business_date(r);
  if today >= cap then perform app.fail('daily_limit'); end if;

  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers
     set visits = visits + 1, spent_cents = spent_cents + p_amount_cents, points = points + pts,
         first_visit_at = coalesce(first_visit_at, now()), last_visit_at = now()
   where id = c.id returning * into c;
  insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason, source, staff_id, amount_cents, client_id)
  values (r.id, c.id, pts, 'earn', 'counter', p_staff_id, p_amount_cents, p_client_id) returning * into l;
  return jsonb_build_object('ok', true, 'ledger_id', l.id, 'points_added', pts, 'customer', app.loyalty_counter_customer(r, c));
end $function$;
revoke all on function public.loyalty_counter_earn(uuid, text, bigint, uuid, text, uuid, text) from public, anon;
grant execute on function public.loyalty_counter_earn(uuid, text, bigint, uuid, text, uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.loyalty_counter_redeem(p_restaurant_id uuid, p_customer_id uuid, p_reward_id text, p_staff_id uuid, p_pin text, p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; c public.customers; res text; l public.loyalty_ledger; rw jsonb;
        need int; lbl text; wid uuid;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, true);
  if p_client_id is null then perform app.fail('invalid_request', 'client_id'); end if;

  select * into l from public.loyalty_ledger where restaurant_id = r.id and client_id = p_client_id;
  if l.id is not null then
    select * into c from public.customers where restaurant_id = r.id and id = l.customer_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'ledger_id', l.id, 'label', l.reward_name, 'customer', app.loyalty_counter_customer(r, c));
  end if;

  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;

  select x into rw from jsonb_array_elements(app.loyalty_rewards(r.loyalty)) x where x ->> 'id' = p_reward_id;
  if rw is null then perform app.fail('reward_not_found'); end if;
  need := greatest(1, (rw ->> 'points')::int);
  lbl := coalesce(nullif(rw ->> 'label', ''),
    case when rw ->> 'kind' = 'item'
         then (select name ->> 'fr' from public.menu_items where restaurant_id = r.id and id = (rw ->> 'item_id')::uuid)
         else 'Remise ' || rtrim(to_char((rw ->> 'cents')::numeric / 100, 'FM999999990.##'), '.') || ' DH' end,
    'Récompense');

  select * into c from public.customers where restaurant_id = r.id and id = p_customer_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  if c.points < need then perform app.fail('not_enough_points'); end if;

  perform set_config('app.loyalty_internal', 'on', true);
  update public.customers set points = points - need where id = c.id returning * into c;
  insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason, reward_name, source, staff_id, client_id)
  values (r.id, c.id, -need, 'redeem', left(lbl, 80), 'counter', p_staff_id, p_client_id) returning * into l;
  -- given at once: the wallet keeps the trace (used, by whom, when)
  wid := app.loyalty_wallet_add(r.id, c.id, 'points', rw, lbl, null, p_staff_id, l.id);
  return jsonb_build_object('ok', true, 'ledger_id', l.id, 'wallet_id', wid, 'label', lbl, 'customer', app.loyalty_counter_customer(r, c));
end $function$;
revoke all on function public.loyalty_counter_redeem(uuid, uuid, text, uuid, text, uuid) from public, anon;
grant execute on function public.loyalty_counter_redeem(uuid, uuid, text, uuid, text, uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.loyalty_counter_undo(p_restaurant_id uuid, p_ledger_id bigint, p_staff_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; l public.loyalty_ledger; c public.customers; res text;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, true);
  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'manager');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;

  select * into l from public.loyalty_ledger where restaurant_id = r.id and id = p_ledger_id for update;
  if l.id is null or l.source is distinct from 'counter' or l.reason not in ('earn', 'redeem') then perform app.fail('not_found'); end if;
  if l.undone_at is not null then return jsonb_build_object('ok', false, 'error', 'already_undone'); end if;
  if app.business_date(r, l.created_at) <> app.business_date(r) then return jsonb_build_object('ok', false, 'error', 'too_late'); end if;

  select * into c from public.customers where restaurant_id = r.id and id = l.customer_id for update;
  perform set_config('app.loyalty_internal', 'on', true);
  if l.reason = 'earn' then
    -- the points must still be there: a customer who already spent them cannot be undone silently
    if c.points < l.points then return jsonb_build_object('ok', false, 'error', 'points_already_spent'); end if;
    update public.customers
       set points = points - l.points, visits = greatest(0, visits - 1), spent_cents = greatest(0, spent_cents - coalesce(l.amount_cents, 0))
     where id = c.id returning * into c;
  else
    update public.customers set points = points - l.points where id = c.id returning * into c;   -- l.points is negative: the points come back
    update public.loyalty_wallet set status = 'cancelled' where restaurant_id = r.id and ledger_id = l.id;
  end if;
  insert into public.loyalty_ledger (restaurant_id, customer_id, points, reason, source, staff_id, undoes_id)
  values (r.id, c.id, -l.points, 'adjust', 'counter', p_staff_id, l.id);
  update public.loyalty_ledger set undone_at = now(), undone_by = p_staff_id where id = l.id;
  return jsonb_build_object('ok', true, 'customer', app.loyalty_counter_customer(r, c));
end $function$;
revoke all on function public.loyalty_counter_undo(uuid, bigint, uuid, text) from public, anon;
grant execute on function public.loyalty_counter_undo(uuid, bigint, uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.loyalty_wallet_use(p_restaurant_id uuid, p_wallet_id uuid, p_staff_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.restaurants; w public.loyalty_wallet; c public.customers; res text;
begin
  r := app.loyalty_counter_guard(p_restaurant_id, true);
  res := app.check_staff_pin(r.id, p_staff_id, p_pin, 'staff');
  if res <> 'ok' then return jsonb_build_object('ok', false, 'error', res); end if;

  select * into w from public.loyalty_wallet where restaurant_id = r.id and id = p_wallet_id for update;
  if w.id is null then perform app.fail('not_found'); end if;
  if w.status = 'used' then return jsonb_build_object('ok', false, 'error', 'already_used'); end if;
  if w.status <> 'open' then return jsonb_build_object('ok', false, 'error', w.status); end if;
  if w.expires_at is not null and w.expires_at <= now() then
    update public.loyalty_wallet set status = 'expired' where id = w.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  update public.loyalty_wallet set status = 'used', used_at = now(), used_by_staff_id = p_staff_id where id = w.id;
  select * into c from public.customers where restaurant_id = r.id and id = w.customer_id;
  return jsonb_build_object('ok', true, 'label', w.label, 'customer', app.loyalty_counter_customer(r, c));
end $function$;
revoke all on function public.loyalty_wallet_use(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.loyalty_wallet_use(uuid, uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------ the customer's card: open rewards
CREATE OR REPLACE FUNCTION public.customer_card_wallet(p_slug text, p_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'label', w.label, 'expires_at', w.expires_at) order by w.created_at), '[]'::jsonb)
    from public.restaurants r
    join public.customers c on c.restaurant_id = r.id
    join public.loyalty_wallet w on w.restaurant_id = r.id and w.customer_id = c.id
   where r.slug = lower(p_slug) and r.status <> 'cancelled'
     and coalesce((r.loyalty ->> 'customers')::boolean, false)
     and c.card_key = p_key
     and w.status = 'open' and (w.expires_at is null or w.expires_at > now())
$function$;
revoke all on function public.customer_card_wallet(text, text) from public;
grant execute on function public.customer_card_wallet(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
