// Creates local test logins for the till on the local stack (stack.sh):
//   kassa@doms.test / kassa-test-123  (device)   eigenaar@doms.test / eigenaar-test-123 (owner)
//   staff: Sara 1111 (staff), Youssef 2222 (staff), Karim 9999 (manager)
import pg from 'pg';
const API = 'http://localhost:54331';
const db = new pg.Pool({ connectionString: 'postgres://postgres@localhost:54332/postgres' });
const anon = (await import('node:fs')).readFileSync(new URL('../../.localstack/anon.key', import.meta.url), 'utf8').trim();

async function user(email, password) {
  let r = await fetch(`${API}/auth/v1/signup`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) r = await fetch(`${API}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(JSON.stringify(j));
  return { id: j.user.id, token: j.access_token };
}
const [{ id: rid }] = (await db.query(`select id from restaurants where slug = 'doms-cafe'`)).rows;
const device = await user('kassa@doms.test', 'kassa-test-123');
const owner = await user('eigenaar@doms.test', 'eigenaar-test-123');
await db.query(`insert into memberships (restaurant_id, user_id, role) values ($1,$2,'device'),($1,$3,'owner') on conflict do nothing`, [rid, device.id, owner.id]);
await db.query(`insert into platform_admins (user_id) values ($1) on conflict do nothing`, [owner.id]);
await db.query(`update restaurants set legal_name = 'DOMS CAFE SARL', ice = '003366999000071', phone = '0611053649',
  pos_settings = '{"printers":{"receipt":"TICKET","stations":{"bar":"BAR","kitchen":"CUISINE"}},"idle_lock_minutes":10}' where id = $1`, [rid]);
for (const [name, role, pin] of [['Sara', 'staff', '1111'], ['Youssef', 'staff', '2222'], ['Karim', 'manager', '9999']]) {
  const { rows: [s] } = await db.query(`insert into staff (restaurant_id, name, role) values ($1,$2,$3)
    on conflict (restaurant_id, name) do update set role = excluded.role returning id`, [rid, name, role]);
  const r = await fetch(`${API}/rest/v1/rpc/set_staff_pin`, { method: 'POST',
    headers: { apikey: anon, authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_staff_id: s.id, p_pin: pin }) });
  if (!r.ok) throw new Error(await r.text());
}
console.log('Till test users ready');
await db.end();
