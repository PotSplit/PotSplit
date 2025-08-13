// sw.js — simple offline cache
const CACHE = 'aeonsight-v1';
const CORE = [
  '/',            // adjust if not served from domain root
  '/index.html',  // update paths to match your build
  '/styles.css',
  '/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for HTML, cache-first for others
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }))
  );
});
