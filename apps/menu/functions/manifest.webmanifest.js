// Web app manifest of a restaurant's points card, as a REAL url (Android needs this: Chrome sends the manifest url
// to Google's server to build the installable app, which cannot read a blob: or data: manifest).
// Nothing is looked up and nothing secret goes in: the page passes the restaurant's name, colour, logo and path in
// the query, and this only checks them and echoes them back as JSON. The customer's private key is NOT in the
// manifest: the app opens on the restaurant page, which sends this phone to its own card (the key is on the phone).
const HEX = /^#[0-9a-f]{6}$/i;
const PATH = /^\/[a-z0-9-]{0,60}$/i;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

export function buildManifest(url) {
  const q = url.searchParams;
  const name = (q.get('n') || '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Carte fidélité';
  const color = HEX.test(q.get('c') || '') ? q.get('c') : '#C2410C';
  const p = PATH.test(q.get('p') || '') ? q.get('p') : '/';
  const lang = ['fr', 'en', 'ar'].includes(q.get('l')) ? q.get('l') : 'fr';
  let icon = null;
  try { const u = new URL(q.get('i') || ''); if (u.protocol === 'https:') icon = u.href; } catch { /* no logo */ }
  const ext = icon ? (new URL(icon).pathname.split('.').pop() || '').toLowerCase() : '';
  const type = MIME[ext] || 'image/png';
  const base = url.origin + p;
  const manifest = {
    name, short_name: name.length > 12 ? name.split(' ')[0].slice(0, 12) : name, description: name, lang,
    id: base, start_url: base, scope: base, display: 'standalone', orientation: 'portrait',
    background_color: color, theme_color: color,
    icons: icon
      ? [{ src: icon, sizes: '192x192', type, purpose: 'any' }, { src: icon, sizes: '512x512', type, purpose: 'any' }]
      : [{ src: url.origin + '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
  return manifest;
}

export function onRequestGet({ request }) {
  return new Response(JSON.stringify(buildManifest(new URL(request.url))), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}
