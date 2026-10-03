require('dotenv').config({ path: __dirname + '/.env' });
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/lendlocal_test';

const axios = require('axios');
const mongoose = require('mongoose');
const http = require('http');

async function run() {
  let exitCode = 0;
  
  const app = require('./server');
  const errorHandler = app._router.stack.pop();
  const notFoundHandler = app._router.stack.pop();
  
  app.post('/api/auth/fcm-token-defective2', require('./middleware/auth').protect, async (req, res) => {
    try {
      const { token } = req.body;
      const User = mongoose.model('User');
      await User.updateOne({ _id: req.user._id }, { $set: { fcmToken: token } });
      await User.updateMany({ fcmToken: token, _id: { $ne: req.user._id } }, { $set: { fcmToken: null } });
      res.json({ message: 'OK' });
    } catch(e) { res.status(500).json({message: e.message}); }
  });

  app._router.stack.push(notFoundHandler);
  app._router.stack.push(errorHandler);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(5006, resolve);
    server.on('error', reject);
  });
  
  const api = 'http://localhost:5006/api';
  
  const dbTimeout = Date.now() + 5000;
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() > dbTimeout) throw new Error("DB Connection Timeout");
    await new Promise(r => setTimeout(r, 50));
  }
  const User = mongoose.model('User');
  await User.deleteMany({});
  
  const originalUpdateOne = User.updateOne.bind(User);
  const originalUpdateMany = User.updateMany.bind(User);

  try {
    const axiosInst = axios.create({ timeout: 5000 });
    
    // Setup users
    const resA = await axiosInst.post(`${api}/auth/register`, { name: 'User A', email: `usera_${Date.now()}@test.com`, password: 'password123' });
    const tokenA = resA.data.token;
    const emailA = resA.data.user.email;
    
    const resB = await axiosInst.post(`${api}/auth/register`, { name: 'User B', email: `userb_${Date.now()}@test.com`, password: 'password123' });
    const tokenB = resB.data.token;
    
    const fcmTokenCross = 'cross-token-123';
    
    // --- [DEFECTIVE CROSS-ACCOUNT RACE] ---
    console.log("\n--- [DEFECTIVE] Testing Cross-Account Ownership Race ---");
    let updateManyPaused = 0;
    let resumeUpdateMany = null;
    let pBarrier = new Promise(r => resumeUpdateMany = r);
    
    User.updateMany = async function(filter, update, options) {
      if (update && update.$set && update.$set.fcmToken === null) {
        updateManyPaused++;
        await pBarrier;
      }
      return originalUpdateMany(filter, update, options);
    };

    const pA_defect = axiosInst.post(`${api}/auth/fcm-token-defective2`, { token: fcmTokenCross }, { headers: { Authorization: `Bearer ${tokenA}` } });
    const pB_defect = axiosInst.post(`${api}/auth/fcm-token-defective2`, { token: fcmTokenCross }, { headers: { Authorization: `Bearer ${tokenB}` } });
    
    let waitCount = 0;
    while (updateManyPaused < 2 && waitCount < 50) { await new Promise(r => setTimeout(r, 50)); waitCount++; }
    if (updateManyPaused < 2) throw new Error("Barrier failed to trigger for both requests");
    
    resumeUpdateMany();
    await Promise.all([pA_defect, pB_defect]);
    
    let uA = await User.findOne({ email: resA.data.user.email });
    let uB = await User.findOne({ email: resB.data.user.email });
    
    if (!uA.fcmToken && !uB.fcmToken) {
      console.log("⚠️  DEFECT REPRODUCED: Neither user owns the token! Both requests successfully wiped each other out.");
    } else {
      console.error("❌ Failed to reproduce cross-account defect. Someone kept the token:", !!uA.fcmToken, !!uB.fcmToken);
      exitCode = 1;
    }
    
    await User.updateMany({}, { $set: { fcmToken: null, fcmSessionId: null, fcmClaim: null } });

    // --- [FIXED CROSS-ACCOUNT RACE] ---
    console.log("\n--- [FIXED] Testing Cross-Account Atomic Ownership Race ---");
    updateManyPaused = 0;
    resumeUpdateMany = null;
    pBarrier = new Promise(r => resumeUpdateMany = r);
    
    const pA_fixed = axiosInst.post(`${api}/auth/fcm-token`, { token: fcmTokenCross }, { headers: { Authorization: `Bearer ${tokenA}` } });
    const pB_fixed = axiosInst.post(`${api}/auth/fcm-token`, { token: fcmTokenCross }, { headers: { Authorization: `Bearer ${tokenB}` } });
    
    waitCount = 0;
    while (updateManyPaused < 2 && waitCount < 50) { await new Promise(r => setTimeout(r, 50)); waitCount++; }
    if (updateManyPaused < 2) throw new Error("Barrier failed to trigger for both fixed requests");
    
    resumeUpdateMany();
    await Promise.all([pA_fixed, pB_fixed]);
    
    uA = await User.findOne({ email: resA.data.user.email });
    uB = await User.findOne({ email: resB.data.user.email });
    
    if (uA.fcmToken && uB.fcmToken) {
      console.error("❌ REGRESSION: BOTH users kept the token! Conflict resolution failed.");
      exitCode = 1;
    } else if (!uA.fcmToken && !uB.fcmToken) {
      console.error("❌ REGRESSION: NEITHER user kept the token! Optimization failed.");
      exitCode = 1;
    } else {
      const winner = uA.fcmToken ? 'User A' : 'User B';
      console.log(`✅ SUCCESS: Atomic ownership resolved. Exactly one owner remains (${winner}).`);
    }

    User.updateMany = originalUpdateMany;

    // --- [LOGOUT RACE / IDEMPOTENCY / REVOCATION] ---
    console.log("\n--- [FIXED] Testing Logout Race with Session Tracking ---");
    const fcmTokenRace = 'race-token-456';
    let registrationPaused = false;
    let resumeRegistration = null;
    
    User.updateOne = async function(filter, update, options) {
      if (update && update.$set && update.$set.fcmToken === fcmTokenRace) {
        registrationPaused = true;
        await new Promise((resolve, reject) => {
          resumeRegistration = resolve;
          setTimeout(() => reject(new Error('Barrier timeout')), 4000);
        });
      }
      return originalUpdateOne(filter, update, options);
    };

    const pPostFixed = axiosInst.post(`${api}/auth/fcm-token`, { token: fcmTokenRace }, { headers: { Authorization: `Bearer ${tokenA}` } });
    
    waitCount = 0;
    while (!registrationPaused && waitCount < 50) { await new Promise(r => setTimeout(r, 50)); waitCount++; }
    if (!registrationPaused) throw new Error("Barrier failed to trigger");
    
    await axiosInst.delete(`${api}/auth/fcm-token`, { headers: { Authorization: `Bearer ${tokenA}` }, data: { token: fcmTokenRace } });
    
    resumeRegistration();
    try {
      await pPostFixed;
      console.error("❌ Expected 403 Forbidden, but request succeeded!");
      exitCode = 1;
    } catch(e) {
      if (e.response && e.response.status === 403) {
        console.log("✅ Server explicitly rejected the delayed registration as revoked (403).");
      } else {
        console.error("❌ Unexpected error:", e.response ? e.response.status : e.message);
        exitCode = 1;
      }
    }
    
    User.updateOne = originalUpdateOne;

    uA = await User.findOne({ email: emailA });
    if (!uA.fcmToken) {
      console.log("✅ SUCCESS: Token correctly remained revoked.");
    } else {
      console.error("❌ REGRESSION: Token was unexpectedly restored:", uA.fcmToken);
      exitCode = 1;
    }

    // --- NEW REGRESSIONS ---
    const fcmTokenIdem = 'idem-token-789';
    
    console.log("\n--- Testing Registration Idempotency ---");
    await axiosInst.post(`${api}/auth/fcm-token`, { token: fcmTokenIdem }, { headers: { Authorization: `Bearer ${tokenA}` } });
    await axiosInst.post(`${api}/auth/fcm-token`, { token: fcmTokenIdem }, { headers: { Authorization: `Bearer ${tokenA}` } });
    console.log("✅ Repeated identical registration succeeds without errors.");

    console.log("\n--- Testing Revocation Deduplication ---");
    await axiosInst.delete(`${api}/auth/fcm-token`, { headers: { Authorization: `Bearer ${tokenA}` }, data: { token: fcmTokenIdem } });
    await axiosInst.delete(`${api}/auth/fcm-token`, { headers: { Authorization: `Bearer ${tokenA}` }, data: { token: fcmTokenIdem } });
    uA = await User.findOne({ email: emailA });
    const revokedMatches = uA.revokedTokens.filter(t => t.token === fcmTokenIdem);
    if (revokedMatches.length === 1) {
      console.log("✅ Deduplicated repeated revocations.");
    } else {
      console.error("❌ Duplicate revocations found!", revokedMatches.length);
      exitCode = 1;
    }

    console.log("\n--- Testing Revocation Retention ---");
    try {
      await axiosInst.post(`${api}/auth/fcm-token`, { token: fcmTokenIdem }, { headers: { Authorization: `Bearer ${tokenA}` } });
      console.error("❌ Should not accept revoked registration!");
      exitCode = 1;
    } catch (e) {
      if (e.response && e.response.status === 403) {
        console.log("✅ Revocation retention maintained despite repeated DELETE.");
      } else {
        console.error("❌ Unexpected error:", e.message);
        exitCode = 1;
      }
    }

  } catch(e) { 
    console.error("\n❌ Test failed abruptly:", e.response ? (e.response.status + " " + JSON.stringify(e.response.data)) : e.message);
    exitCode = 1;
  } finally {
    try { User.updateOne = originalUpdateOne; } catch(err) {}
    try { User.updateMany = originalUpdateMany; } catch(err) {}
    
    await mongoose.disconnect();
    server.close();
    process.exit(exitCode);
  }
}

run();
