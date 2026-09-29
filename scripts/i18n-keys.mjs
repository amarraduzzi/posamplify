// Lists every French text passed to t() in an app, and checks the Arabic dictionary.
// Usage: node scripts/i18n-keys.mjs apps/pos/src [--missing]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const onlyMissing = process.argv.includes('--missing');
const files = [];
const walk = d => readdirSync(d).forEach(f => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) && !/i18n-ar/.test(f) && files.push(p); });
walk(dir);
const keys = new Set();
const lit = String.raw`'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"`;
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(new RegExp(String.raw`\bt\(\s*(?:${lit})`, 'g'))) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
  // French labels translated indirectly (maps whose values go through t())
  for (const block of s.matchAll(/\/\/ i18n:values[\s\S]*?\n([\s\S]*?)\n\s*\/\/ i18n:end/g))
    for (const m of block[1].matchAll(new RegExp(String.raw`:\s*(?:${lit})`, 'g'))) keys.add((m[1] ?? m[2]).replace(/\\'/g, "'"));
}
const arFile = join(dir, 'lib', 'i18n-ar.ts');
const ar = readFileSync(arFile, 'utf8');
const have = new Set([...ar.matchAll(new RegExp(String.raw`^\s*(?:${lit})\s*:`, 'gm'))].map(m => (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"')));
const list = [...keys].sort();
const missing = list.filter(k => !have.has(k));
if (onlyMissing) { missing.forEach(k => console.log(JSON.stringify(k))); console.error(`${missing.length} missing of ${list.length}`); process.exit(missing.length ? 1 : 0); }
list.forEach(k => console.log(JSON.stringify(k)));
console.error(`${list.length} keys, ${missing.length} missing`);
