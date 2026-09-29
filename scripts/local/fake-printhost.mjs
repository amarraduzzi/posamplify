// Pretends to be printhost.exe (http://127.0.0.1:8934) for testing: decodes
// the ESC/POS bytes back to text and appends each ticket to $OUT (default
// /tmp/tickets.txt), so tests can check what would have been printed.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const OUT = process.env.OUT ?? '/tmp/tickets.txt';
function decode(b64) {
  const b = Buffer.from(b64, 'base64'); let s = ''; let drawer = false;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0x1b && b[i + 1] === 0x40) { i += 1; continue; }
    if (c === 0x1b && (b[i + 1] === 0x61 || b[i + 1] === 0x45)) { i += 2; continue; }
    if (c === 0x1d && b[i + 1] === 0x21) { i += 2; continue; }
    if (c === 0x1d && b[i + 1] === 0x56) { i += 3; continue; }
    if (c === 0x1b && b[i + 1] === 0x70) { drawer = true; i += 4; continue; }
    s += c === 0x0a ? '\n' : String.fromCharCode(c);
  }
  return s.replace(/\n{3,}$/, '\n') + (drawer ? '[TIROIR OUVERT]\n' : '');
}
http.createServer(async (req, res) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, h); return res.end(); }
  if (req.url === '/ping') { res.writeHead(200, h); return res.end('{"ok":true}'); }
  let body = ''; for await (const c of req) body += c;
  const { printerName, title, dataBase64 } = JSON.parse(body || '{}');
  appendFileSync(OUT, `===== [${printerName}] ${title}\n${decode(dataBase64)}\n`);
  res.writeHead(200, h); res.end('{"ok":true}');
}).listen(8934, '127.0.0.1', () => console.log('fake printhost :8934 ->', OUT));
