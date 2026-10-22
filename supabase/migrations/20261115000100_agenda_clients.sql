-- =============================================================================
-- AMPLIFY AGENDA (7): the client card of the salon
--
-- The salon's clients are the same customers as everywhere in Amplify (one list per business, by
-- phone). An appointment with a number puts the client in the list; a finished appointment counts
-- as a visit (and what it cost). The card shows the history, the no-shows, the notes and tags, and
-- the colour formulas: what was used, by whom, when (so the next colour is the same).
-- =============================================================================

create table if not exists public.agenda_formulas (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  customer_id    uuid not null,
  appointment_id uuid,
  staff_id       uuid,
  service        text check (length(service) <= 60),
  formula        text not null check (length(btrim(formula)) between 1 and 500),
  note           text check (length(note) <= 300),
  created_at     timestamptz not null default now(),
  foreign key (restaurant_id, customer_id) references public.customers (restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, appointment_id) references public.agenda_appointments (restaurant_id, id) on delete set null (appointment_id),
  foreign key (restaurant_id, staff_id) references public.staff (restaurant_id, id) on delete set null (staff_id)
);
create index if not exists agenda_formulas_idx on public.agenda_formulas (restaurant_id, customer_id, created_at desc);
drop trigger if exists agenda_formulas_same_tenant on public.agenda_formulas;
create trigger agenda_formulas_same_tenant before update on public.agenda_formulas
  for each row execute function app.forbid_restaurant_change();
alter table public.agenda_formulas enable row level security;
grant select, insert, update, delete on public.agenda_formulas to authenticated;
drop policy if exists agenda_formulas_all on public.agenda_formulas;
create policy agenda_formulas_all on public.agenda_formulas for all to authenticated
  using (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]))
  with check (restaurant_id = any ((select app.my_writable_restaurants('manager'))::uuid[]));

-- the appointment puts the client in the list; "done" counts the visit (the trigger runs for the
-- salon's screen and for the online booking alike, so it reads and writes the list itself)
create or replace function app.agenda_appointments_client()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.phone is null then return new; end if;
  insert into public.customers (restaurant_id, phone, name)
  values (new.restaurant_id, new.phone, left(new.name, 60))
  on conflict (restaurant_id, phone) do update set name = coalesce(public.customers.name, excluded.name);
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    update public.customers set visits = visits + 1, spent_cents = spent_cents + new.price_cents,
           first_visit_at = coalesce(first_visit_at, new.starts_at),
           last_visit_at = greatest(coalesce(last_visit_at, new.starts_at), new.starts_at)
     where restaurant_id = new.restaurant_id and phone = new.phone;
  end if;
  return new;
end $$;
drop trigger if exists agenda_appointments_client on public.agenda_appointments;
create trigger agenda_appointments_client after insert or update of status, phone on public.agenda_appointments
  for each row execute function app.agenda_appointments_client();

-- the clients of the salon: search by name or number, with the last and next visit
create or replace function public.agenda_clients(p_restaurant_id uuid, p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(btrim(p_q), ''); d text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  return coalesce((select jsonb_agg(x order by x ->> 'last' desc nulls last, x ->> 'name') from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'tags', c.tags, 'visits', c.visits,
             'last', c.last_visit_at,
             'next', (select min(a.starts_at) from public.agenda_appointments a where a.restaurant_id = c.restaurant_id and a.phone = c.phone
                        and a.status in ('requested', 'confirmed') and a.starts_at > now()),
             'no_shows', (select count(*) from public.agenda_appointments a where a.restaurant_id = c.restaurant_id and a.phone = c.phone and a.status = 'no_show'),
             'formulas', (select count(*) from public.agenda_formulas f where f.customer_id = c.id)) x
      from public.customers c
     where c.restaurant_id = p_restaurant_id
       and exists (select 1 from public.agenda_appointments a where a.restaurant_id = c.restaurant_id and a.phone = c.phone)
       and (q is null or c.name ilike '%' || q || '%' or (length(d) >= 3 and c.phone like '%' || d || '%'))
     limit 200) s), '[]'::jsonb);
end $$;

-- one client's card: the client, the visits, the formulas
create or replace function public.agenda_client(p_restaurant_id uuid, p_phone text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.customers; ph text := app.norm_phone(p_phone);
begin
  perform app.require_role(p_restaurant_id, 'manager', false);
  select * into c from public.customers where restaurant_id = p_restaurant_id and phone = ph;
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'note', c.note, 'tags', c.tags, 'allergies', c.allergies, 'birthday', c.birthday,
    'visits', c.visits, 'spent_cents', c.spent_cents, 'first', c.first_visit_at, 'last', c.last_visit_at,
    'no_shows', (select count(*) from public.agenda_appointments where restaurant_id = c.restaurant_id and phone = c.phone and status = 'no_show'),
    'cancelled', (select count(*) from public.agenda_appointments where restaurant_id = c.restaurant_id and phone = c.phone and status = 'cancelled'),
    'appointments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'status', a.status, 'service', a.service_name,
                                'duration_min', a.duration_min, 'price_cents', a.price_cents, 'staff_id', a.staff_id, 'note', a.note) order by a.starts_at desc)
       from (select * from public.agenda_appointments where restaurant_id = c.restaurant_id and phone = c.phone order by starts_at desc limit 40) a), '[]'::jsonb),
    'formulas', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'created_at', f.created_at, 'service', f.service, 'formula', f.formula,
                            'note', f.note, 'staff_id', f.staff_id, 'appointment_id', f.appointment_id) order by f.created_at desc)
       from public.agenda_formulas f where f.customer_id = c.id), '[]'::jsonb));
end $$;
revoke all on function public.agenda_clients(uuid, text) from public, anon;
revoke all on function public.agenda_client(uuid, text) from public, anon;
grant execute on function public.agenda_clients(uuid, text) to authenticated;
grant execute on function public.agenda_client(uuid, text) to authenticated;

-- the clients already booked before this part: put them in the list, count their finished visits
insert into public.customers (restaurant_id, phone, name)
select distinct on (a.restaurant_id, a.phone) a.restaurant_id, a.phone, left(a.name, 60)
  from public.agenda_appointments a where a.phone is not null
 order by a.restaurant_id, a.phone, a.created_at desc
on conflict (restaurant_id, phone) do nothing;

notify pgrst, 'reload schema';
