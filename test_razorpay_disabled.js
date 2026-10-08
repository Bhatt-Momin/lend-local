console.log("Starting test script for Razorpay Disabled Guard...");
process.env.JWT_SECRET = 'lendlocal_test_secret';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/lendlocal';
process.env.RAZORPAY_KEY_ID = 'rzp_test_123';
process.env.RAZORPAY_KEY_SECRET = 'secret_123';
// Ensure RAZORPAY_ENABLED is false
delete process.env.RAZORPAY_ENABLED;

const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const http = require('http');

const paymentRouter = require('./backend/routes/payment');
const User = require('./backend/models/User');

async function runTests() {
  const TEST_DB_URI = process.env.MONGODB_URI + '_test_rzp_disabled_' + Date.now();
  await mongoose.connect(TEST_DB_URI);
  console.log('Connected to test DB:', TEST_DB_URI);

  // Set up fixtures
  const user1 = await User.create({
    name: "User One",
    email: "user1@example.com",
    password: "password",
    phone: "1111111111"
  });
  
  const user2 = await User.create({
    name: "User Two",
    email: "user2@example.com",
    password: "password",
    phone: "2222222222"
  });

  // Start app
  const app = express();
  app.use(express.json());
  // Mount the router
  app.use('/payment', paymentRouter);
  
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const token1 = jwt.sign({ id: user1._id }, process.env.JWT_SECRET);

  let failed = false;

  async function fetchWithAuth(url, method = 'GET', body = null, token) {
    const options = { method, headers: {} };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + url, options);
    const resBody = await res.json().catch(() => null);
    return { status: res.status, body: resBody };
  }

  try {
    console.log("--- Testing POST /payment/create-order (Razorpay Disabled) ---");

    const createOrderPayload = {
      amount: 100,
      currency: 'INR',
      groupId: new mongoose.Types.ObjectId().toString(),
      toUserId: user2._id.toString()
    };

    let res = await fetchWithAuth('/payment/create-order', 'POST', createOrderPayload, token1);
    console.log("Create Order Response:", res.status, res.body);
    assert.strictEqual(res.status, 503, "Expected 503 Maintenance for Razorpay creation");
    assert.ok(res.body.message.includes('maintenance'), "Expected maintenance message in response");

    console.log("--- Testing POST /payment/intent (UPI Routing) ---");
    
    // Testing UPI intent validation - should not return 503.
    // We send an incomplete payload to verify it reaches validation logic.
    res = await fetchWithAuth('/payment/intent', 'POST', {}, token1);
    console.log("UPI Intent Response:", res.status, res.body);
    assert.notStrictEqual(res.status, 503, "Expected UPI endpoint to bypass the 503 guard");
    assert.strictEqual(res.status, 400, "Expected 400 Validation Error as proof it reached the UPI logic");

    console.log("✅ All Razorpay disabled guard assertions passed.");
  } catch (err) {
    console.error("Test failed:", err);
    failed = true;
  } finally {
    // Cleanup
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
    if (failed) process.exit(1);
  }
}

runTests();

