// Mimics the Supabase API gateway for local testing: routes /auth/v1 to
// GoTrue (:9999) and /rest/v1 to PostgREST (:3000), with CORS.
// /storage/v1 is a small local copy of Supabase Storage: files go to .localstack/storage, and every
// upload, read and delete runs the real storage.objects policies as the signed-in user
// (upload, signed URLs, public URLs, remove: what the apps use).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const FILES = path.join(ROOT, '.localstack/storage');
const db = new pg.Pool({ connectionString: process.env.DB_URL ?? 'postgres://postgres@localhost:54332/postgres' });
const SECRET = crypto.randomBytes(16).toString('hex');
const ROUTES = [['/auth/v1', 9999], ['/rest/v1', 3000]];

const claimsOf = (req) => {
  const tok = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || req.headers.apikey || '';
  try { return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); } catch { return { role: 'anon' }; }
};
/** Runs SQL as the caller, with row-level security, like Supabase Storage does. */
async function asUser(claims, text, params) {
  const c = await db.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify(claims), claims.sub ?? '']);
    await c.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    const r = await c.query(text, params);
    await c.query('commit');
    return r.rows;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
const body = (req) => new Promise((ok, ko) => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => ok(Buffer.concat(b))); req.on('error', ko); });
const sign = (bucket, name, exp) => crypto.createHmac('sha256', SECRET).update(`${bucket}/${name}:${exp}`).digest('hex').slice(0, 32);
const fileOf = (bucket, name) => path.join(FILES, bucket, name);

async function storage(req, res, cors) {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1/, ''));
  const json = (code, o) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const claims = claimsOf(req);
  let m;
  try {
    // upload: POST /object/<bucket>/<name>
    if (req.method === 'POST' && (m = p.match(/^\/object\/(?!sign\/)([^/]+)\/(.+)$/))) {
      const [, bucket, name] = m;
      let data = await body(req);
      let type = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
      // supabase-js sends a Blob as multipart/form-data: keep the file part and its own type
      if (type === 'multipart/form-data') {
        const boundary = Buffer.from('--' + /boundary=([^;]+)/.exec(req.headers['content-type'])[1]);
        let at = data.indexOf(boundary), file = null;
        while (at >= 0) {
          const next = data.indexOf(boundary, at + boundary.length);
          if (next < 0) break;
          const part = data.subarray(at + boundary.length + 2, next - 2);
          const split = part.indexOf('\r\n\r\n');
          const head = part.subarray(0, split).toString();
          if (/filename=|name=""/.test(head) || !/name="(cacheControl|metadata)"/.test(head)) {
            file = { data: part.subarray(split + 4), type: (/content-type:\s*([^\r\n;]+)/i.exec(head)?.[1] ?? 'application/octet-stream').trim() };
          }
          at = next;
        }
        if (file) { data = file.data; type = file.type; }
      }
      const [b] = (await db.query('select * from storage.buckets where id = $1', [bucket])).rows;
      if (!b) return json(404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      if (b.file_size_limit && data.length > Number(b.file_size_limit)) return json(413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (b.allowed_mime_types?.length && !b.allowed_mime_types.includes(type)) return json(415, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
      await asUser(claims, `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)`, [bucket, name, claims.sub ?? null, { mimetype: type, size: data.length }]);
      fs.mkdirSync(path.dirname(fileOf(bucket, name)), { recursive: true });
      fs.writeFileSync(fileOf(bucket, name), data);
      return json(200, { Key: `${bucket}/${name}`, Id: name });
    }
    // signed URLs: POST /object/sign/<bucket>/<name> {expiresIn}  or  POST /object/sign/<bucket> {paths, expiresIn}
    if (req.method === 'POST' && (m = p.match(/^\/object\/sign\/([^/]+)(?:\/(.+))?$/))) {
      const [, bucket, one] = m;
      const b = JSON.parse((await body(req)).toString() || '{}');
      const names = one ? [one] : b.paths ?? [];
      const seen = new Set((await asUser(claims, `select name from storage.objects where bucket_id = $1 and name = any($2)`, [bucket, names])).map(x => x.name));
      const exp = Math.floor(Date.now() / 1000) + Number(b.expiresIn ?? 60);
      const out = names.map(n => seen.has(n)
        ? { path: n, signedURL: `/object/sign/${bucket}/${n}?token=${sign(bucket, n, exp)}.${exp}`, error: null }
        : { path: n, signedURL: null, error: 'Object not found' });
      if (one) return out[0].signedURL ? json(200, { signedURL: out[0].signedURL }) : json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return json(200, out);
    }
    // download through a signed URL
    if (req.method === 'GET' && (m = p.match(/^\/object\/sign\/([^/]+)\/(.+)$/))) {
      const [, bucket, name] = m;
      const [tok, exp] = (url.searchParams.get('token') ?? '').split('.');
      if (!exp || Number(exp) < Date.now() / 1000 || tok !== sign(bucket, name, exp)) return json(400, { statusCode: '400', error: 'InvalidJWT', message: 'invalid signature' });
      return send(res, cors, bucket, name);
    }
    // public files
    if (req.method === 'GET' && (m = p.match(/^\/object\/public\/([^/]+)\/(.+)$/))) {
      const [, bucket, name] = m;
      const [b] = (await db.query('select public from storage.buckets where id = $1', [bucket])).rows;
      if (!b?.public) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return send(res, cors, bucket, name);
    }
    // remove: DELETE /object/<bucket> {prefixes}
    if (req.method === 'DELETE' && (m = p.match(/^\/object\/([^/]+)$/))) {
      const [, bucket] = m;
      const { prefixes = [] } = JSON.parse((await body(req)).toString() || '{}');
      const gone = await asUser(claims, `delete from storage.objects where bucket_id = $1 and name = any($2) returning name`, [bucket, prefixes]);
      for (const g of gone) fs.rmSync(fileOf(bucket, g.name), { force: true });
      return json(200, gone.map(g => ({ name: g.name, bucket_id: bucket })));
    }
    return json(404, { statusCode: '404', error: 'not_found', message: `local storage: ${req.method} ${p} not supported` });
  } catch (e) {
    return json(400, { statusCode: '403', error: 'Unauthorized', message: e.message });
  }
}
async function send(res, cors, bucket, name) {
  const [o] = (await db.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rows;
  const f = fileOf(bucket, name);
  if (!o || !fs.existsSync(f)) { res.writeHead(404, cors); return res.end(); }
  res.writeHead(200, { ...cors, 'content-type': o.metadata?.mimetype ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.url.startsWith('/storage/v1/')) { storage(req, res, cors); return; }
  const route = ROUTES.find(([p]) => req.url.startsWith(p));
  if (!route) { res.writeHead(404, cors); return res.end(); }
  const headers = { ...req.headers, host: 'localhost' };
  // like Supabase: without a user token, the apikey acts as the bearer token
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ host: '127.0.0.1', port: route[1], path: req.url.slice(route[0].length) || '/', method: req.method, headers },
    r => {
      const h = Object.fromEntries(Object.entries(r.headers).filter(([k]) => !k.startsWith('access-control-')));
      res.writeHead(r.statusCode, { ...h, ...cors }); r.pipe(res);
    });
  up.on('error', e => { res.writeHead(502, cors); res.end(JSON.stringify({ message: e.message })); });
  req.pipe(up);
}).listen(54331, () => console.log('gateway :54331'));
