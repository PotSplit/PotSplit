// sw.js — simple offline cache (same-origin only)
const CACHE = 'aeonsight-v1';
const CORE = [
  'index.html',
  'styles.css',
  'pro.js',
  'manifest.webmanifest'
  // If you later host vendor libs locally, add them here to pre-cache.
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for HTML, cache-first for everything else
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET requests
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(req).then(res => {
        caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() =>
        caches.match(req).then(r => r || caches.match('index.html'))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }))
  );
});
