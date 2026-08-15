const express = require("express");
const router = express.Router();
const razorpay = require("../config/razorpay");

router.post("/create-order", async (req, res) => {
    try {
        const { amount } = req.body;

        const order = await razorpay.orders.create({
            amount: amount * 100,
            currency: "INR",
            receipt: `receipt_${Date.now()}`
        });

        res.status(200).json(order);

    } catch (error) {
        console.error("Payment error:", error);

        res.status(500).json({
            message: "Failed to create payment order"
        });
    }
});

module.exports = router;