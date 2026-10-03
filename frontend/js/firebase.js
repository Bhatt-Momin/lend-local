// =====================================================
// LENDLOCAL — FIREBASE CLOUD MESSAGING
// =====================================================

const firebaseConfig = {
  apiKey: "AIzaSyCvCGfg3mZYMyDol2Yl4UpyxS5loOBacVM",
  authDomain: "lendlocal-b06af.firebaseapp.com",
  projectId: "lendlocal-b06af",
  storageBucket: "lendlocal-b06af.firebasestorage.app",
  messagingSenderId: "1063215090901",
  appId: "1:1063215090901:web:89aced6468d04c295de65c",
  measurementId: "G-PHCYFYWSCZ"
};

const VAPID_KEY = "BAStMhg-rlFpO90XamsOZIMnBQhNc1Zm1oyVHvlOxMIhFzC4ufOLBiWAWNB4nQW-rY9JV5Ff1X94yqK8bzZkA3s";

let messaging = null;
let getTokenFunction = null;
let deleteTokenFunction = null;
let swRegistration = null;
window.isLoggingOut = false;
window.fcmAbortControllers = new Set();
window.pendingFCMRegistrations = new Set();

// =====================================================
// NOTIFICATION ONBOARDING UI
// =====================================================
function injectNotificationBanner() {
  if (document.getElementById('notification-onboarding-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'notification-onboarding-banner';
  banner.style.cssText = 'background: var(--ll-surface); border-bottom: 1px solid var(--ll-border); padding: 0.75rem 1rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; justify-content: center; text-align: center; z-index: 100; width: 100%; box-sizing: border-box;';
  banner.innerHTML = `
    <p style="margin: 0; color: var(--ll-text); font-weight: 500; flex: 1 1 100%; font-size: 0.9rem;">Get notified about new expenses and payment updates.</p>
    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; width: 100%;">
      <button id="enableNotifBtn" class="btn btn-primary" style="flex: 1 1 auto; min-width: 140px; font-size: 0.9rem; padding: 0.5rem;">Enable notifications</button>
      <button id="notNowNotifBtn" class="btn btn-ghost" style="flex: 1 1 auto; min-width: 100px; font-size: 0.9rem; padding: 0.5rem;">Not now</button>
    </div>
  `;

  const header = document.querySelector('.app-header');
  if (header && header.nextSibling) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    document.body.insertBefore(banner, document.body.firstChild);
  }

  document.getElementById('enableNotifBtn').addEventListener('click', async () => {
    await window.requestNotificationPermission();
  });

  document.getElementById('notNowNotifBtn').addEventListener('click', () => {
    localStorage.setItem('notif_cooldown', Date.now().toString());
    banner.style.display = 'none';
  });
}

function removeNotificationBanner() {
  const banner = document.getElementById('notification-onboarding-banner');
  if (banner) banner.remove();
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = isError ? 'var(--ll-negative)' : 'var(--ll-positive)';
  toast.style.color = 'white';
  toast.style.padding = '0.75rem 1.5rem';
  toast.style.borderRadius = '999px';
  toast.style.zIndex = '9999';
  toast.style.fontWeight = '500';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.textAlign = 'center';
  toast.style.width = 'max-content';
  toast.style.maxWidth = '90%';
  toast.innerHTML = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// =====================================================
// INITIALIZE FIREBASE
// =====================================================

async function initializeFirebaseMessaging() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    console.warn("Push notifications are not supported in this environment.");
    return;
  }

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const { getMessaging, getToken, deleteToken, onMessage } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");

    const app = initializeApp(firebaseConfig);
    messaging = getMessaging(app);
    getTokenFunction = getToken;
    deleteTokenFunction = deleteToken;

    swRegistration = await navigator.serviceWorker.ready;
    console.log("Firebase Messaging initialized successfully.");

    window.clearFCMToken = async () => {
      window.isLoggingOut = true;
      for (const c of window.fcmAbortControllers) c.abort();
      for (const p of window.pendingFCMRegistrations) {
        try { await p; } catch (e) {}
      }
      if (messaging && deleteTokenFunction && getTokenFunction) {
        try {
          const authToken = localStorage.getItem("lendlocal_token");
          let currentToken = null;
          try {
             currentToken = await getTokenFunction(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swRegistration });
          } catch(e) {}

          if (authToken && currentToken) {
            await fetch("/api/auth/fcm-token", {
              method: "DELETE",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${authToken}` },
              body: JSON.stringify({ token: currentToken })
            }).catch(() => {});
          }
          await deleteTokenFunction(messaging);
          console.log("FCM token deleted locally.");
        } catch(e) {
          console.error("Error deleting FCM token", e);
        }
      }
    };

    window.requestNotificationPermission = async function () {
      const p = (async () => {
        const controller = new AbortController();
        window.fcmAbortControllers.add(controller);
      if (!("Notification" in window)) {
        showToast("This browser does not support notifications.", true);
        return null;
      }

      if (Notification.permission === 'denied') {
        alert("Notification permission is blocked. Please open your browser settings, enable notifications for this site, and reload the page.");
        return null;
      }

      const initialAuthToken = localStorage.getItem("lendlocal_token");
      if (!initialAuthToken) {
        showToast("Please log in before enabling notifications.", true);
        return null;
      }

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        console.log("Notification permission was not granted.");
        if (permission === 'denied') {
          alert("Notification permission is blocked. Please open your browser settings, enable notifications for this site, and reload the page.");
        }
        removeNotificationBanner();
        return null;
      }

      try {
        const token = await getTokenFunction(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: swRegistration
        });

        if (!token) {
          throw new Error("Could not generate notification token.");
        }

        const currentAuthToken = localStorage.getItem("lendlocal_token");
        if (window.isLoggingOut || initialAuthToken !== currentAuthToken) {
          console.warn("Session changed or logging out; discarding token registration.");
          return null;
        }

        const response = await fetch("/api/auth/fcm-token", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${currentAuthToken}` },
          body: JSON.stringify({ token: token }),
          signal: controller.signal
        });

        if (window.isLoggingOut || initialAuthToken !== localStorage.getItem("lendlocal_token")) {
           return null;
        }

        const data = await response.json();
        if (!response.ok) {
          if (response.status === 401) {
            const err = new Error(data.message || "Session expired.");
            err.status = 401;
            throw err;
          }
          throw new Error(data.message || "Failed to save FCM token.");
        }

        console.log("FCM token saved to LendLocal account.");
        removeNotificationBanner();
        showToast("Notifications enabled!");
        return token;
      } catch (error) {
        console.error("FCM token setup error:", error);

        if (error.status === 401) {
          alert("Please sign in again to enable notifications.");
          return null;
        }

        if (!window.isLoggingOut && error.name !== "AbortError" && confirm("Could not enable notifications due to a network or server error. Try again?")) {
           return window.requestNotificationPermission();
        }
        return null;
      }
    })();
    p.finally(() => window.pendingFCMRegistrations.delete(p));
    window.pendingFCMRegistrations.add(p);
    return await p;
  };

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isSignedin = !!localStorage.getItem("lendlocal_token");
    const cooldown = localStorage.getItem('notif_cooldown');
    const hasCooldown = cooldown && (Date.now() - parseInt(cooldown, 10)) < (24 * 60 * 60 * 1000);

    if (isSignedin) {
      if (Notification.permission === 'granted') {
        const p = (async () => {
          const controller = new AbortController();
          window.fcmAbortControllers.add(controller);
          try {
            const initialAuthToken = localStorage.getItem("lendlocal_token");
            const token = await getTokenFunction(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swRegistration });
          const currentAuthToken = localStorage.getItem("lendlocal_token");

          if (token && !window.isLoggingOut && initialAuthToken === currentAuthToken) {
             const res = await fetch("/api/auth/fcm-token", {
               method: "POST",
               headers: { "Content-Type": "application/json", "Authorization": `Bearer ${currentAuthToken}` },
               body: JSON.stringify({ token: token }),
               signal: controller.signal
             });
             if (!res.ok) {
               console.error("Silent FCM registration failed on backend.");
               showToast("Could not sync notifications. Please check settings.", true);
             }
          }
        } catch(e) { console.error('Silent FCM registration failed', e); }
        })();
        await window.pendingFCMRegistration;
      } else if (Notification.permission === 'default' && isStandalone && !hasCooldown) {
        injectNotificationBanner();
      }
    }

    onMessage(messaging, (payload) => {
      console.log("Foreground notification received:", payload);
      let url = "/dashboard.html";

      if (payload.data) {
        if (payload.data.groupId) {
          if (payload.data.type === "payment_claim" && payload.data.paymentId) {
             url = "/group.html?id=" + payload.data.groupId + "&claimIntentId=" + payload.data.paymentId;
          } else if (payload.data.type === "payment_confirmed" || payload.data.type === "payment_rejected") {
             url = "/group.html?id=" + payload.data.groupId;
          }
        }

        if (payload.data.type === "payment_claim") {
          window.dispatchEvent(new CustomEvent('paymentClaim', { detail: payload.data }));
        } else if (payload.data.type === "payment_confirmed") {
          window.dispatchEvent(new CustomEvent('paymentConfirmed', { detail: payload.data }));
        } else if (payload.data.type === "payment_rejected") {
          window.dispatchEvent(new CustomEvent('paymentRejected', { detail: payload.data }));
        }
      }

      const title = payload.notification?.title || payload.data?.title || "LendLocal";
      const body = payload.notification?.body || payload.data?.body || "";

      if (Notification.permission === "granted" && swRegistration) {
        swRegistration.showNotification(title, {
          body: body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: payload.messageId || Date.now().toString(),
          data: { url: url }
        });
      }
    });

  } catch (error) {
    console.error("Firebase Messaging initialization error:", error);
  }
}

// =====================================================
// START
// =====================================================
initializeFirebaseMessaging();

// Wire settings button
function wireSettingsBtn() {
  const btn = document.getElementById('settingsEnableNotifBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      if (window.requestNotificationPermission) {
        window.requestNotificationPermission();
      } else {
        alert("Notification system is currently unavailable.");
      }
    });
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireSettingsBtn);
} else {
  wireSettingsBtn();
}
