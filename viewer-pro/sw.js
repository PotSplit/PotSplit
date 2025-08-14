// sw.js — offline cache for AeonSight Pro (fixed clone timing)
// Bump version to refresh cache after updates
const CACHE = 'aeonsight-v4';
const CORE = [
  'index.html',
  'styles.css',
  'pro.js',
  'manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigations/HTML, cache-first for other same-origin GETs
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  const networkFirst = async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      // Clone immediately, then cache via waitUntil so body isn't consumed
      const copy = res.clone();
      event.waitUntil(cache.put(req, copy));
      return res;
    } catch (err) {
      // Fallback to cache (or index.html for SPA navigations)
      const cached = await cache.match(req);
      return cached || cache.match('index.html');
    }
  };

  const cacheFirst = async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;

    const res = await fetch(req);
    // Clone immediately before returning
    const copy = res.clone();
    event.waitUntil(cache.put(req, copy));
    return res;
  };

  // Prefer mode=navigate, but keep Accept sniff as a backup
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst());
  } else {
    event.respondWith(cacheFirst());
  }
});
