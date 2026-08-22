const express = require("express");
const router = express.Router();

const { getMessaging } = require("firebase-admin/messaging");

router.post("/test", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        message: "FCM token is required"
      });
    }

    const message = {
      token,

      webpush: {
        headers: {
          Urgency: "high"
        },

        notification: {
          title: "LendLocal 🔔",
          body: "Your Firebase push notification is working!",
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png"
        },

        fcmOptions: {
          link: "http://localhost:3000/dashboard.html"
        }
      },

      data: {
        title: "LendLocal 🔔",
        body: "Your Firebase push notification is working!"
      }
    };

    const response = await getMessaging().send(message);

    console.log("FCM message accepted:", response);

    res.status(200).json({
      message: "Notification sent successfully",
      firebaseResponse: response
    });

  } catch (error) {
    console.error("Error sending notification:", error);

    res.status(500).json({
      message: "Failed to send notification",
      error: error.message
    });
  }
});

module.exports = router;