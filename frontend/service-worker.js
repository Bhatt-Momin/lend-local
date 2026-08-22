const CACHE_NAME = 'lendlocal-v3';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/register.html',
  '/dashboard.html',
  '/group.html',

  '/css/styles.css',
  '/css/animations.css',
  '/css/game-ui.css',

  '/js/api.js',
  '/js/dashboard.js',
  '/js/effects.js',
  '/js/group.js',

  '/manifest.json'
];

// Install Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

// Activate Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );

  self.clients.claim();
});

// Fetch from cache first, then network
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request)
          .then((networkResponse) => {
            return networkResponse;
          })
          .catch(() => {
            return caches.match('/index.html');
          })
      );
    })
  );
});