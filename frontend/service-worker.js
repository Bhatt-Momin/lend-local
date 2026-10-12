importScripts("/js/helpers.js");

const CACHE_NAME = "lendlocal-v19";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/offline.html",
  "/login.html",
  "/register.html",
  "/dashboard.html",
  "/group.html",
  "/css/styles.css",
  "/css/animations.css",
  "/css/game-ui.css",
  "/css/design-system.css",
  "/css/dashboard-premium.css",
  "/css/group-premium.css",
  "/css/auth-premium.css",
  "/js/helpers.js",
  "/js/api.js",
  "/js/pwa.js",
  "/js/firebase.js",
  "/js/dashboard.js",
  "/js/effects.js",
  "/js/group.js",
  "/manifest.json"
];

// ============================================
// INSTALL
// ============================================

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn(`[SW] Pre-caching asset skipped or failed: ${asset}`, err);
          })
        )
      );
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ============================================
// ACTIVATE
// ============================================

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache.startsWith("lendlocal-") && cache !== CACHE_NAME) {
            console.log("[SW] Deleting obsolete app cache:", cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );

  self.clients.claim();
});

// ============================================
// FETCH
// ============================================

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // 1. NEVER intercept or cache authenticated financial API responses
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. Navigation requests (HTML pages): Network-First
  // Ensures online mobile and desktop users receive current HTML on navigation/refresh,
  // while falling back to cache or offline.html when offline.
  if (
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.status === 200 &&
            (networkResponse.headers.get("content-type") || "").includes("text/html") &&
            networkResponse.headers.get("X-App") === "LendLocal"
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(event.request, { ignoreSearch: true });
          if (cached) return cached;
          const fallbackCached = await caches.match(url.pathname);
          if (fallbackCached) return fallbackCached;
          return caches.match('/offline.html');
        })
    );
    return;
  }

  // 3. Same-origin static assets (CSS, JS, icons, manifest): Network-First with Cache Fallback
  // When online, gets latest updated JS/CSS without retaining stale assets.
  // When offline, immediately serves cached version.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request, { ignoreSearch: true });
        })
    );
    return;
  }

  // 4. Third-party static assets: Stale-While-Revalidate with Network Fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// ============================================
// NOTIFICATION CLICK
// ============================================

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.stopImmediatePropagation();

  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : "/dashboard.html";
  const destinationPath = typeof parseReturnUrl === 'function' ? parseReturnUrl(targetUrl, self.location.origin) : "/dashboard.html";
  const urlToOpen = new URL(destinationPath, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && "focus" in client) {
          return await client.focus();
        }
      }
      if (clientList.length > 0) {
        const client = clientList[0];
        if ("navigate" in client) {
          await client.navigate(urlToOpen);
        }
        if ("focus" in client) {
          return await client.focus();
        }
        return;
      }
      if (clients.openWindow) {
        return await clients.openWindow(urlToOpen);
      }
    })
  );
});

// ============================================
// FIREBASE CLOUD MESSAGING
// ============================================

// Firebase SDK
importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js"
);

// Your Firebase configuration
firebase.initializeApp({
  apiKey: "AIzaSyCvCGfg3mZYMyDol2Yl4UpyxS5loOBacVM",
  authDomain: "lendlocal-b06af.firebaseapp.com",
  projectId: "lendlocal-b06af",
  storageBucket: "lendlocal-b06af.firebasestorage.app",
  messagingSenderId: "1063215090901",
  appId: "1:1063215090901:web:89aced6468d04c295de65c"
});

// Initialize Firebase Messaging
const messaging = firebase.messaging();

// Handle BACKGROUND notifications
messaging.onBackgroundMessage((payload) => {
  console.log("[service-worker] Background notification:", payload);

  const notificationTitle =
    payload.notification?.title || "LendLocal";

  let url = "/dashboard.html";
  if (payload.data?.groupId) {
    if (payload.data.type === "payment_claim" && payload.data.paymentId) {
      url = "/group.html?id=" + payload.data.groupId + "&claimIntentId=" + payload.data.paymentId;
    } else if (payload.data.type === "payment_confirmed" || payload.data.type === "payment_rejected") {
      url = "/group.html?id=" + payload.data.groupId;
    }
  }
  const notificationOptions = {
    body: payload.notification?.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: url
    }
  };

  self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});
