-- =============================================================================
-- DEMO: "Salon Démo", to show Amplify Agenda to the salons we visit
--
-- Creates (or refreshes) the demo salon with its prestations, its team and hours, online booking,
-- the Nouba and its website. The photos are AI images hosted on amplifygrowthstudio.com, for the
-- demo only. The website stays out of Google (site.enabled = false).
-- Links:  site.amplifygrowthstudio.com/salon-demo   (website)
--         <menu>/salon-demo?rdv                      (booking)   <menu>/salon-demo?nouba   (live queue)
-- Safe to run again: it updates the salon and only adds what is missing.
-- =============================================================================
do $$
declare
  img constant text := 'https://www.amplifygrowthstudio.com/img/demo-salon/';
  rid uuid; s_cut uuid; s_brush uuid; s_col uuid; s_bal uuid; s_men uuid; s_beard uuid; s_nails uuid;
begin
  select id into rid from public.restaurants where slug = 'salon-demo';
  if rid is null then
    insert into public.restaurants (slug, name, is_demo, status, products, timezone, languages, city)
    values ('salon-demo', 'Salon Démo', true, 'active', '{agenda,site}', 'UTC', '{fr,ar,en}', 'Rabat')
    returning id into rid;
  end if;

  update public.restaurants set
    name = 'Salon Démo', is_demo = true, status = 'active', products = '{agenda,site}', languages = '{fr,ar,en}',
    city = 'Rabat', address = 'Agdal',
    opening_hours = '{"tue": [["09:30","20:00"]], "wed": [["09:30","20:00"]], "thu": [["09:30","20:00"]], "fri": [["09:30","20:00"]], "sat": [["09:30","20:00"]], "sun": [["10:00","18:00"]]}',
    branding = coalesce(branding, '{}'::jsonb) || jsonb_build_object(
      'primary_color', '#8E3B4F',
      'cover_url', img || 'cover.webp',
      'tagline', jsonb_build_object('fr', 'Coupe, couleur et soins à Agdal', 'ar', 'قص وصباغة وعناية في أكدال', 'en', 'Cuts, colour and care in Agdal')),
    agenda = '{"enabled": true, "auto_confirm": true, "step": 15, "lead_minutes": 60, "days_ahead": 30, "cancel_hours": 3, "any_staff": true, "queue": true, "queue_remote": true, "queue_remote_max": 5, "queue_default_min": 30}',
    site = jsonb_build_object(
      'enabled', false,
      'about', jsonb_build_object(
        'fr', 'Un salon de quartier à Agdal : coupe, couleur et soins, sur rendez-vous ou sans attendre.',
        'ar', 'صالون الحي في أكدال: قص وصباغة وعناية، بموعد أو بدون انتظار.',
        'en', 'A neighbourhood salon in Agdal: cuts, colour and care, by appointment or walk-in.'),
      'gallery', jsonb_build_array(img || 'fauteuils.webp', img || 'bacs.webp', img || 'couleur.webp', img || 'accueil.webp'),
      'before_after', jsonb_build_array(
        jsonb_build_object('before', img || 'balayage-avant.webp', 'after', img || 'balayage-apres.webp', 'caption', 'Balayage', 'consent', true),
        jsonb_build_object('before', img || 'barbier-avant.webp', 'after', img || 'barbier-apres.webp', 'caption', 'Coupe et barbe', 'consent', true)))
  where id = rid;

  -- the prestations (only when the salon has none yet)
  if not exists (select 1 from public.agenda_services where restaurant_id = rid) then
    insert into public.agenda_services (restaurant_id, name, category, duration_min, buffer_min, price_cents, price_from, sort_order) values
      (rid, '{"fr":"Coupe et brushing","ar":"قص وتصفيف","en":"Cut and blow-dry"}', 'Coupe', 45, 10, 15000, false, 1),
      (rid, '{"fr":"Brushing","ar":"تصفيف","en":"Blow-dry"}', 'Coupe', 30, 5, 8000, true, 2),
      (rid, '{"fr":"Couleur racines","ar":"صباغة الجذور","en":"Root colour"}', 'Couleur', 90, 10, 25000, true, 3),
      (rid, '{"fr":"Mèches balayage","ar":"خصلات بالاياج","en":"Balayage highlights"}', 'Couleur', 150, 15, 60000, true, 4),
      (rid, '{"fr":"Coupe homme","ar":"قص رجالي","en":"Men''s cut"}', 'Barbe', 30, 0, 6000, false, 5),
      (rid, '{"fr":"Taille de barbe","ar":"تشذيب اللحية","en":"Beard trim"}', 'Barbe', 20, 0, 4000, false, 6),
      (rid, '{"fr":"Manucure semi-permanent","ar":"مانيكير شبه دائم","en":"Gel manicure"}', 'Ongles', 60, 5, 15000, false, 7);
  end if;
  select id into s_cut from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Coupe et brushing';
  select id into s_brush from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Brushing';
  select id into s_men from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Coupe homme';
  select id into s_beard from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Taille de barbe';
  select id into s_nails from public.agenda_services where restaurant_id = rid and name ->> 'fr' = 'Manucure semi-permanent';

  -- the team, with their hours and colours (only who is missing)
  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Salma') then
    insert into public.staff (restaurant_id, name, role) values (rid, 'Salma', 'staff');
  end if;
  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Imane') then
    insert into public.staff (restaurant_id, name, role) values (rid, 'Imane', 'staff');
  end if;
  if not exists (select 1 from public.staff where restaurant_id = rid and name = 'Youssef') then
    insert into public.staff (restaurant_id, name, role) values (rid, 'Youssef', 'staff');
  end if;
  update public.staff set agenda = true, active = true, agenda_color = '#E07A5F', agenda_sort = 0, agenda_services = '{}',
    agenda_hours = '{"tue": [["09:30","13:00"],["14:00","19:30"]], "wed": [["09:30","13:00"],["14:00","19:30"]], "thu": [["09:30","13:00"],["14:00","19:30"]], "fri": [["09:30","12:30"],["15:00","20:00"]], "sat": [["09:30","20:00"]]}'
   where restaurant_id = rid and name = 'Salma';
  update public.staff set agenda = true, active = true, agenda_color = '#3D8BFD', agenda_sort = 1, agenda_services = array_remove(array[s_cut, s_brush, s_nails], null),
    agenda_hours = '{"tue": [["10:00","19:00"]], "wed": [["10:00","19:00"]], "fri": [["10:00","20:00"]], "sat": [["09:30","20:00"]], "sun": [["10:00","18:00"]]}'
   where restaurant_id = rid and name = 'Imane';
  update public.staff set agenda = true, active = true, agenda_color = '#2BB673', agenda_sort = 2, agenda_services = array_remove(array[s_men, s_beard], null),
    agenda_hours = '{"tue": [["11:00","20:00"]], "wed": [["11:00","20:00"]], "thu": [["11:00","20:00"]], "sat": [["10:00","20:00"]], "sun": [["10:00","18:00"]]}'
   where restaurant_id = rid and name = 'Youssef';
end $$;

select slug, name, products, status from public.restaurants where slug = 'salon-demo';
