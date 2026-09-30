// Menu import: one call builds categories + dishes, re-running skips doubles,
// undo removes exactly what was added, and only managers of that restaurant may.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, as, rpc, world, tillOrder } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());

const rows = [
  { category: { fr: 'plats ' }, name: { fr: 'Couscous royal', ar: 'كسكس ملكي' }, price_cents: 9500, description: { fr: 'Le vendredi' } },
  { category: { fr: 'Desserts', ar: 'حلويات' }, category_icon: '🍰', name: { fr: 'Pastilla au lait' }, price_cents: 3500, tags: ['popular', 'bogus'] },
  { category: { fr: 'Desserts' }, name: { fr: 'Thé à la menthe' }, variants: [{ name: { fr: 'Petit' }, price_cents: 1000 }, { name: { fr: 'Théière' }, price_cents: 2500 }] },
  { category: { fr: 'Plats' }, name: { fr: 'tajine' }, price_cents: 1 }, // already on the menu
];

test('import builds the menu in one go and matches existing categories', async () => {
  const res = await rpc(w.users.managerA, 'import_menu', [w.A.r.id, 'file', 'export.xlsx', JSON.stringify(rows)]);
  assert.equal(res.items, 3);
  assert.equal(res.categories, 1, 'only Desserts is new, "plats " matches Plats');
  assert.equal(res.skipped, 1, 'Tajine exists already');

  const items = await as(w.users.ownerA, `select i.*, c.name cat from public.menu_items i join public.categories c on c.id = i.category_id where i.id = any($1)`,
    [(await as(w.users.ownerA, `select item_ids from public.menu_imports where id = $1`, [res.import_id]))[0].item_ids]);
  const cous = items.find(i => i.name.fr === 'Couscous royal');
  assert.equal(cous.category_id, w.A.cats.plats.id);
  assert.equal(cous.name.ar, 'كسكس ملكي');
  const the = items.find(i => i.name.fr === 'Thé à la menthe');
  assert.equal(Number(the.price_cents), 1000, 'price = cheapest variant');
  const vars = await as(w.users.ownerA, `select * from public.item_variants where menu_item_id = $1 order by sort_order`, [the.id]);
  assert.deepEqual(vars.map(v => v.name.fr), ['Petit', 'Théière']);
  const pas = items.find(i => i.name.fr === 'Pastilla au lait');
  assert.deepEqual(pas.tags, ['popular'], 'unknown tags dropped');

  const again = await rpc(w.users.managerA, 'import_menu', [w.A.r.id, 'file', 'export.xlsx', JSON.stringify(rows)]);
  assert.equal(again.items, 0, 'same file twice: no doubles');
  assert.equal(again.skipped, 4);
});

test('a bad row stops the whole import', async () => {
  const before = (await as(w.users.ownerA, `select count(*)::int n from public.menu_items where restaurant_id = $1`, [w.A.r.id]))[0].n;
  await assert.rejects(rpc(w.users.managerA, 'import_menu', [w.A.r.id, 'file', null, JSON.stringify([
    { category: { fr: 'Nouveau' }, name: { fr: 'Ok' }, price_cents: 100 },
    { category: { fr: 'Nouveau' }, name: { fr: 'Sans prix' } },
  ])]), /row 2: price missing/);
  const after_ = (await as(w.users.ownerA, `select count(*)::int n from public.menu_items where restaurant_id = $1`, [w.A.r.id]))[0].n;
  assert.equal(after_, before, 'nothing half imported');
});

test('undo removes new dishes, hides sold ones, keeps categories still in use', async () => {
  const res = await rpc(w.users.ownerA, 'import_menu', [w.A.r.id, 'photo', 'carte.jpg', JSON.stringify([
    { category: { fr: 'Pizzas' }, name: { fr: 'Margherita' }, price_cents: 5000 },
    { category: { fr: 'Pizzas' }, name: { fr: 'Quatre fromages' }, price_cents: 7000 },
    { category: { fr: 'Salades' }, name: { fr: 'Niçoise' }, price_cents: 4500 },
  ])]);
  const ids = (await as(w.users.ownerA, `select item_ids from public.menu_imports where id = $1`, [res.import_id]))[0].item_ids;
  const [marg] = await as(w.users.ownerA, `select * from public.menu_items where id = any($1) and name->>'fr' = 'Margherita'`, [ids]);
  await tillOrder(w.users.deviceA, w.A.r.id, [{ item_id: marg.id, name: 'Margherita', price: 5000 }]);
  const salades = (await as(w.users.ownerA, `select * from public.categories where restaurant_id = $1 and name->>'fr' = 'Salades'`, [w.A.r.id]))[0];
  await as(w.users.ownerA, `insert into public.menu_items (restaurant_id, category_id, name, price_cents) values ($1, $2, '{"fr":"Ajoutée à la main"}', 100)`, [w.A.r.id, salades.id]);

  const u = await rpc(w.users.ownerA, 'undo_menu_import', [res.import_id]);
  assert.deepEqual(u, { removed: 2, hidden: 1 });
  const left = await as(w.users.ownerA, `select * from public.menu_items where id = any($1)`, [ids]);
  assert.equal(left.length, 1);
  assert.equal(left[0].active, false, 'sold dish hidden, not deleted');
  const cats = await as(w.users.ownerA, `select name->>'fr' n from public.categories where restaurant_id = $1 and name->>'fr' in ('Pizzas','Salades')`, [w.A.r.id]);
  assert.deepEqual(cats.map(c => c.n).sort(), ['Pizzas', 'Salades'], 'Pizzas still holds the sold dish, Salades a manual one');
  await assert.rejects(rpc(w.users.ownerA, 'undo_menu_import', [res.import_id]), /already undone/);
});

test('tills and other restaurants cannot import or undo', async () => {
  const one = JSON.stringify([{ category: { fr: 'X' }, name: { fr: 'Y' }, price_cents: 100 }]);
  await assert.rejects(rpc(w.users.deviceA, 'import_menu', [w.A.r.id, 'file', null, one]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'import_menu', [w.A.r.id, 'file', null, one]), /not allowed/);
  await assert.rejects(rpc(w.users.ownerB, 'can_import_menu', [w.A.r.id]), /not allowed/);
  assert.equal(await rpc(w.users.managerA, 'can_import_menu', [w.A.r.id]), true);
  const res = await rpc(w.users.managerA, 'import_menu', [w.A.r.id, 'file', null, one]);
  await assert.rejects(rpc(w.users.ownerB, 'undo_menu_import', [res.import_id]), /not allowed/);
  const seen = await as(w.users.ownerB, `select * from public.menu_imports where restaurant_id = $1`, [w.A.r.id]);
  assert.equal(seen.length, 0, 'other restaurants do not see the import history');
  await assert.rejects(as(w.users.ownerA, `insert into public.menu_imports (restaurant_id, source) values ($1, 'file')`, [w.A.r.id]));
});
