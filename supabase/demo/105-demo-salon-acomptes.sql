-- =============================================================================
-- DEMO: deposits for "Salon Démo" (run after 105). Deposits on, a deposit on the long colour
-- prestations, and one for every booking after 2 no-shows. Safe to run again: keeps settings the
-- salon already chose.
-- =============================================================================
do $$
declare rid uuid;
begin
  select id into rid from public.restaurants where slug = 'salon-demo';
  if rid is null then raise notice 'salon-demo not found: run 95 first'; return; end if;
  update public.restaurants
     set agenda = coalesce(agenda, '{}'::jsonb) || jsonb_build_object('deposit', jsonb_build_object('enabled', true, 'after_no_shows', 2, 'noshow_cents', 10000, 'hours', 24,
                    'note', 'Démo : réglez l’acompte au salon ou par virement, indiquez votre prénom dans le motif.'))
   where id = rid and not (coalesce(agenda, '{}'::jsonb) ? 'deposit');
  update public.agenda_services set deposit_cents = 15000
   where restaurant_id = rid and deposit_cents = 0 and name ->> 'fr' in ('Mèches balayage', 'Couleur racines');
end $$;
