-- =============================================================================
-- GUEST PROFILE: what the team knows about a regular, where the team needs it
--
-- The customer file (customers, one per phone) gets what a good maître d' remembers:
--   allergies  shown in red everywhere and printed on every kitchen bon of the guest's orders
--   tags       VIP, Habitué, Végétarien... (up to 8 short words)
--   note       already there: preferences ("table près de la fenêtre", "eau pétillante")
-- The till sees the profile on the bill, on the floor plan and on the reservations; the
-- waiter can complete it during service (no PIN: it is service work, the audit log keeps who).
-- Nothing new for the customer: their own card page still shows no note and no allergy.
-- Everything only when the restaurant keeps a customer file (loyalty.customers on).
-- =============================================================================

alter table public.customers
  add column if not exists allergies text check (length(allergies) <= 200),
  add column if not exists tags text[] not null default '{}' check (cardinality(tags) <= 8);

-- the allergies of the order's guest, copied by the server when the guest is attached (and when
-- the profile changes while the order is open): the kitchen bon and the kitchen screen print it
alter table public.orders
  add column if not exists guest_alert text check (length(guest_alert) <= 200);

-- the till cannot read the customer file itself (managers only): the server looks it up
create or replace function app.customer_allergies(p_restaurant_id uuid, p_customer_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select nullif(btrim(c.allergies), '') from public.customers c where c.restaurant_id = p_restaurant_id and c.id = p_customer_id
$$;
revoke all on function app.customer_allergies(uuid, uuid) from public, anon;
grant execute on function app.customer_allergies(uuid, uuid) to authenticated;

create or replace function app.orders_guest_alert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.customer_id is distinct from old.customer_id then
    new.guest_alert := case when new.customer_id is null then null else app.customer_allergies(new.restaurant_id, new.customer_id) end;
  elsif new.guest_alert is distinct from old.guest_alert and app.is_client() then
    new.guest_alert := old.guest_alert; -- only the server writes it
  end if;
  return new;
end $$;
-- named after orders_customer: triggers of the same moment run in name order, so the guest is known
drop trigger if exists orders_customer_alert on public.orders;
create trigger orders_customer_alert before insert or update on public.orders
  for each row execute function app.orders_guest_alert();

-- the allergies change (at the till or in the back office) while the guest is eating: their open
-- orders follow, so the next kitchen bon prints the new ones
create or replace function app.customers_alert_open_orders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.orders set guest_alert = nullif(btrim(new.allergies), '')
   where restaurant_id = new.restaurant_id and customer_id = new.id and closed_at is null and status <> 'cancelled'
     and guest_alert is distinct from nullif(btrim(new.allergies), '');
  return null;
end $$;
drop trigger if exists customers_alert_open_orders on public.customers;
create trigger customers_alert_open_orders after update of allergies on public.customers
  for each row when (new.allergies is distinct from old.allergies) execute function app.customers_alert_open_orders();

-- what the till shows of a guest (never sent to the customer's own pages)
create or replace function app.guest_brief(c public.customers)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'visits', c.visits,
    'spent_cents', c.spent_cents, 'last_visit_at', c.last_visit_at, 'birthday', c.birthday,
    'tags', to_jsonb(c.tags), 'allergies', c.allergies, 'note', c.note)
$$;

-- the card the till already gets (find, attach, order customer) now carries the profile too
create or replace function app.customer_card(c public.customers, r public.restaurants)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'visits', c.visits)
      || jsonb_build_object('spent_cents', c.spent_cents, 'last_visit_at', c.last_visit_at, 'birthday', c.birthday,
                            'tags', to_jsonb(c.tags), 'allergies', c.allergies, 'note', c.note)
      || case when coalesce((r.loyalty ->> 'credit')::boolean, false) then
           jsonb_build_object('credit_allowed', c.credit_allowed, 'credit_limit_cents', c.credit_limit_cents,
                              'balance_cents', c.balance_cents)
         else '{}'::jsonb end
$$;

