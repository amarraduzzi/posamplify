// Mimics the Supabase API gateway for local testing: routes /auth/v1 to
// GoTrue (:9999) and /rest/v1 to PostgREST (:3000), with CORS.
import http from 'node:http';

const ROUTES = [['/auth/v1', 9999], ['/rest/v1', 3000]];
http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers': 'content-range, x-supabase-api-version',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
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
