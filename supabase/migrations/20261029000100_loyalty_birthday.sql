-- =============================================================================
-- LOYALTY, step 4: a birthday message
--
-- Same idea as the comeback message (20261028000100): the owner sets it up (restaurants.loyalty.birthday), a button in
-- Customers > "Anniversaire ce mois" opens WhatsApp with the message, and the database remembers it.
--   offer         the gift in words (for example "un dessert offert"), honoured by the owner at the till
--   bonus_points  points added to the card when the message is sent (0 to 1000)
--   message       the owner's own text instead of the standard one (optional)
-- What the database does:
--   * the message is for the month of the birthday, once per year (customers.birthday_msg_at);
--   * the bonus points are given once per year, taken from the saved settings (never from the caller), and only
--     when the points are on;
--   * only for customers who agreed to WhatsApp offers, and only when the customer file is on.
-- =============================================================================

alter table public.customers add column if not exists birthday_msg_at timestamptz;

create or replace function public.customer_birthday_sent(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers; r public.restaurants;
  cfg jsonb; bonus int := 0; today date; fresh boolean;
begin
  select * into c from public.customers where id = p_customer_id for update;
  if c.id is null then perform app.fail('not_found'); end if;
  r := app.require_role(c.restaurant_id, 'manager', true);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('invalid_request', 'customers_off'); end if;
  if not c.marketing_ok then perform app.fail('invalid_request', 'no_consent'); end if;
  today := app.business_date(r);
  if c.birthday is null or extract(month from c.birthday) <> extract(month from today) then perform app.fail('invalid_request', 'not_this_month'); end if;

  cfg := coalesce(r.loyalty -> 'birthday', '{}'::jsonb);
  fresh := c.birthday_msg_at is null or extract(year from c.birthday_msg_at at time zone 'UTC') < extract(year from today);
  if fresh and coalesce((r.loyalty ->> 'enabled')::boolean, false) and coalesce(cfg ->> 'bonus_points', '') ~ '^[0-9]{1,4}$' then
    bonus := least(1000, (cfg ->> 'bonus_points')::int);
  end if;

  -- the points trigger writes the 'adjust' line of the ledger
  update public.customers set birthday_msg_at = now(), points = points + bonus where id = c.id;
  return jsonb_build_object('ok', true, 'bonus', bonus, 'points', c.points + bonus, 'at', now());
end $$;
revoke all on function public.customer_birthday_sent(uuid) from public, anon;
grant execute on function public.customer_birthday_sent(uuid) to authenticated;

-- ------------------------------------------------------------ what an owner may save (its own small check)
create or replace function app.loyalty_birthday_check()
returns trigger language plpgsql set search_path = '' as $$
declare b jsonb;
begin
  if new.loyalty ? 'birthday' then
    b := new.loyalty -> 'birthday';
    if jsonb_typeof(b) <> 'object'
       or (b ? 'bonus_points' and (jsonb_typeof(b -> 'bonus_points') <> 'number' or (b ->> 'bonus_points') !~ '^[0-9]{1,4}$' or (b ->> 'bonus_points')::int > 1000))
       or (b ? 'offer' and (jsonb_typeof(b -> 'offer') <> 'string' or length(b ->> 'offer') > 120))
       or (b ? 'message' and (jsonb_typeof(b -> 'message') <> 'string' or length(b ->> 'message') > 500)) then
      raise exception 'invalid birthday' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists restaurants_loyalty_birthday_check on public.restaurants;
create trigger restaurants_loyalty_birthday_check before insert or update of loyalty on public.restaurants
  for each row execute function app.loyalty_birthday_check();
