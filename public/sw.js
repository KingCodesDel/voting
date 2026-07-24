// public/sw.js
// Minimal service worker: caches the static app shell so the site's
// core pages/assets can load offline. API calls always go to the
// network (never cached), so voting data stays live and accurate.

const CACHE_NAME = 'awards-shell-v1';
const SHELL_FILES = [
  '/index.html',
  '/awards.html',
  '/css/style.css',
  '/js/main.js',
  '/js/awards.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API requests — voting data must always be fresh.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
