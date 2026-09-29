// Menu photos: managers of a restaurant write only in their own folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, world } from './helpers.mjs';

let w;
before(async () => { w = await world(); });
after(() => pool.end());
const put = (u, path) => as(u, `insert into storage.objects (bucket_id, name) values ('menu-images', $1) returning id`, [path]);

test('bucket exists and is public', async () => {
  const [b] = await sql(`select public from storage.buckets where id = 'menu-images'`);
  assert.equal(b.public, true);
});

test('managers upload into their own restaurant folder only', async () => {
  assert.equal((await put(w.users.ownerA, `${w.A.r.id}/items/a.webp`)).length, 1);
  assert.equal((await put(w.users.managerA, `${w.A.r.id}/items/b.webp`)).length, 1);
  await assert.rejects(put(w.users.ownerA, `${w.B.r.id}/items/hack.webp`), /row-level security/);
  await assert.rejects(put(w.users.deviceA, `${w.A.r.id}/items/c.webp`), /row-level security/);
  await assert.rejects(put(w.users.ownerA, `items/nofolder.webp`), /row-level security/);
  await assert.rejects(put(null, `${w.A.r.id}/x.webp`), /row-level security|permission/);
});

test('B cannot delete or overwrite A files', async () => {
  const del = await as(w.users.ownerB, `delete from storage.objects where name like $1 returning id`, [`${w.A.r.id}/%`]);
  assert.equal(del.length, 0);
  const upd = await as(w.users.ownerB, `update storage.objects set name = $2 where name = $1 returning id`, [`${w.A.r.id}/items/a.webp`, `${w.B.r.id}/stolen.webp`]);
  assert.equal(upd.length, 0);
});
