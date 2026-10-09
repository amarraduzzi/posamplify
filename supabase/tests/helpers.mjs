// Test helpers: run SQL as a superuser (setup), as a guest (anon) or as a
// logged-in user (authenticated), exactly like Supabase's API does it.
import pg from 'pg';
import { randomUUID } from 'node:crypto';

// sessions in UTC like Supabase: current_date in the tests = the business date of the restaurants (UTC)
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4, options: '-c TimeZone=UTC' });

/** Superuser query (bypasses RLS, like the Supabase SQL editor). */
export async function sql(text, params = []) {
  return (await pool.query(text, params)).rows;
}

/**
 * Run a query as an API client, the way PostgREST does:
 * switch role inside a transaction and set the JWT claims.
 * user = null -> anon guest, user = {id} -> authenticated.
 */
export async function as(user, text, params = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)`,
      [user ? 'authenticated' : 'anon',
       JSON.stringify(user ? { sub: user.id, role: 'authenticated' } : { role: 'anon' })],
    );
    const r = await c.query(text, params);
    await c.query('commit');
    return r.rows;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Call a public function as a client and return its single result value. */
export async function rpc(user, fn, args = []) {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await as(user, `select public.${fn}(${ph}) as r`, args);
  return rows[0].r;
}

export const uuid = randomUUID;

/**
 * Builds two fully separate restaurants (A and B) with users, staff, tables
 * and a menu, so every test can try to cross from one to the other.
 */
export async function world() {
  const tag = Math.random().toString(36).slice(2, 8);
  const user = async (name) =>
    (await sql(`insert into auth.users (email) values ($1) returning id, email`, [`${name}-${tag}@test.ma`]))[0];

  const users = {
    ownerA: await user('owner-a'),
    managerA: await user('manager-a'),
    deviceA: await user('device-a'),
    ownerB: await user('owner-b'),
    deviceB: await user('device-b'),
    admin: await user('admin'),
    stranger: await user('stranger'),
  };
  await sql(`insert into public.platform_admins (user_id) values ($1)`, [users.admin.id]);

  async function restaurant(key, owner, manager, device) {
    const [r] = await sql(
      `insert into public.restaurants
         (slug, name, status, legal_name, ice, tax_id, rc, address, city, accept_takeaway, branding)
       values ($1, $2, 'active', $3, '001234567000089', '12345678', 'RC 1234', 'Av. Mohammed V', 'Rabat', true,
               '{"primary_color":"#E8590C"}')
       returning *`,
      [`resto-${key}-${tag}`, `Resto ${key.toUpperCase()}`, `Resto ${key} SARL`],
    );
    const m = [[owner, 'owner'], [manager, 'manager'], [device, 'device']].filter(([u]) => u);
    for (const [u, role] of m) {
      await sql(`insert into public.memberships (restaurant_id, user_id, role) values ($1, $2, $3)`, [r.id, u.id, role]);
    }
    const staff = {};
    for (const [n, role] of [['Sara', 'staff'], ['Karim', 'manager']]) {
      staff[n.toLowerCase()] = (await sql(
        `insert into public.staff (restaurant_id, name, role) values ($1, $2, $3) returning *`, [r.id, n, role]))[0];
    }
    // PINs are set the real way: by the owner account through the API function
    await rpc(owner, 'set_staff_pin', [staff.sara.id, '1111']);
    await rpc(owner, 'set_staff_pin', [staff.karim.id, '9999']);

    const tables = {};
    for (const [label, active] of [['1', true], ['2', true], ['9', false]]) {
      tables['t' + label] = (await sql(
        `insert into public.dining_tables (restaurant_id, label, active) values ($1, $2, $3) returning *`,
        [r.id, label, active]))[0];
    }
    const cat = async (name, station, active = true, sort = 0) => (await sql(
      `insert into public.categories (restaurant_id, name, station, active, sort_order)
       values ($1, $2, $3, $4, $5) returning *`,
      [r.id, JSON.stringify({ fr: name, en: name, ar: name }), station, active, sort]))[0];
    const cats = {
      plats: await cat('Plats', 'kitchen', true, 1),
      boissons: await cat('Boissons', 'bar', true, 2),
      cachee: await cat('Cachée', 'kitchen', false, 3),
    };
    const item = async (catRow, name, price, extra = {}) => (await sql(
      `insert into public.menu_items (restaurant_id, category_id, name, description, price_cents, vat_bp, active, available)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [r.id, catRow.id, JSON.stringify({ fr: name, en: name + ' EN', ar: name + ' AR' }),
       JSON.stringify({ fr: 'desc ' + name }), price, extra.vat_bp ?? null,
       extra.active ?? true, extra.available ?? true]))[0];
    const items = {
      tajine: await item(cats.plats, 'Tajine', 8500),
      pizza: await item(cats.plats, 'Pizza', 6000),
      jus: await item(cats.boissons, 'Jus', 2000, { vat_bp: 2000 }),
      soldout: await item(cats.plats, 'Épuisé', 3000, { available: false }),
      inactive: await item(cats.plats, 'Inactif', 3000, { active: false }),
      hiddenCat: await item(cats.cachee, 'Caché', 3000),
    };
    const variant = async (it, name, price, active = true) => (await sql(
      `insert into public.item_variants (restaurant_id, menu_item_id, name, price_cents, active)
       values ($1, $2, $3, $4, $5) returning *`,
      [r.id, it.id, JSON.stringify({ fr: name }), price, active]))[0];
    const variants = {
      pizzaS: await variant(items.pizza, 'S', 5000),
      pizzaL: await variant(items.pizza, 'L', 8000),
      pizzaOff: await variant(items.pizza, 'XL', 12000, false),
    };
    return { r, staff, tables, cats, items, variants };
  }

  const A = await restaurant('a', users.ownerA, users.managerA, users.deviceA);
  const B = await restaurant('b', users.ownerB, null, users.deviceB);
  return { tag, users, A, B };
}

/** Guest order payload helper. */
export function guestOrder(tableToken, items, extra = {}) {
  return {
    client_id: uuid(),
    order_type: 'dine_in',
    table_token: tableToken,
    items,
    ...extra,
  };
}

/** Creates an order at the till (as device) and adds lines. Returns the order row. */
export async function tillOrder(device, restaurantId, lines, extra = {}) {
  const [o] = await as(device,
    `insert into public.orders (restaurant_id, client_id, business_date, ticket_number, source, order_type, table_id)
     values ($1, $2, current_date, 0, $5, $3, $4) returning *`,
    [restaurantId, uuid(), extra.order_type ?? 'takeaway', extra.table_id ?? null, extra.source ?? 'pos']);
  for (const l of lines) {
    await as(device,
      `insert into public.order_lines (restaurant_id, order_id, menu_item_id, variant_id, name, unit_price_cents, quantity, vat_bp)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [restaurantId, o.id, l.item_id ?? null, l.variant_id ?? null, l.name ?? '-', l.price ?? 0, l.qty ?? 1, l.vat_bp ?? null]);
  }
  return (await as(device, `select * from public.orders where id = $1`, [o.id]))[0];
}
