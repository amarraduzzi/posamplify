-- =============================================================================
-- CARD TERMINAL (TPE): what the terminal answered, kept with the card payment
--
-- The till sends the amount to the card terminal and waits for its answer. An approved card payment
-- keeps the terminal's answer: tpe_status 'approved', the bank's reference (authorisation or
-- transaction number), the last 4 digits and the brand of the card, which terminal. When the terminal
-- cannot be reached and the amount was typed on the terminal by hand, tpe_status is 'manual'.
-- A card payment typed in without any terminal link keeps tpe_status null, as before.
-- Never the card number: the terminal does not give it and we do not want it.
-- pos_pay_order accepts an optional "tpe" object on a card payment; everything else is unchanged.
-- =============================================================================

alter table public.payments
  add column if not exists tpe_status text check (tpe_status in ('approved', 'manual')),
  add column if not exists tpe_ref text check (length(tpe_ref) <= 64),
  add column if not exists card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  add column if not exists card_brand text check (length(card_brand) <= 20),
  add column if not exists tpe_terminal text check (length(tpe_terminal) <= 40);
alter table public.payments drop constraint if exists payments_tpe_card_only;
alter table public.payments add constraint payments_tpe_card_only check (tpe_status is null or method = 'card');

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
    -- what the card terminal answered: only on a card payment, never the card number itself
    if p ? 'tpe' and p -> 'tpe' <> 'null'::jsonb then
      if p ->> 'method' <> 'card' or jsonb_typeof(p -> 'tpe') <> 'object'
         or coalesce(p -> 'tpe' ->> 'status', '') not in ('approved', 'manual')
         or length(coalesce(p -> 'tpe' ->> 'ref', '')) > 64
         or coalesce(p -> 'tpe' ->> 'last4', '') !~ '^([0-9]{4})?$'
         or length(coalesce(p -> 'tpe' ->> 'brand', '')) > 20
         or length(coalesce(p -> 'tpe' ->> 'terminal', '')) > 40 then
        perform app.fail('invalid_request', 'tpe');
      end if;
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
    insert into public.payments (restaurant_id, order_id, method, amount_cents, tip_cents, staff_id,
                                 tpe_status, tpe_ref, card_last4, card_brand, tpe_terminal)
    values (o.restaurant_id, o.id, p ->> 'method', (p ->> 'amount_cents')::bigint,
            coalesce((p ->> 'tip_cents')::bigint, 0), coalesce(p_staff_id, o.staff_id),
            p -> 'tpe' ->> 'status', nullif(p -> 'tpe' ->> 'ref', ''), nullif(p -> 'tpe' ->> 'last4', ''),
            nullif(p -> 'tpe' ->> 'brand', ''), nullif(p -> 'tpe' ->> 'terminal', ''));
  end loop;
  return public.close_order(o.id, p_staff_id, p_buyer);
end $$;
revoke all on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) from public, anon;
grant execute on function public.pos_pay_order(uuid, jsonb, uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
