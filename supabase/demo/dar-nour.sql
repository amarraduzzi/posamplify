-- Amplify POS: "Dar Nour", a FICTIONAL café used as the live demo on the website
-- (phone mockup + QR code). Not a real business. Safe to run again: it rebuilds
-- the demo from scratch. Photos: Unsplash (free license), loaded from their CDN.
begin;

-- remove the previous demo (purge mode: demo data may go, real restaurants never)
select set_config('app.purge', 'on', true);
delete from public.restaurants where slug = 'dar-nour' and is_demo;
select set_config('app.purge', 'off', true);

do $$
declare
  rid uuid;
  cat uuid;
  it  uuid;
  img constant text := 'https://images.unsplash.com/photo-%s?w=800&q=75&auto=format&fit=crop';
begin
  insert into public.restaurants (slug, name, status, is_demo, languages, address, city, branding,
    accept_dine_in, accept_takeaway, accept_delivery, opening_hours)
  values ('dar-nour', 'Dar Nour', 'active', true, '{fr,ar,en}', 'Café de démonstration', 'Maroc',
    jsonb_build_object(
      'primary_color', '#B4532A', 'theme', 'light',
      'logo_url', 'https://posamplify.pages.dev/demo/dar-nour.svg',
      'cover_url', format(img, '1771681208390-0381c8f6fbf8'),
      'tagline', '{"fr":"Café · Brunch · Pâtisserie","en":"Café · Brunch · Pastry","ar":"مقهى · فطور متأخر · حلويات"}'::jsonb),
    true, true, false,
    '{"mon":[["07:30","23:00"]],"tue":[["07:30","23:00"]],"wed":[["07:30","23:00"]],"thu":[["07:30","23:00"]],"fri":[["07:30","23:00"]],"sat":[["08:00","23:30"]],"sun":[["08:00","23:30"]]}'::jsonb)
  returning id into rid;

  -- ----------------------------------------------------------------- Petit-déjeuner
  insert into public.categories (restaurant_id, name, icon, station, sort_order)
  values (rid, '{"fr":"Petit-déjeuner","en":"Breakfast","ar":"الفطور"}', '🍳', 'kitchen', 10) returning id into cat;
  insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, sort_order) values
  (rid, cat, '{"fr":"Petit-déjeuner marocain","en":"Moroccan breakfast","ar":"فطور مغربي"}',
   '{"fr":"Œuf au plat, msemen, amlou, olives, fromage frais, jus d''orange et thé à la menthe.","en":"Fried egg, msemen, amlou, olives, fresh cheese, orange juice and mint tea.","ar":"بيض مقلي، مسمن، أملو، زيتون، جبن طري، عصير البرتقال وأتاي بالنعناع."}',
   5500, format(img, '1786799445505-77b51a75ee1f'), '{popular}', 10),
  (rid, cat, '{"fr":"Toast avocat & œuf","en":"Avocado & egg toast","ar":"توست بالأفوكا والبيض"}',
   '{"fr":"Pain au levain grillé, avocat écrasé, œuf au plat, piment d''Espelette.","en":"Toasted sourdough, smashed avocado, fried egg, chili flakes.","ar":"خبز محمص، أفوكا مهروسة، بيضة مقلية، فلفل حار."}',
   5200, format(img, '1525351484163-7529414344d8'), '{vegetarian}', 20),
  (rid, cat, '{"fr":"Pancakes aux fruits","en":"Fruit pancakes","ar":"بانكيك بالفواكه"}',
   '{"fr":"Trois pancakes moelleux, fruits frais, miel de thym.","en":"Three fluffy pancakes, fresh fruit, thyme honey.","ar":"ثلاث قطع بانكيك طرية، فواكه طازجة، عسل الزعتر."}',
   4800, format(img, '1669277038512-2dc8b3a2aac8'), '{new}', 30);

  -- ----------------------------------------------------------------- Boissons chaudes
  insert into public.categories (restaurant_id, name, icon, station, sort_order)
  values (rid, '{"fr":"Boissons chaudes","en":"Hot drinks","ar":"مشروبات ساخنة"}', '☕', 'bar', 20) returning id into cat;
  insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, sort_order) values
  (rid, cat, '{"fr":"Espresso","en":"Espresso","ar":"إسبريسو"}',
   '{"fr":"Café 100 % arabica, torréfié à Casablanca.","en":"100% arabica, roasted in Casablanca.","ar":"قهوة أرابيكا 100%، محمصة في الدار البيضاء."}',
   1500, format(img, '1572286258217-40142c1c6a70'), '{}', 10),
  (rid, cat, '{"fr":"Cappuccino","en":"Cappuccino","ar":"كابتشينو"}',
   '{"fr":"Espresso, lait mousseux, une pointe de cannelle.","en":"Espresso, foamed milk, a hint of cinnamon.","ar":"إسبريسو، حليب رغوي، لمسة قرفة."}',
   2400, format(img, '1534778101976-62847782c213'), '{popular}', 20);
  insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, sort_order)
  values (rid, cat, '{"fr":"Thé à la menthe","en":"Mint tea","ar":"أتاي بالنعناع"}',
   '{"fr":"Thé vert, menthe fraîche, servi à la marocaine.","en":"Green tea and fresh mint, served the Moroccan way.","ar":"شاي أخضر ونعناع طري، على الطريقة المغربية."}',
   1500, format(img, '1591299089616-c9604047b1a6'), '{popular}', 30)
  returning id into it;
  insert into public.item_variants (restaurant_id, menu_item_id, name, price_cents, sort_order) values
  (rid, it, '{"fr":"Verre","en":"Glass","ar":"كأس"}', 1500, 10),
  (rid, it, '{"fr":"Théière (2 pers.)","en":"Teapot (2 people)","ar":"براد (شخصان)"}', 3200, 20);

  -- ----------------------------------------------------------------- Jus & smoothies
  insert into public.categories (restaurant_id, name, icon, station, sort_order)
  values (rid, '{"fr":"Jus & smoothies","en":"Juices & smoothies","ar":"عصائر وسموذي"}', '🍹', 'bar', 30) returning id into cat;
  insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, sort_order) values
  (rid, cat, '{"fr":"Jus d''orange pressé","en":"Fresh orange juice","ar":"عصير البرتقال الطبيعي"}',
   '{"fr":"Oranges de Berkane, pressées à la commande.","en":"Berkane oranges, squeezed to order.","ar":"برتقال بركان، يعصر عند الطلب."}',
   1800, format(img, '1600271886742-f049cd451bba'), '{}', 10),
  (rid, cat, '{"fr":"Smoothie avocat & dattes","en":"Avocado & date smoothie","ar":"سموذي الأفوكا والتمر"}',
   '{"fr":"Avocat, dattes Majhoul, lait, amandes.","en":"Avocado, Medjool dates, milk, almonds.","ar":"أفوكا، تمر المجهول، حليب، لوز."}',
   3200, format(img, '1541519890052-6a762bb1e481'), '{popular}', 20),
  (rid, cat, '{"fr":"Citronnade menthe","en":"Mint lemonade","ar":"ليموناضة بالنعناع"}',
   '{"fr":"Citrons frais, menthe, une touche de fleur d''oranger.","en":"Fresh lemons, mint, a touch of orange blossom.","ar":"ليمون طري، نعناع، لمسة ماء الزهر."}',
   2200, format(img, '1607690506833-498e04ab3ffa'), '{}', 30);

  -- ----------------------------------------------------------------- Plats
  insert into public.categories (restaurant_id, name, icon, station, sort_order)
  values (rid, '{"fr":"Plats","en":"Mains","ar":"أطباق رئيسية"}', '🍲', 'kitchen', 40) returning id into cat;
  insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, sort_order) values
  (rid, cat, '{"fr":"Tajine poulet citron","en":"Chicken & lemon tagine","ar":"طاجين الدجاج بالحامض"}',
   '{"fr":"Poulet fermier, citron confit, olives violettes, pain maison.","en":"Free-range chicken, preserved lemon, olives, homemade bread.","ar":"دجاج بلدي، حامض مصبر، زيتون، خبز الدار."}',
   8500, format(img, '1680098021573-b9402ee336ec'), '{popular}', 10),
  (rid, cat, '{"fr":"Couscous poulet & légumes","en":"Chicken & vegetable couscous","ar":"كسكس بالدجاج والخضر"}',
   '{"fr":"Le vendredi et le dimanche. Sept légumes, pois chiches, tfaya.","en":"Fridays and Sundays. Seven vegetables, chickpeas, tfaya.","ar":"يوم الجمعة والأحد. سبع خضر، حمص، تفاية."}',
   9000, format(img, '1778850790390-c1ba244fbc85'), '{}', 20),
  (rid, cat, '{"fr":"Bowl poulet grillé","en":"Grilled chicken bowl","ar":"بول الدجاج المشوي"}',
   '{"fr":"Poulet mariné au ras el hanout, quinoa, légumes croquants, sauce yaourt.","en":"Ras el hanout chicken, quinoa, crunchy vegetables, yogurt sauce.","ar":"دجاج متبل برأس الحانوت، كينوا، خضر مقرمشة، صلصة الياغورت."}',
   6800, format(img, '1546069901-ba9599a7e63c'), '{new}', 30),
  (rid, cat, '{"fr":"Salade du jardin","en":"Garden salad","ar":"سلطة الحديقة"}',
   '{"fr":"Légumes de saison, pois chiches, graines, vinaigrette citron-cumin.","en":"Seasonal vegetables, chickpeas, seeds, lemon-cumin dressing.","ar":"خضر الموسم، حمص، بذور، صلصة الحامض والكمون."}',
   4500, format(img, '1512621776951-a57141f2eefd'), '{vegetarian}', 40);

  -- ----------------------------------------------------------------- Pâtisseries
  insert into public.categories (restaurant_id, name, icon, station, sort_order)
  values (rid, '{"fr":"Pâtisseries","en":"Pastries","ar":"حلويات"}', '🥐', 'bar', 50) returning id into cat;
  insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, image_url, tags, sort_order) values
  (rid, cat, '{"fr":"Assortiment marocain","en":"Moroccan sweets platter","ar":"تشكيلة حلويات مغربية"}',
   '{"fr":"Cornes de gazelle, ghriba, briouates au miel. Parfait avec un thé.","en":"Gazelle horns, ghriba, honey briouats. Perfect with tea.","ar":"كعب غزال، غريبة، بريوات بالعسل. مثالية مع أتاي."}',
   3800, format(img, '1784386124506-617d0bec2e02'), '{popular}', 10),
  (rid, cat, '{"fr":"Croissant pistache","en":"Pistachio croissant","ar":"كرواسون بالفستق"}',
   '{"fr":"Pur beurre, crème de pistache maison.","en":"All-butter, homemade pistachio cream.","ar":"بالزبدة، كريمة الفستق من صنع الدار."}',
   2200, format(img, '1741399106443-83e43b566e0d'), '{new}', 20);

  -- a few tables so the QR codes work in the demo
  insert into public.dining_tables (restaurant_id, label, sort_order)
  select rid, n::text, n from generate_series(1, 8) n;
end $$;

commit;
