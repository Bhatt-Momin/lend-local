const express = require("express");
const crypto = require("crypto");

const Payment = require("../models/payment");
const User = require("../models/User");
const Group = require("../models/Group");

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

    const numericAmount = Number(amount);

    // -------------------------------------------------
    // VALIDATE INPUT
    // -------------------------------------------------

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0 ||
      !groupId ||
      !toUserId
    ) {
      return res.status(400).json({
        message: "Valid amount, group and receiver are required",
      });
    }

    // -------------------------------------------------
    // PREVENT SELF-PAYMENT
    // -------------------------------------------------

    if (toUserId.toString() === req.user._id.toString()) {
      return res.status(400).json({
        message: "You cannot pay yourself",
      });
    }

    // -------------------------------------------------
    // FETCH GROUP
    // -------------------------------------------------

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).json({
        message: "Group not found",
      });
    }

    // -------------------------------------------------
    // VERIFY PAYER IS A GROUP MEMBER
    // -------------------------------------------------

    const payerIsMember = group.members.some((memberId) =>
      memberId.equals(req.user._id)
    );

    if (!payerIsMember) {
      return res.status(403).json({
        message: "You are not a member of this group",
      });
    }

    // -------------------------------------------------
    // VERIFY RECEIVER IS A GROUP MEMBER
    // -------------------------------------------------

    const receiverIsMember = group.members.some(
      (memberId) => memberId.toString() === toUserId.toString()
    );

    if (!receiverIsMember) {
      return res.status(400).json({
        message: "Receiver is not a member of this group",
      });
    }

    // -------------------------------------------------
    // CREATE RAZORPAY ORDER
    // -------------------------------------------------

    const order = await razorpay.orders.create({
      amount: Math.round(numericAmount * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,

      // IMPORTANT:
      // These values are established by the trusted backend and stored
      // with the Razorpay order. They are NOT trusted from the
      // /verify-payment request later.
      notes: {
        groupId: groupId.toString(),
        toUserId: toUserId.toString(),
        fromUserId: req.user._id.toString(),
      },
    });

    return res.status(200).json({
      ...order,
      groupId: groupId.toString(),
      toUserId: toUserId.toString(),
    });
  } catch (error) {
    console.error("Payment order creation error:", error);

    return res.status(500).json({
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
    } = req.body;

    // -------------------------------------------------
    // 1. VALIDATE REQUIRED RAZORPAY FIELDS
    // -------------------------------------------------

    if (
      !razorpay_payment_id ||
      !razorpay_order_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment details are missing",
      });
    }

    // -------------------------------------------------
    // 2. VERIFY RAZORPAY SIGNATURE
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

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Payment signature verification failed",
      });
    }

    // -------------------------------------------------
    // 3. PREVENT DUPLICATE RECORDING
    // -------------------------------------------------

    const existingPayment = await Payment.findOne({
      $or: [
        {
          razorpayPaymentId: razorpay_payment_id,
        },
        {
          razorpayOrderId: razorpay_order_id,
        },
      ],
    });

    if (existingPayment) {
      return res.status(400).json({
        success: false,
        message: "Payment already recorded",
      });
    }

    // -------------------------------------------------
    // 4. FETCH SERVER-CREATED RAZORPAY ORDER
    // -------------------------------------------------

    const fetchedOrder =
      await razorpay.orders.fetch(razorpay_order_id);

    const orderNotes = fetchedOrder.notes || {};

    const orderGroupId = orderNotes.groupId;
    const orderToUserId = orderNotes.toUserId;
    const orderFromUserId = orderNotes.fromUserId;

    const orderAmountPaise = Number(
      fetchedOrder.amount
    );

    // -------------------------------------------------
    // VALIDATE SERVER-SIDE ORDER DATA
    // -------------------------------------------------

    if (
      !orderGroupId ||
      !orderToUserId ||
      !orderFromUserId ||
      !Number.isFinite(orderAmountPaise) ||
      orderAmountPaise <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Order metadata is missing or invalid",
      });
    }

    // -------------------------------------------------
    // 5. VERIFY AUTHENTICATED USER IS ORIGINAL PAYER
    // -------------------------------------------------

    if (
      req.user._id.toString() !==
      orderFromUserId.toString()
    ) {
      return res.status(403).json({
        success: false,
        message: "Payment ownership mismatch",
      });
    }

    // -------------------------------------------------
    // PREVENT SELF-PAYMENT
    // -------------------------------------------------

    if (
      orderFromUserId.toString() ===
      orderToUserId.toString()
    ) {
      return res.status(400).json({
        success: false,
        message: "Self-payment is not allowed",
      });
    }

    // -------------------------------------------------
    // 6. FETCH THE SPECIFIC RAZORPAY PAYMENT
    // -------------------------------------------------

    const fetchedPayment =
      await razorpay.payments.fetch(
        razorpay_payment_id
      );

    // -------------------------------------------------
    // 7. VERIFY PAYMENT BELONGS TO THIS ORDER
    // -------------------------------------------------

    if (
      fetchedPayment.order_id !==
      razorpay_order_id
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment does not belong to this order",
      });
    }

    // -------------------------------------------------
    // 8. VERIFY PAYMENT WAS CAPTURED
    // -------------------------------------------------

    if (
      fetchedPayment.status !== "captured" ||
      fetchedPayment.captured !== true
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment has not been successfully captured",
      });
    }

    // -------------------------------------------------
    // 9. VERIFY PAYMENT AMOUNT MATCHES ORDER
    // -------------------------------------------------

    if (
      Number(fetchedPayment.amount) !==
      orderAmountPaise
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment amount does not match order amount",
      });
    }

    // -------------------------------------------------
    // 10. RECHECK GROUP MEMBERSHIP
    // -------------------------------------------------

    const group = await Group.findById(orderGroupId);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: "Group no longer exists",
      });
    }

    const payerIsMember = group.members.some(
      (memberId) =>
        memberId.toString() ===
        orderFromUserId.toString()
    );

    const receiverIsMember = group.members.some(
      (memberId) =>
        memberId.toString() ===
        orderToUserId.toString()
    );

    if (!payerIsMember) {
      return res.status(403).json({
        success: false,
        message: "Payer is no longer a member of this group",
      });
    }

    if (!receiverIsMember) {
      return res.status(403).json({
        success: false,
        message: "Receiver is no longer a member of this group",
      });
    }

    // -------------------------------------------------
    // 11. SAVE SETTLEMENT RECORD
    // -------------------------------------------------

    const orderAmountRupees =
      orderAmountPaise / 100;

    let payment;

    try {
      payment = await Payment.create({
        group: orderGroupId,
        from: orderFromUserId,
        to: orderToUserId,
        amount: orderAmountRupees,
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId: razorpay_order_id,
        status: "paid",
      });
    } catch (createError) {
      // Handle MongoDB duplicate-key race condition.
      if (createError?.code === 11000) {
        return res.status(400).json({
          success: false,
          message: "Payment already recorded",
        });
      }

      throw createError;
    }

    // =================================================
    // SEND PAYMENT NOTIFICATION
    // =================================================

    try {
      const receiver = await User.findById(
        orderToUserId
      ).select("name email fcmToken");

      if (receiver && receiver.fcmToken) {
        const payerName =
          req.user.name || "Someone";

        const notifTitle =
          "Payment received 💰";

        const notifBody =
          `${payerName} paid you ₹${orderAmountRupees.toFixed(2)}`;

        const fcmMessage = {
          token: receiver.fcmToken,

          notification: {
            title: notifTitle,
            body: notifBody,
          },

          webpush: {
            notification: {
              icon: "/icons/icon-192.png",
              badge: "/icons/icon-192.png",
            },

            fcmOptions: {
              link: "/dashboard.html",
            },
          },

          data: {
            type: "payment",
            paymentId: payment._id.toString(),
            groupId: orderGroupId.toString(),
            fromUserId:
              orderFromUserId.toString(),
            toUserId:
              orderToUserId.toString(),
            amount:
              orderAmountRupees.toFixed(2),
            title: notifTitle,
            body: notifBody,
          },
        };

        const fcmResponse =
          await getMessaging().send(
            fcmMessage
          );

        console.log(
          "Payment notification sent:",
          fcmResponse
        );
      } else {
        console.log(
          "Payment notification skipped: receiver has no FCM token."
        );
      }
    } catch (notificationError) {
      // IMPORTANT:
      // The payment has already been verified and saved.
      // Notification failure must NOT make the payment appear unsuccessful.

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
      message: "Payment verification failed",
    });
  }
});

module.exports = router;