-- Several guests at once, for the floor plan (the guests of the open orders) and the reservations
-- (by phone). An empty list when the restaurant keeps no customer file: the till simply shows nothing.
create or replace function public.pos_guests(p_restaurant_id uuid, p_ids uuid[] default '{}', p_phones text[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then return '[]'::jsonb; end if;
  if coalesce(cardinality(p_ids), 0) > 200 or coalesce(cardinality(p_phones), 0) > 200 then perform app.fail('invalid_request', 'too_many'); end if;
  return coalesce((
    select jsonb_agg(app.guest_brief(c))
      from public.customers c
     where c.restaurant_id = r.id
       and (c.id = any (coalesce(p_ids, '{}'))
            or c.phone = any (select app.norm_phone(x) from unnest(coalesce(p_phones, '{}')) x))
  ), '[]'::jsonb);
end $$;

-- One guest in full: the profile, the dishes they order most, the last visits and the bookings.
create or replace function public.pos_guest(p_restaurant_id uuid, p_customer_id uuid default null, p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; c public.customers; ph text := app.norm_phone(p_phone);
begin
  r := app.require_role(p_restaurant_id, 'device', false);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  if p_customer_id is not null then
    select * into c from public.customers where restaurant_id = r.id and id = p_customer_id;
  elsif ph is not null then
    select * into c from public.customers where restaurant_id = r.id and phone = ph;
  end if;
  if c.id is null then return null; end if;
  return app.guest_brief(c) || jsonb_build_object(
    'favorites', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'qty', qty) order by qty desc, name)
        from (select l.name, sum(l.quantity)::int qty
                from public.order_lines l join public.orders o on o.id = l.order_id
               where o.restaurant_id = r.id and o.customer_id = c.id and o.status <> 'cancelled'
                 and l.unit_price_cents > 0
               group by l.name order by 2 desc, 1 limit 5) f), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('at', v.created_at, 'total_cents', v.total_cents, 'table', v.label) order by v.created_at desc)
        from (select o.created_at, o.total_cents, t.label
                from public.orders o left join public.dining_tables t on t.id = o.table_id
               where o.restaurant_id = r.id and o.customer_id = c.id and o.status <> 'cancelled' and o.closed_at is not null
               order by o.created_at desc limit 6) v), '[]'::jsonb),
    'bookings', (select jsonb_build_object('seated', count(*) filter (where status = 'seated'),
                                           'no_shows', count(*) filter (where status = 'no_show'),
                                           'cancelled', count(*) filter (where status = 'cancelled'))
                   from public.reservations where restaurant_id = r.id and phone = c.phone));
end $$;

-- The till completes the profile. A guest who is not in the file yet (a first booking) is added by phone.
-- The form sends everything it shows: an empty field clears it.
create or replace function public.pos_guest_save(p_restaurant_id uuid, p_customer_id uuid, p_phone text, p_name text,
  p_note text, p_allergies text, p_tags text[], p_birthday date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; cid uuid := p_customer_id; tg text[]; al text;
begin
  r := app.require_role(p_restaurant_id, 'device', true);
  if not coalesce((r.loyalty ->> 'customers')::boolean, false) then perform app.fail('customers_off'); end if;
  if length(coalesce(p_name, '')) > 60 or length(coalesce(p_note, '')) > 300 or length(coalesce(p_allergies, '')) > 200
     or coalesce(cardinality(p_tags), 0) > 8 then perform app.fail('invalid_request', 'too_long'); end if;
  select coalesce(array_agg(x order by min_i), '{}') into tg
    from (select btrim(x) x, min(i) min_i from unnest(coalesce(p_tags, '{}')) with ordinality u(x, i)
           where btrim(x) <> '' group by btrim(x)) s;
  if exists (select 1 from unnest(tg) x where length(x) > 20) then perform app.fail('invalid_request', 'tag'); end if;
  if p_birthday is not null and (p_birthday > current_date or p_birthday < date '1900-01-01') then perform app.fail('invalid_request', 'birthday'); end if;
  if cid is null then
    cid := app.customer_for(r.id, p_phone, p_name);
    if cid is null then perform app.fail('invalid_phone'); end if;
  elsif not exists (select 1 from public.customers where restaurant_id = r.id and id = cid) then
    perform app.fail('not_found');
  end if;
  al := nullif(btrim(coalesce(p_allergies, '')), '');
  update public.customers set
         name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         note = nullif(btrim(coalesce(p_note, '')), ''),
         allergies = al, tags = tg,
         birthday = coalesce(p_birthday, birthday)
   where restaurant_id = r.id and id = cid;
  return public.pos_guest(r.id, cid, null);
end $$;

revoke all on function public.pos_guests(uuid, uuid[], text[]) from public, anon;
revoke all on function public.pos_guest(uuid, uuid, text) from public, anon;
revoke all on function public.pos_guest_save(uuid, uuid, text, text, text, text, text[], date) from public, anon;
grant execute on function public.pos_guests(uuid, uuid[], text[]) to authenticated;
grant execute on function public.pos_guest(uuid, uuid, text) to authenticated;
grant execute on function public.pos_guest_save(uuid, uuid, text, text, text, text, text[], date) to authenticated;

-- the back office edits allergies and tags like the other columns of the file (managers, by RLS)
grant update (allergies, tags) on public.customers to authenticated;

notify pgrst, 'reload schema';
