// Courses: a held line is saved but cannot be sent before it is fired; the pass marks served.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, sql, as, world, tillOrder } from './helpers.mjs';

let w, A, dev;
before(async () => { w = await world(); A = w.A; dev = w.users.deviceA; });
after(() => pool.end());

test('held course: saved, not sendable until fired, then served', async () => {
  const o = await tillOrder(dev, A.r.id, [{ item_id: A.items.jus.id }]);
  const [l] = await as(dev, `insert into public.order_lines (restaurant_id, order_id, menu_item_id, name, unit_price_cents, quantity, vat_bp, course, held)
    values ($1, $2, $3, '-', 0, 1, 0, 2, true) returning *`, [A.r.id, o.id, A.items.tajine.id]);
  assert.equal(l.held, true); assert.equal(l.course, 2);
  assert.equal(Number((await sql(`select total_cents from public.orders where id = $1`, [o.id]))[0].total_cents), 2000 + 8500, 'a held dish is on the bill');
  await assert.rejects(as(dev, `update public.order_lines set kitchen_sent_at = now() where id = $1`, [l.id]), /order_lines_held_unsent/);
  await as(dev, `update public.order_lines set held = false where id = $1`, [l.id]);
  await as(dev, `update public.order_lines set kitchen_sent_at = now(), ready_at = now() where id = $1`, [l.id]);
  await as(dev, `update public.order_lines set served_at = now() where id = $1`, [l.id]);
  const [x] = await sql(`select held, kitchen_sent_at is not null sent, served_at is not null served from public.order_lines where id = $1`, [l.id]);
  assert.deepEqual([x.held, x.sent, x.served], [false, true, true]);
  await assert.rejects(as(w.users.managerA, `update public.categories set course = 5 where restaurant_id = $1`, [A.r.id]), /categories_course_check|check constraint/);
});
