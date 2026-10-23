-- =============================================================================
-- DEMO: till PINs for "Salon Démo" and "Spa Démo" (run after 95 and 107b)
-- So the demos can be shown on the till (caisse.amplifygrowthstudio.com): pick a name, type the PIN.
--   Salon Démo : Salma 1111 (manager), Imane 2222, Youssef 3333
--   Spa Démo   : Nora 1111 (manager), Samira 2222, Houda 3333, Zineb 4444
-- Demo PINs only: never use these for a real salon. Safe to run again (it sets the same PINs).
-- =============================================================================
do $$
declare x record;
begin
  for x in select * from (values
      ('salon-demo', 'Salma', '1111', 'manager'), ('salon-demo', 'Imane', '2222', 'staff'), ('salon-demo', 'Youssef', '3333', 'staff'),
      ('spa-demo', 'Nora', '1111', 'manager'), ('spa-demo', 'Samira', '2222', 'staff'), ('spa-demo', 'Houda', '3333', 'staff'), ('spa-demo', 'Zineb', '4444', 'staff')
    ) v(slug, name, pin, role) loop
    update public.staff s set role = x.role::public.staff_role, active = true
      from public.restaurants r where r.slug = x.slug and s.restaurant_id = r.id and s.name = x.name;
    insert into app.staff_pins (staff_id, pin_hash)
    select s.id, extensions.crypt(x.pin, extensions.gen_salt('bf', 8))
      from public.staff s join public.restaurants r on r.id = s.restaurant_id
     where r.slug = x.slug and s.name = x.name
    on conflict (staff_id) do update set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null;
  end loop;
end $$;

select r.name as zaak, s.name, s.role, (p.staff_id is not null) as pin_ok
  from public.staff s join public.restaurants r on r.id = s.restaurant_id left join app.staff_pins p on p.staff_id = s.id
 where r.slug in ('salon-demo', 'spa-demo') order by r.name, s.name;
