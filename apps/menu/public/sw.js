// Minimal service worker: it makes the customer's points card installable on the home screen and lets the
// page shell open without a connection. It never caches API calls (the points always come live from the server).
const SHELL = 'card-shell-v1';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API and images of other hosts: untouched
  if (req.mode === 'navigate') {
    // network first; when offline, the last page shell
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/index.html', copy)); return res; })
      .catch(() => caches.match('/index.html').then(r => r || Response.error())));
  }
});
