-- =============================================================================
-- Customers sign themselves up with a QR code (counter, tables, tastings)
-- * The QR opens <menu>/<slug>?club (or ?club=<event key> for a tasting). The guest's phone fills in
--   the name and number; one tap signs up, with consent for WhatsApp messages (law 09-08).
-- * A tasting (signup_events) has its own QR; who signed up there is kept (signup_event_people),
--   also when the guest was already a customer.
-- * Only when the owner has switched the customer file on. At most 150 sign-ups per 10 minutes
--   per restaurant, so a script cannot fill the file.
-- =============================================================================

alter table public.customers
  add column if not exists source text check (source in ('qr', 'event')),
  add column if not exists signed_up_at timestamptz;

create table if not exists public.signup_events (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 80),
  event_date    date,
  key           text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  offer         text check (length(offer) <= 120),   -- shown on the success screen ("Une assiette offerte")
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, id)
);
create index if not exists signup_events_idx on public.signup_events (restaurant_id, created_at desc);
drop trigger if exists signup_events_same_tenant on public.signup_events;
create trigger signup_events_same_tenant before update on public.signup_events
  for each row execute function app.forbid_restaurant_change();

create table if not exists public.signup_event_people (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  event_id      uuid not null,
  customer_id   uuid not null,
  created_at    timestamptz not null default now(),
  primary key (event_id, customer_id),
  foreign key (restaurant_id, event_id) references public.signup_events (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete cascade
);

alter table public.signup_events enable row level security;
alter table public.signup_event_people enable row level security;
grant select, insert, update, delete on public.signup_events to authenticated;
grant select on public.signup_event_people to authenticated;
drop policy if exists signup_events_select on public.signup_events;
drop policy if exists signup_events_insert on public.signup_events;
drop policy if exists signup_events_update on public.signup_events;
drop policy if exists signup_events_delete on public.signup_events;
drop policy if exists signup_event_people_select on public.signup_event_people;
create policy signup_events_select on public.signup_events for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));
create policy signup_events_insert on public.signup_events for insert to authenticated
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy signup_events_update on public.signup_events for update to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy signup_events_delete on public.signup_events for delete to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));
create policy signup_event_people_select on public.signup_event_people for select to authenticated
  using (restaurant_id = any ((select app.my_restaurants('manager'))::uuid[]));

-- what the sign-up page shows (nothing personal)
create or replace function public.signup_info(p_slug text, p_event text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', r.name, 'branding', r.branding, 'languages', to_jsonb(r.languages),
    'enabled', coalesce((r.loyalty ->> 'customers')::boolean, false) and app.is_writable(r),
    'loyalty', case when coalesce((r.loyalty ->> 'enabled')::boolean, false)
                    then jsonb_build_object('reward_points', r.loyalty -> 'reward_points', 'reward_cents', r.loyalty -> 'reward_cents', 'per_dh', r.loyalty -> 'per_dh') end,
    'event', (select jsonb_build_object('name', e.name, 'offer', e.offer, 'active', e.active)
                from public.signup_events e where e.restaurant_id = r.id and e.key = p_event))
    from public.restaurants r
   where r.slug = lower(p_slug) and r.status <> 'cancelled'
$$;
revoke all on function public.signup_info(text, text) from public;
grant execute on function public.signup_info(text, text) to anon, authenticated;

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
  -- only what the guest typed comes back: someone typing another person's number learns nothing
  return jsonb_build_object('name', nm, 'existed', existed, 'again', again, 'event', e.name, 'offer', e.offer);
end $$;
revoke all on function public.customer_signup(text, text, text, boolean, text) from public;
grant execute on function public.customer_signup(text, text, text, boolean, text) to anon, authenticated;

notify pgrst, 'reload schema';
