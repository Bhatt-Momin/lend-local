const CACHE_NAME = "lendlocal-v5";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/login.html",
  "/register.html",
  "/dashboard.html",
  "/group.html",
  "/css/styles.css",
  "/css/animations.css",
  "/css/game-ui.css",
  "/js/api.js",
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
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );

  self.skipWaiting();
});

// ============================================
// ACTIVATE
// ============================================

self.addEventListener("activate", (event) => {
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

// ============================================
// FETCH
// ============================================

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request).catch(() => {
          return caches.match("/index.html");
        })
      );
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

  const notificationOptions = {
    body: payload.notification?.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: {
      url: "/dashboard.html"
    }
  };

  self.registration.showNotification(
    notificationTitle,
    notificationOptions
  );
});

// ============================================
// NOTIFICATION CLICK
// ============================================

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow("/dashboard.html");
      }
    })
  );
});