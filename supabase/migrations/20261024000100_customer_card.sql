-- =============================================================================
-- LOYALTY, step 1: the customer's own points card (a private link, no app)
--
-- Every customer gets a secret key (card_key). The link <menu>/<slug>?carte=<key> shows him his points,
-- how far he is from the reward and his last visits. The key is the only way in: a phone number alone
-- never opens a card, so nobody can look up somebody else's points.
--   * the key is given to the guest when HE signs up with the QR (a new customer only: someone who types an
--     existing number gets nothing back, as before), and the owner can send it by WhatsApp from the
--     customer's file (existing customers, imported customers);
--   * the card shows the first name, the points, the visits and the last movements: no phone, no spending,
--     no note, no birthday;
--   * nothing changes for a restaurant that has not switched the customer file on.
-- =============================================================================

alter table public.customers
  add column if not exists card_key text not null default app.random_token(16);
create unique index if not exists customers_card_key_idx on public.customers (card_key);

-- what the card page shows. null = wrong key or wrong restaurant (the page says "card not found").
create or replace function public.customer_card(p_slug text, p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('name', r.name, 'branding', r.branding, 'languages', to_jsonb(r.languages)),
    'loyalty', jsonb_build_object(
      'enabled', coalesce((r.loyalty ->> 'enabled')::boolean, false),
      'per_dh', coalesce(r.loyalty -> 'per_dh', '10'::jsonb),
      'reward_points', coalesce(r.loyalty -> 'reward_points', '100'::jsonb),
      'reward_cents', coalesce(r.loyalty -> 'reward_cents', '5000'::jsonb)),
    'customer', jsonb_build_object(
      'name', nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''),
      'points', c.points, 'visits', c.visits, 'last_visit_at', c.last_visit_at),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('points', l.points, 'reason', l.reason, 'at', l.created_at) order by l.created_at desc)
                          from (select points, reason, created_at from public.loyalty_ledger
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

-- the QR sign-up: same as before, and a NEW customer also gets the key of his card
create or replace function public.customer_signup(p_slug text, p_name text, p_phone text, p_consent boolean, p_event text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants; e public.signup_events; c public.customers; ph text; nm text; existed boolean; again boolean := false;
begin
  select * into r from public.restaurants where slug = lower(p_slug) and status <> 'cancelled';
  if r.id is null then perform app.fail('not_found'); end if;
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) or not app.is_writable(r) then perform app.fail('signup_off'); end if;
  ph := app.norm_phone(p_phone);
  nm := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  if ph is null or ph !~ '^[0-9]{9,15}$' or nm is null or length(nm) > 60 then perform app.fail('customer_required'); end if;
  if p_event is not null then
    select * into e from public.signup_events where restaurant_id = r.id and key = p_event;
    if e.id is null or not e.active then perform app.fail('event_closed'); end if;
  end if;
  if (select count(*) from public.customers where restaurant_id = r.id and signed_up_at > now() - interval '10 minutes') >= 150 then
    perform app.fail('rate_limited');
  end if;

  select * into c from public.customers where restaurant_id = r.id and phone = ph;
  existed := c.id is not null;
  if existed then
    -- an existing customer: fill the name if it was empty; consent only ever turns on here
    update public.customers set name = coalesce(name, nm), marketing_ok = marketing_ok or coalesce(p_consent, false),
           signed_up_at = coalesce(signed_up_at, now())
     where id = c.id returning * into c;
  else
    insert into public.customers (restaurant_id, phone, name, marketing_ok, source, signed_up_at)
    values (r.id, ph, nm, coalesce(p_consent, false), case when e.id is null then 'qr' else 'event' end, now())
    returning * into c;
  end if;
  if e.id is not null then
    insert into public.signup_event_people (restaurant_id, event_id, customer_id) values (r.id, e.id, c.id) on conflict do nothing;
    again := not found;   -- already signed up at this tasting: the staff should not give the offer twice
  end if;
  -- only what the guest typed comes back, plus the key of the card he has just created: someone typing
  -- another person's number learns nothing (an existing customer gets no key)
  return jsonb_build_object('name', nm, 'existed', existed, 'again', again, 'event', e.name, 'offer', e.offer,
                            'card_key', case when existed then null else c.card_key end);
end $$;
revoke all on function public.customer_signup(text, text, text, boolean, text) from public;
grant execute on function public.customer_signup(text, text, text, boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';
