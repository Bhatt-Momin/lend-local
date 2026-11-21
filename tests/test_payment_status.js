console.log("Starting test script...");
process.env.JWT_SECRET = 'lendlocal_test_secret';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/lendlocal';
process.env.RAZORPAY_KEY_ID = 'rzp_test_123';
process.env.RAZORPAY_KEY_SECRET = 'secret_123';
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const http = require('http');

const paymentRouter = require('./backend/routes/payment');
const User = require('./backend/models/User');
const Payment = require('./backend/models/payment');

async function runTests() {
  const TEST_DB_URI = process.env.MONGODB_URI + '_test_payment_status_' + Date.now();
  await mongoose.connect(TEST_DB_URI);
  console.log('Connected to test DB:', TEST_DB_URI);

  // Set up fixtures
  const user1 = await User.create({
    name: "User One",
    email: "user1@example.com",
    password: "password"
  });
  
  const user2 = await User.create({
    name: "User Two",
    email: "user2@example.com",
    password: "password"
  });

  const user3 = await User.create({
    name: "User Three",
    email: "user3@example.com",
    password: "password"
  });

  const validIntent = await Payment.create({
    amount: 100,
    status: "pending",
    from: user1._id,
    to: user2._id,
    group: new mongoose.Types.ObjectId(),
    method: 'razorpay'
  });

  // Start app
  const app = express();
  app.use(express.json());
  // Mount the router as it would be mounted in the actual app
  app.use('/payment', paymentRouter);
  
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  const token1 = jwt.sign({ id: user1._id }, process.env.JWT_SECRET);
  const token2 = jwt.sign({ id: user2._id }, process.env.JWT_SECRET);
  const token3 = jwt.sign({ id: user3._id }, process.env.JWT_SECRET);

  let failed = false;

  async function fetchWithAuth(url, token) {
    const options = { headers: {} };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(baseUrl + url, options);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  try {
    console.log("--- Testing GET /payment/status/:intentId ---");

    // 1. No authentication -> 401
    let res = await fetchWithAuth(`/payment/status/${validIntent._id}`);
    console.log("Unauthenticated:", res.status, res.body);
    assert.strictEqual(res.status, 401, "Expected 401 for no auth");

    // 2. Malformed intent ID -> 400
    res = await fetchWithAuth(`/payment/status/invalid123`, token1);
    console.log("Malformed ID:", res.status, res.body);
    assert.strictEqual(res.status, 400, "Expected 400 for malformed ID");

    // 3. Valid but nonexistent intent ID -> 404
    const fakeId = new mongoose.Types.ObjectId();
    res = await fetchWithAuth(`/payment/status/${fakeId}`, token1);
    console.log("Nonexistent ID:", res.status, res.body);
    assert.strictEqual(res.status, 404, "Expected 404 for nonexistent ID");

    // 4. Unrelated authenticated user -> 403
    res = await fetchWithAuth(`/payment/status/${validIntent._id}`, token3);
    console.log("Unrelated user:", res.status, res.body);
    assert.strictEqual(res.status, 403, "Expected 403 for unrelated user");

    // 5. Authorized participant (from) -> 200
    res = await fetchWithAuth(`/payment/status/${validIntent._id}`, token1);
    console.log("Authorized (from):", res.status, res.body);
    assert.strictEqual(res.status, 200, "Expected 200 for 'from' user");
    assert.deepStrictEqual(res.body, { intentId: validIntent._id.toString(), status: "pending" });
    assert.strictEqual(Object.keys(res.body).length, 2, "Response should only contain intentId and status");

    // 6. Authorized participant (to) -> 200
    res = await fetchWithAuth(`/payment/status/${validIntent._id}`, token2);
    console.log("Authorized (to):", res.status, res.body);
    assert.strictEqual(res.status, 200, "Expected 200 for 'to' user");
    assert.deepStrictEqual(res.body, { intentId: validIntent._id.toString(), status: "pending" });
    assert.strictEqual(Object.keys(res.body).length, 2, "Response should only contain intentId and status");

    console.log("✅ All GET /payment/status/:intentId assertions passed.");
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
