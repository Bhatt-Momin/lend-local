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

const VAPID_KEY =
  "BAStMhg-rlFpO90XamsOZIMnBQhNc1Zm1oyVHvlOxMIhFzC4ufOLBiWAWNB4nQW-rY9JV5Ff1X94yqK8bzZkA3s";

let messaging = null;
let getTokenFunction = null;


// =====================================================
// INITIALIZE FIREBASE
// =====================================================

async function initializeFirebaseMessaging() {

  try {

    const { initializeApp } = await import(
      "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js"
    );

    const {
      getMessaging,
      getToken,
      onMessage
    } = await import(
      "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js"
    );

    const app = initializeApp(firebaseConfig);

    messaging = getMessaging(app);

    getTokenFunction = getToken;

    // Wait for LendLocal service worker
    const registration =
      await navigator.serviceWorker.ready;

    console.log(
      "Firebase Messaging initialized successfully."
    );


    // =================================================
    // ENABLE NOTIFICATIONS
    // =================================================

    window.requestNotificationPermission =
      async function () {

        if (!("Notification" in window)) {

          alert(
            "This browser does not support notifications."
          );

          return null;
        }


        // Ask for notification permission
        const permission =
          await Notification.requestPermission();


        if (permission !== "granted") {

          console.log(
            "Notification permission was not granted."
          );

          alert(
            "Notification permission was not granted."
          );

          return null;
        }


        try {

          // Generate FCM registration token
          const token =
            await getTokenFunction(
              messaging,
              {
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration:
                  registration
              }
            );


          if (!token) {

            console.error(
              "No FCM registration token was generated."
            );

            alert(
              "Could not generate notification token."
            );

            return null;
          }


          console.log(
            "FCM registration token generated."
          );


          // =================================================
          // GET LOGIN TOKEN
          // =================================================

          const authToken =
            localStorage.getItem(
              "lendlocal_token"
            );


          if (!authToken) {

            console.error(
              "No LendLocal authentication token found."
            );

            alert(
              "Please log in before enabling notifications."
            );

            return null;
          }


          // =================================================
          // SAVE FCM TOKEN TO BACKEND
          // =================================================

          const response =
            await fetch(
              "/api/auth/fcm-token",
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  "Authorization":
                    `Bearer ${authToken}`
                },

                body: JSON.stringify({
                  token: token
                })
              }
            );


          const data =
            await response.json();


          if (!response.ok) {

            throw new Error(
              data.message ||
              "Failed to save FCM token."
            );

          }


          console.log(
            "FCM token saved to LendLocal account."
          );


          console.log(
            data
          );


          return token;

        } catch (error) {

          console.error(
            "FCM token setup error:",
            error
          );

          alert(
            "Could not enable notifications.\n\n" +
            error.message
          );

          return null;
        }

      };


    // =================================================
    // FOREGROUND NOTIFICATIONS
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
          payload.data?.title ||
          "LendLocal";


        const body =
          payload.notification?.body ||
          payload.data?.body ||
          "";


        if (
          Notification.permission ===
          "granted"
        ) {

          new Notification(
            title,
            {
              body: body,
              icon: "/icons/icon-192.png"
            }
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
// START
// =====================================================

if (
  "serviceWorker" in navigator
) {

  initializeFirebaseMessaging();

} else {

  console.error(
    "Service workers are not supported."
  );

}