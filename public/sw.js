// public/sw.js
//
// Deliberately minimal. A TWA only requires that a service worker exists
// and controls the page -- it does NOT require offline caching. This site
// is an ordering system (cart, checkout, account data all change often),
// so this worker intentionally does NOT cache API responses or HTML: it
// just passes every request straight to the network. That keeps prices,
// stock, cart contents and order status always fresh, while still
// satisfying installability checks (Lighthouse/Play Store) and letting the
// TWA show a small offline fallback instead of a broken white screen.

const OFFLINE_URL = '/offline.html';
const PRECACHE = 'mm-shell-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Only step in for full page navigations (so we can show the offline
  // fallback if the network is down). Everything else (API calls, CSS,
  // JS, images) goes straight to the network, untouched, un-cached.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
