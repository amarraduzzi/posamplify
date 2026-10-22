-- =============================================================================
-- DEMO: "Spa Démo", to show Amplify Agenda to spas and instituts (run after 107)
--
-- A spa with its cabins (2 massage cabins, a hammam for 4, a laser), its prestations that need
-- them, its team (two for the hammam) and hours, online booking, and a deposit on the long treatments. No photos and no
-- website: online booking only. Link: <menu>/spa-demo?rdv
-- Safe to run again: it updates the spa and only adds what is missing.
-- =============================================================================
do $$
declare
  rid uuid; c1 uuid; c2 uuid; ham uuid; las uuid;
  s_ham uuid; s_gom uuid; s_mas uuid; s_pie uuid; s_vis uuid; s_las uuid;
begin
  select id into rid from public.restaurants where slug = 'spa-demo';
  if rid is null then
    insert into public.restaurants (slug, name, is_demo, status, products, timezone, languages, city)
    values ('spa-demo', 'Spa Démo', true, 'active', '{agenda}', 'Africa/Casablanca', '{fr,ar,en}', 'Rabat')
    returning id into rid;
  end if;
  update public.restaurants set
    name = 'Spa Démo', is_demo = true, status = 'active', products = '{agenda}', languages = '{fr,ar,en}', city = 'Rabat', address = 'Souissi',
    opening_hours = '{"mon": [["10:00","21:00"]], "tue": [["10:00","21:00"]], "wed": [["10:00","21:00"]], "thu": [["10:00","21:00"]], "fri": [["10:00","21:00"]], "sat": [["09:00","21:00"]], "sun": [["09:00","19:00"]]}',
    branding = coalesce(branding, '{}'::jsonb) || jsonb_build_object('primary_color', '#2F6F62',
      'tagline', jsonb_build_object('fr', 'Hammam, massages et soins à Souissi', 'ar', 'حمام، تدليك وعناية في السويسي', 'en', 'Hammam, massages and care in Souissi')),
    agenda = coalesce(agenda, '{}'::jsonb) || '{"enabled": true, "auto_confirm": true, "step": 15, "lead_minutes": 120, "days_ahead": 45, "cancel_hours": 24, "any_staff": true}'::jsonb
             || case when coalesce(agenda, '{}'::jsonb) ? 'deposit' then '{}'::jsonb
                     else '{"deposit": {"enabled": true, "after_no_shows": 1, "noshow_cents": 10000, "hours": 24, "note": "Démo : réglez l’acompte au spa ou par virement."}}'::jsonb end
  where id = rid;

  -- the cabins and machines
  if not exists (select 1 from public.agenda_resources where restaurant_id = rid) then
    insert into public.agenda_resources (restaurant_id, name, kind, capacity, sort_order) values
      (rid, 'Cabine Atlas', 'cabin', 1, 1), (rid, 'Cabine Oasis', 'cabin', 1, 2), (rid, 'Hammam', 'room', 4, 3), (rid, 'Laser', 'equipment', 1, 4);
  end if;
  select id into c1 from public.agenda_resources where restaurant_id = rid and name = 'Cabine Atlas';
  select id into c2 from public.agenda_resources where restaurant_id = rid and name = 'Cabine Oasis';
  select id into ham from public.agenda_resources where restaurant_id = rid and name = 'Hammam';
  select id into las from public.agenda_resources where restaurant_id = rid and name = 'Laser';

  if not exists (select 1 from public.agenda_services where restaurant_id = rid) then
    insert into public.agenda_services (restaurant_id, name, category, duration_min, buffer_min, price_cents, price_from, sort_order, resource_ids, deposit_cents) values
      (rid, '{"fr":"Hammam traditionnel","ar":"حمام تقليدي","en":"Traditional hammam"}', 'Hammam', 60, 15, 18000, false, 1, array[ham], 0),
      (rid, '{"fr":"Hammam, gommage et enveloppement","ar":"حمام، تقشير ولف","en":"Hammam, scrub and wrap"}', 'Hammam', 90, 15, 35000, false, 2, array[ham], 10000),
      (rid, '{"fr":"Massage relaxant 60 min","ar":"تدليك استرخائي 60 دقيقة","en":"Relaxing massage 60 min"}', 'Massages', 60, 15, 40000, false, 3, array[c1, c2], 0),
      (rid, '{"fr":"Massage aux pierres chaudes","ar":"تدليك بالأحجار الساخنة","en":"Hot stone massage"}', 'Massages', 90, 15, 60000, false, 4, array[c1, c2], 15000),
      (rid, '{"fr":"Soin visage éclat","ar":"عناية بالوجه","en":"Glow facial"}', 'Soins', 60, 10, 35000, false, 5, array[c2], 0),
      (rid, '{"fr":"Épilation laser (zone)","ar":"إزالة الشعر بالليزر (منطقة)","en":"Laser hair removal (area)"}', 'Laser', 30, 10, 30000, true, 6, array[las], 0);
  end if;
  select id into s_ham from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Hammam traditionnel';
  select id into s_gom from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Hammam, gommage et enveloppement';
  select id into s_mas from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Massage relaxant 60 min';
  select id into s_pie from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Massage aux pierres chaudes';
  select id into s_vis from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Soin visage éclat';
  select id into s_las from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Épilation laser (zone)';

  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Nora') then insert into public.staff (restaurant_id, name, role) values (rid, 'Nora', 'staff'); end if;
  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Samira') then insert into public.staff (restaurant_id, name, role) values (rid, 'Samira', 'staff'); end if;
  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Houda') then insert into public.staff (restaurant_id, name, role) values (rid, 'Houda', 'staff'); end if;
  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Zineb') then insert into public.staff (restaurant_id, name, role) values (rid, 'Zineb', 'staff'); end if;
  update public.staff set agenda = true, active = true, agenda_color = '#2F6F62', agenda_sort = 0, agenda_services = array_remove(array[s_mas, s_pie, s_vis], null),
    agenda_hours = '{"mon": [["10:00","18:00"]], "tue": [["10:00","18:00"]], "wed": [["10:00","18:00"]], "thu": [["13:00","21:00"]], "fri": [["13:00","21:00"]], "sat": [["09:00","17:00"]]}'
   where restaurant_id = rid and name = 'Nora';
  update public.staff set agenda = true, active = true, agenda_color = '#C08A3E', agenda_sort = 1, agenda_services = array_remove(array[s_mas, s_pie, s_las], null),
    agenda_hours = '{"tue": [["13:00","21:00"]], "wed": [["13:00","21:00"]], "thu": [["10:00","18:00"]], "fri": [["10:00","18:00"]], "sat": [["13:00","21:00"]], "sun": [["09:00","19:00"]]}'
   where restaurant_id = rid and name = 'Samira';
  update public.staff set agenda = true, active = true, agenda_color = '#7A5BA6', agenda_sort = 2, agenda_services = array_remove(array[s_ham, s_gom], null),
    agenda_hours = '{"mon": [["10:00","21:00"]], "tue": [["10:00","21:00"]], "wed": [["10:00","21:00"]], "fri": [["10:00","21:00"]], "sat": [["09:00","21:00"]], "sun": [["09:00","19:00"]]}'
   where restaurant_id = rid and name = 'Houda';
  update public.staff set agenda = true, active = true, agenda_color = '#D16D7E', agenda_sort = 3, agenda_services = array_remove(array[s_ham, s_gom], null),
    agenda_hours = '{"mon": [["12:00","21:00"]], "wed": [["12:00","21:00"]], "thu": [["10:00","21:00"]], "fri": [["10:00","21:00"]], "sat": [["09:00","21:00"]], "sun": [["09:00","19:00"]]}'
   where restaurant_id = rid and name = 'Zineb';
end $$;

select slug, name, products, status from public.restaurants where slug = 'spa-demo';
