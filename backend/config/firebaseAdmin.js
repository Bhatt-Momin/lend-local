const { initializeApp, cert, getApps } = require("firebase-admin/app");

let serviceAccount;

if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_CLIENT_EMAIL &&
  process.env.FIREBASE_PRIVATE_KEY
) {
  serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  };
} else {
  serviceAccount = require("./firebase-service-account.json");
}

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

console.log("Firebase Admin initialized successfully");