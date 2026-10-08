// Local preview of the restaurant websites: runs the Pages middleware in Node.
// node scripts/local/site-dev.mjs  ->  http://localhost:5180/<slug>
import { build } from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
const out = '/tmp/site-mw.mjs';
await build({ entryPoints: ['apps/site/functions/[[path]].ts'], bundle: true, format: 'esm', platform: 'neutral', outfile: out, logLevel: 'error' });
const { onRequest } = await import(out + '?' + Date.now());
const env = { VITE_SUPABASE_URL: 'http://localhost:54331', VITE_SUPABASE_ANON_KEY: fs.readFileSync('.localstack/anon.key', 'utf8').trim(), VITE_MENU_URL: 'http://localhost:5173' };
http.createServer(async (req, res) => {
  const host = req.headers['x-host'] || req.headers.host;
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(`http://${host}${req.url}`, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
  const r = await onRequest({ request, env, waitUntil: () => {} });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(5180, () => console.log('site preview on http://localhost:5180/<slug>'));
