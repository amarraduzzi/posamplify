// Tiny stand-in for Supabase's REST API, for local UI testing only.
// Serves the three guest functions at /rest/v1/rpc/<fn>, running them as the
// anon role exactly like PostgREST does. Not for production.
//   DATABASE_URL=postgres://postgres@localhost:54322/postgres node scripts/local/api.mjs
import http from 'node:http';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54322/postgres' });
const FUNCS = {
  get_menu: ['p_slug', 'p_table_token'],
  place_order: ['p_slug', 'p_order'],
  get_order_status: ['p_order_id'],
};
const PORT = Number(process.env.PORT ?? 54321);
const DELAY = Number(process.env.API_DELAY_MS ?? 0);

http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const m = /^\/rest\/v1\/rpc\/([a-z_]+)/.exec(req.url ?? '');
  const params = FUNCS[m?.[1]];
  if (!m || !params) { res.writeHead(404, cors); return res.end('{}'); }
  let body = '';
  for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  const values = params.map(p => (args[p] !== null && typeof args[p] === 'object' ? JSON.stringify(args[p]) : args[p] ?? null));
  const c = await pool.connect();
  try {
    if (DELAY) await new Promise(r => setTimeout(r, DELAY));
    await c.query('begin');
    await c.query(`select set_config('role', 'anon', true), set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    const named = params.map((p, i) => `${p} => $${i + 1}`).join(', ');
    const { rows } = await c.query(`select public.${m[1]}(${named}) as r`, values);
    await c.query('commit');
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rows[0].r));
  } catch (e) {
    await c.query('rollback').catch(() => {});
    res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null }));
  } finally { c.release(); }
}).listen(PORT, () => console.log(`Local API on http://localhost:${PORT}`));
