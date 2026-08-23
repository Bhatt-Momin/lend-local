const express = require("express");
const crypto = require("crypto");

const Payment = require("../models/payment");
const User = require("../models/User");

const { protect } = require("../middleware/auth");
const razorpay = require("../config/razorpay");

const { getMessaging } = require("firebase-admin/messaging");

const router = express.Router();


// =====================================================
// CREATE RAZORPAY ORDER
// =====================================================

router.post("/create-order", protect, async (req, res) => {
  try {
    const { amount, groupId, toUserId } = req.body;

    if (
      !amount ||
      !groupId ||
      !toUserId ||
      Number(amount) <= 0
    ) {
      return res.status(400).json({
        message: "Amount, group and receiver are required",
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(Number(amount) * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });

    res.status(200).json({
      ...order,
      groupId,
      toUserId,
    });

  } catch (error) {
    console.error("Payment error:", error);

    res.status(500).json({
      message: "Failed to create payment order",
    });
  }
});


// =====================================================
// VERIFY AND SAVE PAYMENT
// =====================================================

router.post("/verify-payment", protect, async (req, res) => {
  try {

    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      amount,
      groupId,
      toUserId,
    } = req.body;


    // -------------------------------------------------
    // VALIDATE PAYMENT DATA
    // -------------------------------------------------

    if (
      !razorpay_payment_id ||
      !razorpay_order_id ||
      !razorpay_signature ||
      !amount ||
      !groupId ||
      !toUserId
    ) {
      return res.status(400).json({
        message: "Payment details are missing",
      });
    }


    // -------------------------------------------------
    // VERIFY RAZORPAY SIGNATURE
    // -------------------------------------------------

    const generatedSignature = crypto
      .createHmac(
        "sha256",
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(
        `${razorpay_order_id}|${razorpay_payment_id}`
      )
      .digest("hex");


    if (
      generatedSignature !==
      razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }


    // -------------------------------------------------
    // PREVENT DUPLICATE PAYMENT
    // -------------------------------------------------

    const existingPayment =
      await Payment.findOne({
        razorpayPaymentId:
          razorpay_payment_id,
      });


    if (existingPayment) {
      return res.status(400).json({
        message: "Payment already recorded",
      });
    }


    // -------------------------------------------------
    // SAVE PAYMENT
    // -------------------------------------------------

    const payment =
      await Payment.create({

        group: groupId,

        from: req.user._id,

        to: toUserId,

        amount: Number(amount),

        razorpayPaymentId:
          razorpay_payment_id,

        razorpayOrderId:
          razorpay_order_id,

        status: "paid",

      });


    // =================================================
    // SEND PAYMENT NOTIFICATION
    // =================================================

    try {

      const receiver =
        await User.findById(
          toUserId
        ).select(
          "name email fcmToken"
        );


      if (
        receiver &&
        receiver.fcmToken
      ) {

        const payerName =
          req.user.name ||
          "Someone";


        const title =
          "Payment received 💰";


        const body =
          `${payerName} paid you ₹${Number(amount).toFixed(2)}`;


        const message = {

          token:
            receiver.fcmToken,


          notification: {

            title,

            body,

          },


          webpush: {

            notification: {

              icon:
                "/icons/icon-192.png",

              badge:
                "/icons/icon-192.png",

            },

            fcmOptions: {

              link:
                "/dashboard.html",

            },

          },


          data: {

            type:
              "payment",

            paymentId:
              payment._id.toString(),

            groupId:
              groupId.toString(),

            fromUserId:
              req.user._id.toString(),

            toUserId:
              toUserId.toString(),

            amount:
              Number(amount).toFixed(2),

            title,

            body,

          },

        };


        const response =
          await getMessaging()
            .send(message);


        console.log(
          "Payment notification sent:",
          response
        );

      } else {

        console.log(
          "Payment notification skipped: receiver has no FCM token."
        );

      }

    } catch (
      notificationError
    ) {

      // IMPORTANT:
      // Payment was already verified and saved.
      // Notification failure must NOT make
      // the payment appear unsuccessful.

      console.error(
        "Payment notification error:",
        notificationError
      );

    }


    // -------------------------------------------------
    // RESPONSE
    // -------------------------------------------------

    return res.status(200).json({

      success: true,

      message:
        "Payment verified and recorded successfully",

      payment,

    });


  } catch (error) {

    console.error(
      "Payment verification error:",
      error
    );

    return res.status(500).json({

      success: false,

      message:
        "Payment verification failed",

    });

  }

});


module.exports = router;