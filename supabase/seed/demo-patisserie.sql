-- =============================================================================
-- Demo: "Pâtisserie Les Oliviers (démo)", a FICTIONAL pâtisserie to show bakeries what Amplify does:
-- house preparations inside recipes (pâte levée feuilletée -> croissant), costs that follow the price
-- of butter, the production plan, catering orders (one confirmed for tomorrow, one quote).
-- Prices are plausible demo values, not real data. Run once in Supabase > SQL Editor; running it again
-- does nothing while the demo exists. Visible to platform admins; delete it from Plateforme when done.
-- No sales: ring a few up on the till to see the daily average appear in the production plan.
-- =============================================================================

create or replace function pg_temp.ing(rid uuid, n text, base text, punit text, pqty numeric, price numeric, cat text)
returns uuid language sql as $$
  insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, purchase_price_cents, category, price_estimated)
  values (rid, n, base, punit, pqty, round(price * 100), cat, false) returning id
$$;
create or replace function pg_temp.prep(rid uuid, n text, base text, yield numeric, ahead boolean)
returns uuid language sql as $$
  insert into public.ingredients (restaurant_id, name, base_unit, purchase_unit, purchase_qty, is_preparation, made_ahead, category)
  values (rid, n, base, 'fournée', yield, true, ahead, 'preparation') returning id
$$;
create or replace function pg_temp.pl(rid uuid, p uuid, g uuid, q numeric, s int)
returns void language sql as $$
  insert into public.preparation_lines (restaurant_id, preparation_id, ingredient_id, qty, sort_order) values (rid, p, g, q, s)
$$;
create or replace function pg_temp.item(rid uuid, cat uuid, n text, price numeric, s int)
returns uuid language sql as $$
  insert into public.menu_items (restaurant_id, category_id, name, price_cents, sort_order) values (rid, cat, jsonb_build_object('fr', n), round(price * 100), s) returning id
$$;
create or replace function pg_temp.rl(rid uuid, it uuid, g uuid, q numeric)
returns void language sql as $$
  insert into public.recipe_lines (restaurant_id, menu_item_id, ingredient_id, qty) values (rid, it, g, q)
$$;

do $$
declare
  rid uuid; c_vien uuid; c_pat uuid; c_mar uuid; c_bois uuid;
  farine uuid; beurre uuid; sucre uuid; oeufs uuid; lait uuid; creme uuid; amandes uuid; choco uuid; levure uuid; sel uuid;
  vanille uuid; fraises uuid; citrons uuid; maizena uuid; sglace uuid; cafe uuid; the uuid; menthe uuid; fleur uuid;
  feuil uuid; croiss uuid; pac uuid; minic uuid; cpat uuid; psuc uuid; tfraise uuid; tcitron uuid; corne uuid;
  i_croiss uuid; i_pac uuid; i_tf uuid; i_tc uuid; i_corne uuid; i_cafe uuid; i_creme uuid; i_the uuid;
  ct uuid; d date;
