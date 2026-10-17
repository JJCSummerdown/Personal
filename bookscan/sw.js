const CACHE = 'bookscan-v9';
const SHELL = ['./', 'index.html', 'manifest.json', 'icon-192.png', 'icon-512.png', 'zxing.js', 'zxing_reader.wasm'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const own = url.origin === self.location.origin;
  // only the app's own files and the scanner library are cached; lookups and sheet sync always hit the network
  if (e.request.method !== 'GET' || !(own || url.host === 'unpkg.com')) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    if (own && !/zxing/.test(url.pathname)) {
      // network first (bypassing the browser's HTTP cache) so updates show up on the next open; cached copy only when offline
      try {
        const r = await fetch(e.request, { cache: 'no-cache' });
        if (r.ok) c.put(e.request, r.clone());
        return r;
      } catch (_) { return (await c.match(e.request)) || (await c.match('index.html')); }
    }
    // the scanner library (self-hosted zxing files, and any CDN script) never changes: cache first
    const hit = await c.match(e.request);
    return hit || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
  }));
});
