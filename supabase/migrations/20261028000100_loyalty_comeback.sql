-- =============================================================================
-- LOYALTY, step 3: a message to bring back the customers who no longer come
--
-- The owner sets it up in Customers > Fidélité (restaurants.loyalty.comeback, no new column for the settings):
--   days          after how many days without a visit a customer counts as "lost" (7 to 180, default 30)
--   mode          'invite' = an invitation only, 'offer' = an invitation with an offer
--   offer         the offer in words (for example "un café offert"), kept by the owner at the till
--   bonus_points  an offer that is real in the system: points added to the card when the message is sent (0 to 1000)
--   message       the owner's own text instead of the standard one (optional, built in the admin app)
--
-- The message itself is sent by hand (a WhatsApp link, one customer at a time). What the database does:
--   * remembers when each customer was contacted (customers.comeback_at), so nobody gets the message twice in a row;
--   * adds the bonus points, once per absence: a second message to someone who has not been back gives no new points;
--   * only for customers who agreed to WhatsApp offers (marketing_ok) and only when the customer file is on.
-- The bonus comes from the saved settings, never from the caller, so a modified app cannot hand out more.
-- Nothing changes for a restaurant that does not use it.
-- =============================================================================

alter table public.customers add column if not exists comeback_at timestamptz;

create or replace function public.customer_comeback_sent(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers; r public.restaurants;
  cfg jsonb; bonus int := 0; fresh boolean;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(c.restaurant_id, 'manager', true);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('invalid_request', 'customers_off'); end if;
  if not c.marketing_ok then perform app.fail('invalid_request', 'no_consent'); end if;

  cfg := coalesce(r.loyalty -> 'comeback', '{}'::jsonb);
  -- a new absence: never contacted, or he came back since the last message
  fresh := c.comeback_at is null or (c.last_visit_at is not null and c.last_visit_at > c.comeback_at);
  if fresh and cfg ->> 'mode' = 'offer' and coalesce((r.loyalty ->> 'enabled')::boolean, false)
     and coalesce(cfg ->> 'bonus_points', '') ~ '^[0-9]{1,4}$' then
    bonus := least(1000, (cfg ->> 'bonus_points')::int);
  end if;

  -- the points trigger writes the 'adjust' line of the ledger
  update public.customers set comeback_at = now(), points = points + bonus where id = c.id;
  return jsonb_build_object('ok', true, 'bonus', bonus, 'points', c.points + bonus, 'at', now());
end $$;
revoke all on function public.customer_comeback_sent(uuid) from public, anon;
grant execute on function public.customer_comeback_sent(uuid) to authenticated;

-- ------------------------------------------------------------ what an owner may save
-- the same check as before (rewards, maximum per bill) plus the comeback settings
create or replace function app.loyalty_check()
returns trigger language plpgsql set search_path = '' as $$
declare rw jsonb; ids text[] := '{}'; k text; cb jsonb;
begin
  if new.loyalty ? 'max_per_order' and (jsonb_typeof(new.loyalty -> 'max_per_order') <> 'number'
     or (new.loyalty ->> 'max_per_order') !~ '^[0-9]{1,2}$' or (new.loyalty ->> 'max_per_order')::int not between 1 and 10) then
    raise exception 'invalid rewards' using errcode = '22023';
  end if;
  if new.loyalty ? 'comeback' then
    cb := new.loyalty -> 'comeback';
    if jsonb_typeof(cb) <> 'object'
       or (cb ? 'days' and (jsonb_typeof(cb -> 'days') <> 'number' or (cb ->> 'days') !~ '^[0-9]{1,3}$' or (cb ->> 'days')::int not between 7 and 180))
       or (cb ? 'mode' and (cb ->> 'mode') not in ('invite', 'offer'))
       or (cb ? 'bonus_points' and (jsonb_typeof(cb -> 'bonus_points') <> 'number' or (cb ->> 'bonus_points') !~ '^[0-9]{1,4}$' or (cb ->> 'bonus_points')::int > 1000))
       or (cb ? 'offer' and (jsonb_typeof(cb -> 'offer') <> 'string' or length(cb ->> 'offer') > 120))
       or (cb ? 'message' and (jsonb_typeof(cb -> 'message') <> 'string' or length(cb ->> 'message') > 500)) then
      raise exception 'invalid comeback' using errcode = '22023';
    end if;
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
