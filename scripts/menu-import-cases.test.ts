// Menu import parser on realistic exports: node --test --experimental-strip-types scripts/menu-import-cases.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detect, buildRows, issuesOf, parsePrice, decodeText } from '../apps/admin/src/lib/menuImport.ts';

const run = (csv: string) => { const rows = parseCsv(csv); const m = detect(rows); return { m, out: buildRows(rows, m, 'fr', 'Menu') }; };

test('prices in every Moroccan spelling', () => {
  assert.equal(parsePrice('25'), 2500); assert.equal(parsePrice('25,50 DH'), 2550); assert.equal(parsePrice('1 200,00'), 120000);
  assert.equal(parsePrice('1.200,5'), 120050); assert.equal(parsePrice('12.5'), 1250); assert.equal(parsePrice('45 درهم'), 4500);
  assert.equal(parsePrice(18), 1800); assert.equal(parsePrice('Gratuit'), null); assert.equal(parsePrice(''), null);
});

test('French Excel export with ; , cost and stock columns ignored', () => {
  const { m, out } = run('Code;Désignation;Famille;Prix de vente TTC;Prix achat;Stock\n001;Café noir;Boissons chaudes;12,00;3,5;100\n002;Tajine poulet;Plats;75;30;\n');
  assert.deepEqual(m.roles, ['ignore', 'name', 'category', 'price', 'ignore', 'ignore']);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].name, { fr: 'Café noir' }); assert.equal(out[0].price, 1200); assert.equal(out[0].station, 'bar');
  assert.deepEqual(out[1].category, { fr: 'Plats' });
});

test('sizes on separate lines become one dish with variants', () => {
  const { out } = run('Catégorie,Article,Taille,Prix\nPizzas,Margherita,Petite,45\nPizzas,Margherita,Grande,70\nPizzas,Reine,,60\n');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].variants.map(v => [v.name.fr, v.price]), [['Petite', 4500], ['Grande', 7000]]);
  assert.equal(out[1].price, 6000); assert.equal(out[1].variants.length, 0);
});

test('size columns S / M / L become variants', () => {
  const { m, out } = run('Article;S;M;L\nMargherita;40;55;70\nCalzone;;60;\n');
  assert.deepEqual(m.roles, ['name', 'price', 'price', 'price']);
  assert.deepEqual(out[0].variants.map(v => v.name.fr), ['S', 'M', 'L']);
  assert.equal(out[1].price, 6000, 'one size only: plain price');
});

test('no header, category titles as lines, Arabic column found by its script', () => {
  const { m, out } = run('BOISSONS\nCafé crème;مقهى بالحليب;15\nJus d\'orange;عصير البرتقال;20\nDESSERTS\nCrêpe miel;كريب بالعسل;25\n');
  assert.deepEqual(m.roles, ['name', 'name_ar', 'price']);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].category, { fr: 'BOISSONS' });
  assert.deepEqual(out[1].name, { fr: "Jus d'orange", ar: 'عصير البرتقال' });
  assert.deepEqual(out[2].category, { fr: 'DESSERTS' });
});

test('Arabic headers', () => {
  const { m, out } = run('الفئة,الاسم,السعر\nمشروبات,أتاي,10\n');
  assert.deepEqual(m.roles, ['category', 'name_ar', 'price']);
  assert.deepEqual(out[0].name, { ar: 'أتاي' }); assert.deepEqual(out[0].category, { ar: 'مشروبات' });
});

test('quoted cells, Windows-1252 bytes', () => {
  const bytes = new Uint8Array([0x43, 0x61, 0x66, 0xe9, 0x3b, 0x31, 0x32]); // "Café;12" in Windows-1252
  assert.equal(decodeText(bytes.buffer), 'Café;12');
  const { out } = run('Nom,Prix\n"Salade ""maison"", thon",38\n');
  assert.deepEqual(out[0].name, { fr: 'Salade "maison", thon' });
});

test('checks: missing price blocks, doubles and existing dishes are flagged', () => {
  const { out } = run('Catégorie;Article;Prix\nPlats;Tajine;75\nPlats;Tajine;75\nPlats;Harira;\nPlats;Couscous;90\n');
  const is = issuesOf(out, [{ category: { fr: 'plats' }, name: { fr: 'COUSCOUS' } }]);
  assert.deepEqual(out.map(r => is.get(r.id)), [[], ['duplicate'], ['no_price'], ['exists']]);
});
