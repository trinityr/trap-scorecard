// Trap Stats service worker.
//
// This exists mainly to satisfy PWA "installability" (a browser will only
// offer an Install/Add-to-Home-Screen prompt if a service worker with a
// fetch handler is registered) and to give the app a minimal offline
// fallback. It deliberately does NOT aggressively cache the app shell —
// we got burned once already by a reverse-proxy cache serving a stale
// index.html after a deploy, so this worker always prefers the network
// for the page itself and only falls back to cache when truly offline.
// Static icons/manifest are cache-first since they never change without
// also changing CACHE_NAME below.

const CACHE_NAME = 'trap-stats-v1';

const PRECACHE_URLS = [
  '/',
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET requests. Everything else (API calls,
  // cross-origin fonts/Google Identity script, non-GET) goes straight to
  // the network untouched — no caching, no offline fallback. The app is
  // useless without a live API connection anyway, so there's no point
  // pretending those work offline.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }
  if (new URL(req.url).pathname.startsWith('/api/')) {
    return;
  }

  const isNavigation = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    // Network-first for the app shell itself: always fetch a fresh copy so
    // a redeploy is visible immediately, cache it for offline use, and only
    // fall back to whatever's cached (or '/') if the network is unreachable.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Static assets (icons, manifest): cache-first, network fallback.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      });
    })
  );
});
