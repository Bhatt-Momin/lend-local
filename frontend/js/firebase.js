// =====================================================
// LENDLOCAL — FIREBASE CLOUD MESSAGING
// =====================================================

// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCvCGfg3mZYMyDol2Yl4UpyxS5loOBacVM",
    authDomain: "lendlocal-b06af.firebaseapp.com",
    projectId: "lendlocal-b06af",
    storageBucket: "lendlocal-b06af.firebasestorage.app",
    messagingSenderId: "1063215090901",
    appId: "1:1063215090901:web:89aced6468d04c295de65c",
    measurementId: "G-PHCYFYWSCZ"
  };
  
  // Your Firebase Cloud Messaging Web Push certificate key
  const VAPID_KEY =
    "BAStMhg-rlFpO90XamsOZIMnBQhNc1Zm1oyVHvlOxMIhFzC4ufOLBiWAWNB4nQW-rY9JV5Ff1X94yqK8bzZkA3s";
  
  let messaging = null;
  let getTokenFunction = null;
  
  
  // =====================================================
  // INITIALIZE FIREBASE MESSAGING
  // =====================================================
  
  async function initializeFirebaseMessaging() {
  
    try {
  
      // Load Firebase App
      const { initializeApp } = await import(
        "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"
      );
  
  
      // Load Firebase Messaging
      const {
        getMessaging,
        getToken,
        onMessage
      } = await import(
        "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js"
      );
  
  
      // Initialize Firebase
      const app = initializeApp(firebaseConfig);
  
  
      // Initialize Messaging
      messaging = getMessaging(app);
  
  
      // Save getToken so we can use it later
      getTokenFunction = getToken;
  
  
      // Wait for your existing service worker
      const registration =
        await navigator.serviceWorker.ready;
  
  
      console.log(
        "Firebase Messaging initialized successfully."
      );
  
  
      // =================================================
      // FUNCTION CALLED BY ENABLE NOTIFICATIONS BUTTON
      // =================================================
  
      window.requestNotificationPermission =
        async function () {
  
          console.log(
            "Requesting notification permission..."
          );
  
  
          // Check browser support
          if (!("Notification" in window)) {
  
            alert(
              "This browser does not support notifications."
            );
  
            return null;
          }
  
  
          // Ask for permission
          const permission =
            await Notification.requestPermission();
  
  
          // Permission denied
          if (permission !== "granted") {
  
            console.log(
              "Notification permission was not granted."
            );
  
            alert(
              "Notification permission was not granted."
            );
  
            return null;
          }
  
  
          console.log(
            "Notification permission granted."
          );
  
  
          try {
  
            // Get the Firebase Cloud Messaging token
            const token =
              await getTokenFunction(
                messaging,
                {
                  vapidKey: VAPID_KEY,
                  serviceWorkerRegistration: registration
                }
              );
  
  
            // Check if token exists
            if (!token) {
  
              console.error(
                "No FCM registration token was generated."
              );
  
              alert(
                "No FCM token was generated. Check the browser console."
              );
  
              return null;
            }
  
  
            // Print token in console
            console.log(
              "===================================="
            );
  
            console.log(
              "FCM REGISTRATION TOKEN:"
            );
  
            console.log(token);
  
            console.log(
              "===================================="
            );
  
  
            // Show token so you can copy it
            alert(
              "FCM REGISTRATION TOKEN:\n\n" +
              token +
              "\n\nCopy this entire token."
            );
  
  
            return token;
  
  
          } catch (error) {
  
            console.error(
              "Error getting FCM token:",
              error
            );
  
  
            alert(
              "Error generating FCM token.\n\nCheck the browser console."
            );
  
  
            return null;
          }
  
        };
  
  
      // =================================================
      // HANDLE NOTIFICATIONS WHILE APP IS OPEN
      // =================================================
  
      onMessage(
        messaging,
        (payload) => {
  
          console.log(
            "Foreground notification received:",
            payload
          );
  
  
          const title =
            payload.notification?.title ||
            "LendLocal";
  
  
          const options = {
  
            body:
              payload.notification?.body ||
              "",
  
            icon:
              "/icons/icon-192.png"
  
          };
  
  
          // Show notification if permission exists
          if (
            Notification.permission === "granted"
          ) {
  
            new Notification(
              title,
              options
            );
  
          }
  
        }
      );
  
  
    } catch (error) {
  
      console.error(
        "Firebase Messaging initialization error:",
        error
      );
  
    }
  
  }
  
  
  // =====================================================
  // START FIREBASE MESSAGING
  // =================================================
  
  if (
    "serviceWorker" in navigator
  ) {
  
    initializeFirebaseMessaging();
  
  } else {
  
    console.error(
      "Service workers are not supported in this browser."
    );
  
  }