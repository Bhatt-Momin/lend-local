const express = require("express");
const crypto = require("crypto");

const Payment = require("../models/payment");
const User = require("../models/User");
const Group = require("../models/Group");

const { protect } = require("../middleware/auth");
const razorpay = require("../config/razorpay");

const { getMessaging } = require("firebase-admin/messaging");
const { getGroupLedger } = require("../utils/helpers");

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
    // VERIFY STRICT PAIRWISE SETTLEMENT FROM LEDGER
    // -------------------------------------------------

    const ledger = await getGroupLedger(groupId);

    const validSettlement = ledger.settlements.find(
      (s) => s.from.id === req.user._id.toString() && s.to.id === toUserId.toString()
    );

    if (!validSettlement) {
      return res.status(403).json({
        message: "No valid payable relationship established by ledger",
      });
    }

    const requestedPaise = Math.round(numericAmount * 100);
    const authorizedPaise = Math.round(validSettlement.amount * 100);

    if (requestedPaise > authorizedPaise) {
      return res.status(400).json({
        message: "Payment exceeds authorized settlement amount",
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
    // 10. RE-VERIFY STRICT PAIRWISE SETTLEMENT FROM LEDGER
    // -------------------------------------------------

    const ledger = await getGroupLedger(orderGroupId);

    const validSettlement = ledger.settlements.find(
      (s) => s.from.id === orderFromUserId.toString() && s.to.id === orderToUserId.toString()
    );

    if (!validSettlement) {
      return res.status(403).json({
        success: false,
        message: "No valid payable relationship established by ledger",
      });
    }

    const authorizedPaise = Math.round(validSettlement.amount * 100);

    if (orderAmountPaise > authorizedPaise) {
      return res.status(400).json({
        success: false,
        message: "Payment exceeds currently authorized settlement amount",
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


// =====================================================
// CREATE DIRECT UPI INTENT
// =====================================================
router.post("/intent", protect, async (req, res) => {
  try {
    const { groupId, toUserId, amount } = req.body;

    if (
      typeof groupId !== 'string' ||
      typeof toUserId !== 'string' ||
      !/^[0-9a-fA-F]{24}$/.test(groupId) ||
      !/^[0-9a-fA-F]{24}$/.test(toUserId)
    ) {
      return res.status(400).json({ message: "Valid group and receiver IDs are required" });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Valid amount is required" });
    }

    if (toUserId.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot pay yourself" });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const isActiveMember = group.members.some(m => m.toString() === req.user._id.toString());
    if (!isActiveMember) {
      return res.status(403).json({ message: "You are not an active member of this group" });
    }

    const requestedPaise = Math.round(numericAmount * 100);

    if (!Number.isFinite(requestedPaise) || requestedPaise < 1 || numericAmount < 0.01) {
      return res.status(400).json({ message: "Amount must be at least ₹0.01" });
    }

    const paymentAmount = requestedPaise / 100;

    // Helper: build intent response with UPI deep-link URI
    const buildIntentResponse = (payment, statusCode) => {
      const pa = encodeURIComponent(payment.payeeUpiId);
      const pn = encodeURIComponent(payment.payeeName);
      const tr = encodeURIComponent(payment.upiTransactionRef);
      const am = encodeURIComponent(payment.amount.toFixed(2));
      const cu = encodeURIComponent("INR");
      const tn = encodeURIComponent("LendLocal Settlement");
      const upiUri = `upi://pay?pa=${pa}&pn=${pn}&tr=${tr}&am=${am}&cu=${cu}&tn=${tn}`;
      return res.status(statusCode).json({
        intentId: payment._id,
        upiUri,
        payeeName: payment.payeeName,
        payeeUpiId: payment.payeeUpiId,
        amount: payment.amount,
        status: payment.status,
      });
    };

    // One-active-intent guard: check BEFORE ledger cap check
    const existingActive = await Payment.findOne({
      group: groupId,
      from: req.user._id,
      to: toUserId,
      method: "upi_direct",
      status: { $in: ["pending", "payer_claimed"] },
    });

    if (existingActive) {
      if (Math.round(existingActive.amount * 100) === requestedPaise) {
        return buildIntentResponse(existingActive, 200);
      }
      return res.status(409).json({
        message: "An active UPI payment already exists for this recipient. Complete or cancel it first.",
        intentId: existingActive._id,
        status: existingActive.status,
      });
    }

    // New intent flow -> check recipient UPI and ledger cap
    const recipient = await User.findById(toUserId);
    if (!recipient) {
      return res.status(404).json({ message: "Recipient not found" });
    }

    if (!recipient.upiId) {
      return res.status(400).json({ message: "Recipient has not configured a UPI payment method" });
    }

    const ledger = await getGroupLedger(groupId);
    const validSettlement = ledger.settlements.find(
      (s) => s.from.id === req.user._id.toString() && s.to.id === toUserId.toString()
    );

    if (!validSettlement) {
      return res.status(403).json({ message: "No valid payable relationship established by ledger" });
    }

    const authorizedPaise = Math.round(validSettlement.amount * 100);

    if (requestedPaise > authorizedPaise) {
      return res.status(400).json({ message: "Payment exceeds authorized settlement amount" });
    }

    // Create new intent — partial unique index is the concurrency backstop
    let payment;
    try {
      payment = await Payment.create({
        group: groupId,
        from: req.user._id,
        to: toUserId,
        amount: paymentAmount,
        method: "upi_direct",
        status: "pending",
        payeeUpiId: recipient.upiId,
        payeeName: recipient.name,
      });
      payment.upiTransactionRef = payment._id.toString();
      await payment.save();
    } catch (createError) {
      // Race: concurrent request hit the partial unique index before us
      if (createError.code === 11000) {
        const racedIntent = await Payment.findOne({
          group: groupId,
          from: req.user._id,
          to: toUserId,
          method: "upi_direct",
          status: { $in: ["pending", "payer_claimed"] },
        });
        if (racedIntent) {
          if (Math.round(racedIntent.amount * 100) === requestedPaise) {
            return buildIntentResponse(racedIntent, 200);
          }
          return res.status(409).json({
            message: "An active UPI payment already exists for this recipient. Complete or cancel it first.",
            intentId: racedIntent._id,
            status: racedIntent.status,
          });
        }
      }
      throw createError;
    }

    return buildIntentResponse(payment, 201);
  } catch (error) {
    console.error("Direct UPI Intent creation error:", error);
    res.status(500).json({ message: "Failed to create payment intent" });
  }
});

// =====================================================
// HELPER: send FCM notification — non-blocking, never throws
// =====================================================
async function sendFcm(userId, title, bodyStr, data) {
  try {
    const user = await User.findById(userId).select("fcmToken");
    if (!user || !user.fcmToken) {
      console.log(`FCM skipped for user ${userId}: no token.`);
      return false;
    }
    const message = {
      token: user.fcmToken,
      notification: { title, body: bodyStr },
      webpush: {
        notification: { icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" },
        fcmOptions: { link: "/dashboard.html" },
      },
      data: Object.fromEntries(
        Object.entries(data || {}).map(([k, v]) => [k, String(v)])
      ),
    };
    const response = await getMessaging().send(message);
    console.log(`FCM sent to user ${userId}:`, response);
    return true;
  } catch (err) {
    console.error(`FCM delivery failed for user ${userId}:`, err.message);
    return false;
  }
}

// =====================================================
// HELPER: validate intentId from request body
// =====================================================
function parseIntentId(body) {
  const { intentId } = body || {};
  if (typeof intentId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(intentId)) {
    return null;
  }
  return intentId;
}

// =====================================================
// CLAIM  pending -> payer_claimed  (payer only)
// =====================================================
router.post("/claim", protect, async (req, res) => {
  try {
    const intentId = parseIntentId(req.body);
    if (!intentId) {
      return res.status(400).json({ message: "Valid intentId is required" });
    }

    const updated = await Payment.findOneAndUpdate(
      { _id: intentId, method: "upi_direct", from: req.user._id, status: "pending" },
      { $set: { status: "payer_claimed", claimedAt: new Date() } },
      { new: true }
    );

    if (updated) {
      const notificationSent = await sendFcm(
        updated.to,
        "Payment claim 💸",
        `${req.user.name || "Someone"} says they paid ₹${updated.amount.toFixed(2)}. Check your UPI/bank app and confirm receipt.`,
        { type: "payment_claim", paymentId: String(updated._id), amount: updated.amount.toFixed(2) }
      );
      return res.status(200).json({
        message: "Payment claimed successfully",
        intentId: updated._id,
        status: updated.status,
        amount: updated.amount,
        notificationSent,
      });
    }

    const payment = await Payment.findOne({ _id: intentId, method: "upi_direct" });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.from.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to claim this payment" });
    }

    if (payment.status === "payer_claimed") {
      return res.status(200).json({
        message: "Payment was already claimed",
        intentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        notificationSent: false,
      });
    }

    return res.status(409).json({
      message: `Cannot claim a payment with status: ${payment.status}`,
      intentId: payment._id,
      status: payment.status,
    });
  } catch (error) {
    console.error("Payment claim error:", error);
    res.status(500).json({ message: "Failed to claim payment" });
  }
});

// =====================================================
// CONFIRM  payer_claimed -> recipient_confirmed  (recipient only)
// =====================================================
router.post("/confirm", protect, async (req, res) => {
  try {
    const intentId = parseIntentId(req.body);
    if (!intentId) {
      return res.status(400).json({ message: "Valid intentId is required" });
    }

    const updated = await Payment.findOneAndUpdate(
      { _id: intentId, method: "upi_direct", to: req.user._id, status: "payer_claimed" },
      { $set: { status: "recipient_confirmed", confirmedAt: new Date() } },
      { new: true }
    );

    if (updated) {
      const notificationSent = await sendFcm(
        updated.from,
        "Payment confirmed ✅",
        `${req.user.name || "Someone"} confirmed receiving ₹${updated.amount.toFixed(2)}.`,
        { type: "payment_confirmed", paymentId: String(updated._id), amount: updated.amount.toFixed(2) }
      );
      return res.status(200).json({
        message: "Payment confirmed. The settlement has been applied to the ledger.",
        intentId: updated._id,
        status: updated.status,
        amount: updated.amount,
        notificationSent,
      });
    }

    const payment = await Payment.findOne({ _id: intentId, method: "upi_direct" });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to confirm this payment" });
    }

    if (payment.status === "recipient_confirmed") {
      return res.status(200).json({
        message: "Payment was already confirmed",
        intentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        notificationSent: false,
      });
    }

    return res.status(409).json({
      message: `Cannot confirm a payment with status: ${payment.status}`,
      intentId: payment._id,
      status: payment.status,
    });
  } catch (error) {
    console.error("Payment confirm error:", error);
    res.status(500).json({ message: "Failed to confirm payment" });
  }
});

// =====================================================
// REJECT  payer_claimed -> recipient_rejected  (recipient only)
// =====================================================
router.post("/reject", protect, async (req, res) => {
  try {
    const intentId = parseIntentId(req.body);
    if (!intentId) {
      return res.status(400).json({ message: "Valid intentId is required" });
    }

    const updated = await Payment.findOneAndUpdate(
      { _id: intentId, method: "upi_direct", to: req.user._id, status: "payer_claimed" },
      { $set: { status: "recipient_rejected", rejectedAt: new Date() } },
      { new: true }
    );

    if (updated) {
      const notificationSent = await sendFcm(
        updated.from,
        "Payment rejected ❌",
        `${req.user.name || "Someone"} rejected your payment of ₹${updated.amount.toFixed(2)}. Please verify.`,
        { type: "payment_rejected", paymentId: String(updated._id), amount: updated.amount.toFixed(2) }
      );
      return res.status(200).json({
        message: "Payment rejected. No ledger change has been made.",
        intentId: updated._id,
        status: updated.status,
        amount: updated.amount,
        notificationSent,
      });
    }

    const payment = await Payment.findOne({ _id: intentId, method: "upi_direct" });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.to.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to reject this payment" });
    }

    if (payment.status === "recipient_rejected") {
      return res.status(200).json({
        message: "Payment was already rejected",
        intentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        notificationSent: false,
      });
    }

    return res.status(409).json({
      message: `Cannot reject a payment with status: ${payment.status}`,
      intentId: payment._id,
      status: payment.status,
    });
  } catch (error) {
    console.error("Payment reject error:", error);
    res.status(500).json({ message: "Failed to reject payment" });
  }
});

// =====================================================
// CANCEL  pending -> cancelled  (payer only)
// payer_claimed may NOT be cancelled: financial ambiguity risk
// =====================================================
router.post("/cancel", protect, async (req, res) => {
  try {
    const intentId = parseIntentId(req.body);
    if (!intentId) {
      return res.status(400).json({ message: "Valid intentId is required" });
    }

    const updated = await Payment.findOneAndUpdate(
      { _id: intentId, method: "upi_direct", from: req.user._id, status: "pending" },
      { $set: { status: "cancelled", cancelledAt: new Date() } },
      { new: true }
    );

    if (updated) {
      return res.status(200).json({
        message: "Payment intent cancelled. No ledger change has been made.",
        intentId: updated._id,
        status: updated.status,
        amount: updated.amount,
        notificationSent: false,
      });
    }

    const payment = await Payment.findOne({ _id: intentId, method: "upi_direct" });
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    if (payment.from.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You are not authorized to cancel this payment" });
    }

    if (payment.status === "cancelled") {
      return res.status(200).json({
        message: "Payment was already cancelled",
        intentId: payment._id,
        status: payment.status,
        amount: payment.amount,
        notificationSent: false,
      });
    }

    return res.status(409).json({
      message: `Cannot cancel a payment with status: ${payment.status}. Once claimed, a payment cannot be cancelled.`,
      intentId: payment._id,
      status: payment.status,
    });
  } catch (error) {
    console.error("Payment cancel error:", error);
    res.status(500).json({ message: "Failed to cancel payment" });
  }
});

module.exports = router;
