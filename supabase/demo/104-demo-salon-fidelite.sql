-- =============================================================================
-- DEMO: loyalty and packs for "Salon Démo" (run after 104). The loyalty card (a free blow-dry
-- after 8 paid visits) and two packs for sale. Safe to run again: only adds what is missing and
-- keeps a loyalty card the salon already set.
-- =============================================================================
do $$
declare rid uuid; x record;
begin
  select id into rid from public.restaurants where slug = 'salon-demo';
  if rid is null then raise notice 'salon-demo not found: run 95 first'; return; end if;
  update public.restaurants
     set agenda = coalesce(agenda, '{}'::jsonb) || jsonb_build_object('loyalty', jsonb_build_object('enabled', true, 'every', 8, 'type', 'amount', 'value', 80, 'name', 'Brushing offert'))
   where id = rid and not (coalesce(agenda, '{}'::jsonb) ? 'loyalty');
  for x in select * from (values
      ('5 brushings', 'Brushing', 5, 32000, 1),
      ('3 couleurs racines', 'Couleur racines', 3, 66000, 2)
    ) v(name, service, sessions, price, sort) loop
    insert into public.agenda_packs (restaurant_id, name, service_id, sessions, price_cents, sort_order)
    select rid, x.name, s.id, x.sessions, x.price, x.sort
      from public.agenda_services s
     where s.restaurant_id = rid and s.name ->> 'fr' = x.service
       and not exists (select 1 from public.agenda_packs p where p.restaurant_id = rid and p.name = x.name)
     limit 1;
  end loop;
end $$;
