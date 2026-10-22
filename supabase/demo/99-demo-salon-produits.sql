-- =============================================================================
-- DEMO: the products of "Salon Démo" (run after 98). For sale at the till, and for the salon's
-- own use, with a starting stock. Safe to run again: only adds what is missing.
-- =============================================================================
do $$
declare rid uuid; x record; pid uuid;
begin
  select id into rid from public.restaurants where slug = 'salon-demo';
  if rid is null then raise notice 'salon-demo not found: run 95 first'; return; end if;
  for x in select * from (values
      ('Shampoing kératine 250 ml', 'Soin', 'retail', 12000, 6000, 8, 3, 1),
      ('Masque réparateur 200 ml', 'Soin', 'retail', 18000, 9000, 5, 2, 2),
      ('Sérum anti-frisottis', 'Soin', 'retail', 15000, 7000, 2, 3, 3),
      ('Huile d’argan pure 50 ml', 'Soin', 'retail', 9000, 3500, 12, 4, 4),
      ('Cire coiffante homme', 'Barbe', 'retail', 7000, 3000, 6, 2, 5),
      ('Huile à barbe', 'Barbe', 'retail', 8000, 3500, 4, 2, 6),
      ('Tube couleur 6.1', 'Coloration', 'usage', null, 4500, 10, 4, 7),
      ('Oxydant 20 vol 1 L', 'Coloration', 'usage', null, 6000, 3, 1, 8),
      ('Papier mèches (boîte)', 'Coloration', 'usage', null, 8000, 2, 1, 9)
    ) v(name, category, kind, price, cost, stock, min_stock, sort) loop
    if not exists (select 1 from public.agenda_products where restaurant_id = rid and name = x.name) then
      insert into public.agenda_products (restaurant_id, name, category, kind, price_cents, cost_cents, min_stock, sort_order)
      values (rid, x.name, x.category, x.kind, x.price, x.cost, x.min_stock, x.sort) returning id into pid;
      insert into public.agenda_stock_moves (restaurant_id, product_id, kind, qty, note) values (rid, pid, 'start', x.stock, 'Démo');
    end if;
  end loop;
end $$;

select name, kind, stock from public.agenda_products where restaurant_id = (select id from public.restaurants where slug = 'salon-demo') order by sort_order;
