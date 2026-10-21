// Floor plan: tables get a place, a size, a shape and seats; the room's fixed things per zone.
// An owner account saves directly, a till needs a manager PIN; another restaurant's tables are never touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, rpc, world } from './helpers.mjs';

let w, A, rid, t1, t2;
before(async () => {
  w = await world(); A = w.A; rid = A.r.id;
  [t1, t2] = (await sql(`select id from public.dining_tables where restaurant_id = $1 order by label limit 2`, [rid])).map(x => x.id);
});
after(() => pool.end());
const plan = { zones: { '': [{ k: 'bar', x: 0, y: 0, w: 12, h: 3, t: 'Bar' }, { k: 'door', x: 44, y: 28, w: 4, h: 1 }] } };
const save = (user, tables, p = plan, staff = null, pin = null) =>
  rpc(user, 'save_floor_plan', [rid, JSON.stringify(tables), JSON.stringify(p), staff, pin]);
const tb = async id => (await sql(`select plan_x, plan_y, plan_w, plan_h, plan_shape, seats from public.dining_tables where id = $1`, [id]))[0];

test('the owner places tables and draws the room', async () => {
  const r = await save(w.users.ownerA, [{ id: t1, x: 4, y: 6, w: 4, h: 4, shape: 'round', seats: 2 }, { id: t2, x: 12, y: 6, w: 8, h: 4, shape: 'rect', seats: 6 }]);
  assert.equal(r.ok, true); assert.equal(r.tables, 2);
  assert.deepEqual(await tb(t1), { plan_x: 4, plan_y: 6, plan_w: 4, plan_h: 4, plan_shape: 'round', seats: 2 });
  const [{ floor_plan }] = await sql(`select floor_plan from public.restaurants where id = $1`, [rid]);
  assert.equal(floor_plan.zones[''][0].k, 'bar');
});

test('a table taken off the plan keeps its size; the till needs a manager PIN', async () => {
  const bad = await save(w.users.deviceA, [{ id: t1, x: null, y: null }], plan, A.staff.sara.id, '1111');
  assert.equal(bad.ok, false);
  const ok = await save(w.users.deviceA, [{ id: t1, x: null, y: null }], plan, A.staff.karim.id, '9999');
  assert.equal(ok.ok, true);
  const x = await tb(t1);
  assert.equal(x.plan_x, null); assert.equal(x.plan_w, 4); assert.equal(x.plan_shape, 'round');
});

test('outside the grid or an unknown element is refused; another restaurant cannot save', async () => {
  await assert.rejects(save(w.users.ownerA, [{ id: t2, x: 60, y: 0 }]), /check|invalid/);
  await assert.rejects(save(w.users.ownerA, [], { zones: { '': [{ k: 'pool', x: 0, y: 0, w: 2, h: 2 }] } }), /invalid_request/);
  await assert.rejects(rpc(w.users.ownerB, 'save_floor_plan', [rid, '[]', '{}', null, null]));
});