begin
  if exists (select 1 from public.restaurants where slug = 'patisserie-demo') then
    raise notice 'La démo existe déjà : rien à faire.'; return;
  end if;
  insert into public.restaurants (slug, name, is_demo, products, city)
  values ('patisserie-demo', 'Pâtisserie Les Oliviers (démo)', true, '{pos,profit}', 'Rabat') returning id into rid;
  d := app.business_date((select r from public.restaurants r where r.id = rid));

  insert into public.categories (restaurant_id, name, sort_order) values (rid, '{"fr":"Viennoiseries"}', 1) returning id into c_vien;
  insert into public.categories (restaurant_id, name, sort_order) values (rid, '{"fr":"Pâtisseries"}', 2) returning id into c_pat;
  insert into public.categories (restaurant_id, name, sort_order) values (rid, '{"fr":"Gâteaux marocains"}', 3) returning id into c_mar;
  insert into public.categories (restaurant_id, name, sort_order) values (rid, '{"fr":"Boissons"}', 4) returning id into c_bois;

  -- what is bought (demo prices in DH)
  farine  := pg_temp.ing(rid, 'Farine T55', 'g', 'kg', 1000, 9, 'epicerie');
  beurre  := pg_temp.ing(rid, 'Beurre doux', 'g', 'kg', 1000, 95, 'laitier');
  sucre   := pg_temp.ing(rid, 'Sucre', 'g', 'kg', 1000, 7, 'epicerie');
  oeufs   := pg_temp.ing(rid, 'Oeufs', 'pc', 'plateau de 30', 30, 39, 'laitier');
  lait    := pg_temp.ing(rid, 'Lait entier', 'ml', 'L', 1000, 8, 'laitier');
  creme   := pg_temp.ing(rid, 'Crème liquide 35 %', 'ml', 'L', 1000, 45, 'laitier');
  amandes := pg_temp.ing(rid, 'Amandes émondées', 'g', 'kg', 1000, 120, 'epicerie');
  choco   := pg_temp.ing(rid, 'Chocolat noir 55 %', 'g', 'kg', 1000, 140, 'epicerie');
  levure  := pg_temp.ing(rid, 'Levure boulangère', 'g', 'kg', 1000, 40, 'boulangerie');
  sel     := pg_temp.ing(rid, 'Sel', 'g', 'kg', 1000, 3, 'epicerie');
  vanille := pg_temp.ing(rid, 'Gousse de vanille', 'pc', 'pièce', 1, 15, 'epicerie');
  fraises := pg_temp.ing(rid, 'Fraises', 'g', 'kg', 1000, 25, 'fruits');
  citrons := pg_temp.ing(rid, 'Citrons', 'g', 'kg', 1000, 10, 'fruits');
  maizena := pg_temp.ing(rid, 'Maïzena', 'g', 'kg', 1000, 20, 'epicerie');
  sglace  := pg_temp.ing(rid, 'Sucre glace', 'g', 'kg', 1000, 14, 'epicerie');
  fleur   := pg_temp.ing(rid, 'Eau de fleur d''oranger', 'ml', 'L', 1000, 30, 'epicerie');
  cafe    := pg_temp.ing(rid, 'Café en grains', 'g', 'kg', 1000, 160, 'boissons');
  the     := pg_temp.ing(rid, 'Thé vert', 'g', 'kg', 1000, 120, 'boissons');
  menthe  := pg_temp.ing(rid, 'Menthe', 'pc', 'botte', 1, 3, 'legumes');

  -- house preparations: the dough and the cream are made on the spot, the pieces are made ahead (stock)
  feuil := pg_temp.prep(rid, 'Pâte levée feuilletée', 'g', 2100, false);
  perform pg_temp.pl(rid, feuil, farine, 1000, 0); perform pg_temp.pl(rid, feuil, beurre, 550, 1); perform pg_temp.pl(rid, feuil, lait, 450, 2);
  perform pg_temp.pl(rid, feuil, sucre, 110, 3); perform pg_temp.pl(rid, feuil, levure, 40, 4); perform pg_temp.pl(rid, feuil, sel, 20, 5);
  cpat := pg_temp.prep(rid, 'Crème pâtissière', 'g', 1300, false);
  perform pg_temp.pl(rid, cpat, lait, 1000, 0); perform pg_temp.pl(rid, cpat, oeufs, 8, 1); perform pg_temp.pl(rid, cpat, sucre, 200, 2);
  perform pg_temp.pl(rid, cpat, maizena, 80, 3); perform pg_temp.pl(rid, cpat, vanille, 1, 4);
  psuc := pg_temp.prep(rid, 'Pâte sucrée', 'g', 1300, false);
  perform pg_temp.pl(rid, psuc, farine, 600, 0); perform pg_temp.pl(rid, psuc, beurre, 360, 1); perform pg_temp.pl(rid, psuc, sglace, 225, 2);
  perform pg_temp.pl(rid, psuc, oeufs, 2, 3); perform pg_temp.pl(rid, psuc, amandes, 75, 4);

  croiss := pg_temp.prep(rid, 'Croissant', 'pc', 30, true);
  perform pg_temp.pl(rid, croiss, feuil, 2100, 0); perform pg_temp.pl(rid, croiss, oeufs, 2, 1);
  pac := pg_temp.prep(rid, 'Pain au chocolat', 'pc', 30, true);
  perform pg_temp.pl(rid, pac, feuil, 2100, 0); perform pg_temp.pl(rid, pac, choco, 180, 1); perform pg_temp.pl(rid, pac, oeufs, 2, 2);
  minic := pg_temp.prep(rid, 'Mini-croissant', 'pc', 60, true);
  perform pg_temp.pl(rid, minic, feuil, 1800, 0); perform pg_temp.pl(rid, minic, oeufs, 2, 1);
  tfraise := pg_temp.prep(rid, 'Tartelette aux fraises', 'pc', 12, true);
  perform pg_temp.pl(rid, tfraise, psuc, 600, 0); perform pg_temp.pl(rid, tfraise, cpat, 720, 1); perform pg_temp.pl(rid, tfraise, fraises, 900, 2);
  tcitron := pg_temp.prep(rid, 'Tartelette citron', 'pc', 12, true);
  perform pg_temp.pl(rid, tcitron, psuc, 600, 0); perform pg_temp.pl(rid, tcitron, citrons, 500, 1); perform pg_temp.pl(rid, tcitron, oeufs, 6, 2);
  perform pg_temp.pl(rid, tcitron, sucre, 300, 3); perform pg_temp.pl(rid, tcitron, beurre, 150, 4);
  corne := pg_temp.prep(rid, 'Corne de gazelle', 'pc', 40, true);
  perform pg_temp.pl(rid, corne, amandes, 500, 0); perform pg_temp.pl(rid, corne, sucre, 250, 1); perform pg_temp.pl(rid, corne, farine, 300, 2);
  perform pg_temp.pl(rid, corne, beurre, 60, 3); perform pg_temp.pl(rid, corne, fleur, 40, 4);

  -- the shop: one piece sold = one piece out of its stock
  i_croiss := pg_temp.item(rid, c_vien, 'Croissant', 8, 1);              perform pg_temp.rl(rid, i_croiss, croiss, 1);
  i_pac    := pg_temp.item(rid, c_vien, 'Pain au chocolat', 10, 2);      perform pg_temp.rl(rid, i_pac, pac, 1);
  i_tf     := pg_temp.item(rid, c_pat, 'Tartelette aux fraises', 35, 1); perform pg_temp.rl(rid, i_tf, tfraise, 1);
  i_tc     := pg_temp.item(rid, c_pat, 'Tartelette citron', 30, 2);      perform pg_temp.rl(rid, i_tc, tcitron, 1);
  i_corne  := pg_temp.item(rid, c_mar, 'Corne de gazelle', 6, 1);        perform pg_temp.rl(rid, i_corne, corne, 1);
  i_cafe   := pg_temp.item(rid, c_bois, 'Café noir', 15, 1);             perform pg_temp.rl(rid, i_cafe, cafe, 8);
  i_creme  := pg_temp.item(rid, c_bois, 'Café crème', 18, 2);            perform pg_temp.rl(rid, i_creme, cafe, 8); perform pg_temp.rl(rid, i_creme, lait, 120);
  i_the    := pg_temp.item(rid, c_bois, 'Thé à la menthe', 15, 3);       perform pg_temp.rl(rid, i_the, the, 5); perform pg_temp.rl(rid, i_the, menthe, 0.2);

  -- stock to start with (the pieces start at 0: "Produire" fills them)
  update public.ingredients set stock_qty = case id
      when farine then 25000 when beurre then 8000 when sucre then 15000 when oeufs then 180 when lait then 12000
      when amandes then 3000 when choco then 2000 when levure then 500 when fraises then 2000 when citrons then 3000 end,
    stock_since = d - 1
   where restaurant_id = rid and id in (farine, beurre, sucre, oeufs, lait, amandes, choco, levure, fraises, citrons);
  update public.ingredients set stock_qty = 0, stock_since = d - 1 where restaurant_id = rid and is_preparation and made_ahead;

  -- catering: a confirmed order for tomorrow (Production > Demain shows it), and a quote
  insert into public.catering_orders (restaurant_id, number, status, customer_name, customer_phone, company, event_date, event_time, mode, address, guests, note, delivery_fee_cents)
  values (rid, 0, 'confirmed', 'Salma B.', '0600000000', 'Société Démo SARL', d + 1, '10:00', 'delivery', 'Hay Riad, Rabat', 120, 'Séminaire : pause café du matin', 15000)
  returning id into ct;
  insert into public.catering_lines (restaurant_id, catering_id, ingredient_id, name, unit_price_cents, qty, sort_order) values
    (rid, ct, minic, 'Mini-croissants', 400, 240, 0),
    (rid, ct, corne, 'Cornes de gazelle', 500, 120, 1);
  insert into public.catering_lines (restaurant_id, catering_id, menu_item_id, name, unit_price_cents, qty, sort_order) values
    (rid, ct, i_tc, 'Tartelettes citron', 2500, 60, 2);
  insert into public.catering_payments (restaurant_id, catering_id, kind, method, amount_cents, paid_on) values (rid, ct, 'deposit', 'transfer', 150000, d);

  insert into public.catering_orders (restaurant_id, number, status, customer_name, customer_phone, event_date, event_time, mode, guests, note)
  values (rid, 0, 'quote', 'Famille El Amrani', '0600000001', d + 9, '18:00', 'pickup', 60, 'Fiançailles') returning id into ct;
  insert into public.catering_lines (restaurant_id, catering_id, ingredient_id, name, unit_price_cents, qty, sort_order) values
    (rid, ct, corne, 'Cornes de gazelle', 500, 200, 0);
  insert into public.catering_lines (restaurant_id, catering_id, menu_item_id, name, unit_price_cents, qty, sort_order) values
    (rid, ct, i_tf, 'Tartelettes aux fraises', 3000, 60, 1);
  insert into public.catering_lines (restaurant_id, catering_id, name, unit_price_cents, qty, sort_order) values
    (rid, ct, 'Pièce montée (sur devis)', 120000, 1, 2);

  raise notice 'Démo créée : Pâtisserie Les Oliviers (démo).';
end $$;
