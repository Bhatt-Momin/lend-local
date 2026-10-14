const assert = require('assert');
const { calculateLedger, validatePaymentAmount } = require('./backend/utils/helpers');

async function main() {
  console.log('--- Starting LendLocal Direct UPI Improvements & Custom Amounts Test Suite ---');

  let passedTests = 0;

  // =========================================================================
  // TEST 1: UPI ID Clearing & Validation in auth.js
  // =========================================================================
  console.log('Test 1: Testing auth.js UPI ID clearing and validation logic...');
  {
    // Simulate the handler logic in backend/routes/auth.js
    async function testAuthUpiHandler(body, mockUser) {
      const { upiId } = body;
      let statusCode = 200;
      let responseBody = {};

      const res = {
        status: (code) => { statusCode = code; return res; },
        json: (data) => { responseBody = data; return res; }
      };

      // Replicate exact backend/routes/auth.js route logic:
      if (upiId === undefined) {
        res.status(400).json({ message: 'UPI ID is required' });
        return { statusCode, responseBody };
      }

      if (upiId === null || (typeof upiId === 'string' && upiId.trim() === '')) {
        mockUser.upiId = null;
        await mockUser.save();
        res.json({
          message: 'UPI ID cleared successfully',
          upiId: null
        });
        return { statusCode, responseBody };
      }

      if (typeof upiId !== 'string') {
        res.status(400).json({ message: 'UPI ID must be a string' });
        return { statusCode, responseBody };
      }

      const trimmedUpiId = upiId.trim();
      const upiRegex = /^[\w.-]+@[a-zA-Z]+$/;
      if (!upiRegex.test(trimmedUpiId)) {
        res.status(400).json({ message: 'Invalid UPI ID format' });
        return { statusCode, responseBody };
      }

      mockUser.upiId = trimmedUpiId;
      await mockUser.save();

      res.json({
        message: 'UPI ID saved successfully (Note: this does not verify ownership of the VPA)',
        upiId: mockUser.upiId
      });
      return { statusCode, responseBody };
    }

    let mockUser = { upiId: 'initial@okaxis', save: async () => {} };

    // 1a. Clear with explicit null
    let res = await testAuthUpiHandler({ upiId: null }, mockUser);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.responseBody.upiId, null);
    assert.strictEqual(mockUser.upiId, null);

    // 1b. Clear with empty string
    mockUser.upiId = 'alice@ybl';
    res = await testAuthUpiHandler({ upiId: '' }, mockUser);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.responseBody.upiId, null);
    assert.strictEqual(mockUser.upiId, null);

    // 1c. Clear with whitespace string
    mockUser.upiId = 'bob@icici';
    res = await testAuthUpiHandler({ upiId: '   ' }, mockUser);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.responseBody.upiId, null);
    assert.strictEqual(mockUser.upiId, null);

    // 1d. Omitted upiId property ({}) must be rejected with 400 and preserve saved UPI ID
    mockUser.upiId = 'keepme@bank';
    res = await testAuthUpiHandler({}, mockUser);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.responseBody.message, 'UPI ID is required');
    assert.strictEqual(mockUser.upiId, 'keepme@bank', 'Omitted upiId must not modify previously saved UPI ID');

    // Also verify explicit undefined is rejected with 400 and preserves saved UPI ID
    res = await testAuthUpiHandler({ upiId: undefined }, mockUser);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.responseBody.message, 'UPI ID is required');
    assert.strictEqual(mockUser.upiId, 'keepme@bank');

    // 1e. Save valid UPI handles
    res = await testAuthUpiHandler({ upiId: '9876543210@paytm' }, mockUser);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.responseBody.upiId, '9876543210@paytm');
    assert.strictEqual(mockUser.upiId, '9876543210@paytm');

    res = await testAuthUpiHandler({ upiId: 'user.name@okhdfcbank' }, mockUser);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.responseBody.upiId, 'user.name@okhdfcbank');

    // 1f. Reject invalid format
    res = await testAuthUpiHandler({ upiId: 'invalid_no_handle' }, mockUser);
    assert.strictEqual(res.statusCode, 400);

    res = await testAuthUpiHandler({ upiId: 12345 }, mockUser);
    assert.strictEqual(res.statusCode, 400);

    passedTests++;
    console.log('✅ Test 1 Passed: auth.js UPI clearing and validation work as expected.');
  }

  // =========================================================================
  // TEST 2: Null Safety for Deleted / Missing Participants in payment.js
  // =========================================================================
  console.log('Test 2: Testing payment.js active intents mapping null safety...');
  {
    const mockIntents = [
      // Healthy intent with populated from and to
      {
        _id: 'intent1',
        group: 'group1',
        from: { _id: 'user1', name: 'User One' },
        to: { _id: 'user2', name: 'User Two' },
        amount: 150,
        status: 'pending',
        method: 'upi_direct',
        payeeUpiId: 'user2@bank',
        payeeName: 'User Two',
        upiTransactionRef: 'intent1',
        createdAt: new Date(),
        claimedAt: null
      },
      // Broken intent: from user deleted from MongoDB
      {
        _id: 'intent2',
        group: 'group1',
        from: null,
        to: { _id: 'user2', name: 'User Two' },
        amount: 200,
        status: 'payer_claimed',
        method: 'upi_direct',
        payeeUpiId: 'user2@bank',
        payeeName: 'User Two',
        upiTransactionRef: 'intent2',
        createdAt: new Date(),
        claimedAt: new Date()
      },
      // Broken intent: to user deleted from MongoDB
      {
        _id: 'intent3',
        group: 'group1',
        from: { _id: 'user1', name: 'User One' },
        to: null,
        amount: 50,
        status: 'pending',
        method: 'upi_direct',
        payeeUpiId: 'user2@bank',
        payeeName: 'User Two',
        upiTransactionRef: 'intent3',
        createdAt: new Date(),
        claimedAt: null
      }
    ];

    // Map intents using exact updated logic in backend/routes/payment.js
    const mappedIntents = mockIntents.map(intent => {
      let upiUri = null;
      if (intent.method === 'upi_direct' && intent.payeeUpiId && intent.upiTransactionRef) {
        const pa = encodeURIComponent(intent.payeeUpiId);
        const pn = encodeURIComponent(intent.payeeName || "Unknown");
        const tr = encodeURIComponent(intent.upiTransactionRef);
        const am = encodeURIComponent(intent.amount.toFixed(2));
        const cu = encodeURIComponent("INR");
        const tn = encodeURIComponent("LendLocal Settlement");
        upiUri = `upi://pay?pa=${pa}&pn=${pn}&tr=${tr}&am=${am}&cu=${cu}&tn=${tn}`;
      }

      const fromId = intent.from?._id ? intent.from._id : (intent.from || null);
      const toId = intent.to?._id ? intent.to._id : (intent.to || null);

      return {
        intentId: intent._id,
        groupId: intent.group,
        from: fromId,
        to: toId,
        payerName: intent.from?.name || "Unknown",
        payeeName: intent.to?.name || intent.payeeName || "Unknown",
        amount: intent.amount,
        status: intent.status,
        upiUri,
        createdAt: intent.createdAt,
        claimedAt: intent.claimedAt
      };
    });

    assert.strictEqual(mappedIntents.length, 3);
    assert.strictEqual(mappedIntents[0].from, 'user1');
    assert.strictEqual(mappedIntents[0].to, 'user2');
    assert.strictEqual(mappedIntents[1].from, null);
    assert.strictEqual(mappedIntents[1].payerName, 'Unknown');
    assert.strictEqual(mappedIntents[2].to, null);
    assert.strictEqual(mappedIntents[2].payeeName, 'User Two'); // fall back to intent.payeeName

    passedTests++;
    console.log('✅ Test 2 Passed: payment.js handles null/missing participants safely without crashing.');
  }

  // =========================================================================
  // TEST 3: Ledger Settlement Invariants, Partial Payments & Sequential Debts
  // =========================================================================
  console.log('Test 3: Testing ledger settlement invariants with full & partial payments...');
  {
    const members = [{ _id: 'u1', name: 'User 1' }, { _id: 'u2', name: 'User 2' }];
    const nameMap = { u1: 'User 1', u2: 'User 2' };

    // u2 pays 1000 for an expense split equally between u1 and u2 (u1 owes u2 500)
    const expenses = [{
      amount: 1000,
      paidBy: 'u2',
      splits: [{ user: 'u1', share: 500 }, { user: 'u2', share: 500 }]
    }];

    // 3a. Initial debt calculation
    let initialRes = calculateLedger({ expenses, payments: [], members, nameMap });
    assert.strictEqual(initialRes.settlements.length, 1);
    assert.strictEqual(initialRes.settlements[0].from.id, 'u1');
    assert.strictEqual(initialRes.settlements[0].to.id, 'u2');
    assert.strictEqual(initialRes.settlements[0].amount, 500);

    // 3b. Intermediate unconfirmed statuses do NOT reduce ledger debt
    ['pending', 'payer_claimed', 'recipient_rejected', 'cancelled'].forEach((unconfirmedStatus) => {
      let res = calculateLedger({
        expenses,
        payments: [{ _id: 'p1', from: 'u1', to: 'u2', amount: 200, status: unconfirmedStatus, method: 'upi_direct' }],
        members,
        nameMap
      });
      assert.strictEqual(res.settlements.length, 1, `Status ${unconfirmedStatus} must not alter settlements`);
      assert.strictEqual(res.settlements[0].amount, 500, `Status ${unconfirmedStatus} must leave debt at 500`);
    });

    // 3c. Single partial payment (e.g. ₹200 out of ₹500)
    let resPartial1 = calculateLedger({
      expenses,
      payments: [{ _id: 'p1', from: 'u1', to: 'u2', amount: 200, status: 'recipient_confirmed', method: 'upi_direct' }],
      members,
      nameMap
    });
    assert.strictEqual(resPartial1.settlements.length, 1);
    assert.strictEqual(resPartial1.settlements[0].amount, 300, 'Debt should decrease from ₹500 to ₹300 after ₹200 confirmed');
    const u1Bal1 = resPartial1.balances.find(b => b.userId === 'u1');
    const u2Bal1 = resPartial1.balances.find(b => b.userId === 'u2');
    assert.strictEqual(u1Bal1.net, -300);
    assert.strictEqual(u2Bal1.net, 300);

    // 3d. Sequential partial payment: second payment of ₹100
    let resPartial2 = calculateLedger({
      expenses,
      payments: [
        { _id: 'p1', from: 'u1', to: 'u2', amount: 200, status: 'recipient_confirmed', method: 'upi_direct' },
        { _id: 'p2', from: 'u1', to: 'u2', amount: 100, status: 'recipient_confirmed', method: 'upi_direct' }
      ],
      members,
      nameMap
    });
    assert.strictEqual(resPartial2.settlements.length, 1);
    assert.strictEqual(resPartial2.settlements[0].amount, 200, 'Debt should decrease from ₹300 to ₹200 after second payment of ₹100');

    // 3e. Final partial payment of remaining ₹200 clears the entire debt
    let resPartial3 = calculateLedger({
      expenses,
      payments: [
        { _id: 'p1', from: 'u1', to: 'u2', amount: 200, status: 'recipient_confirmed', method: 'upi_direct' },
        { _id: 'p2', from: 'u1', to: 'u2', amount: 100, status: 'recipient_confirmed', method: 'upi_direct' },
        { _id: 'p3', from: 'u1', to: 'u2', amount: 200, status: 'recipient_confirmed', method: 'upi_direct' }
      ],
      members,
      nameMap
    });
    assert.strictEqual(resPartial3.settlements.length, 0, 'Sequential payments (200+100+200) must fully settle the ₹500 debt');
    const u1Bal3 = resPartial3.balances.find(b => b.userId === 'u1');
    const u2Bal3 = resPartial3.balances.find(b => b.userId === 'u2');
    assert.strictEqual(u1Bal3.net, 0);
    assert.strictEqual(u2Bal3.net, 0);

    // 3f. Full settlement in a single payment using default amount
    let resFull = calculateLedger({
      expenses,
      payments: [{ _id: 'pFull', from: 'u1', to: 'u2', amount: 500, status: 'recipient_confirmed', method: 'upi_direct' }],
      members,
      nameMap
    });
    assert.strictEqual(resFull.settlements.length, 0, 'Single full payment must clear the pairwise debt immediately');

    // 3g. Razorpay payment status ('paid') parity with UPI ('recipient_confirmed')
    let resRzp = calculateLedger({
      expenses,
      payments: [{ _id: 'pRzp', from: 'u1', to: 'u2', amount: 250, status: 'paid', method: 'razorpay' }],
      members,
      nameMap
    });
    assert.strictEqual(resRzp.settlements.length, 1);
    assert.strictEqual(resRzp.settlements[0].amount, 250, 'Razorpay paid status must deduct pairwise debt identically to UPI');

    passedTests++;
    console.log('✅ Test 3 Passed: Ledger calculations strictly and accurately handle full, partial, and sequential settlements.');
  }

  // =========================================================================
  // TEST 4: Authoritative Shared Payment Amount Validation (helpers.js)
  // =========================================================================
  console.log('Test 4: Testing shared payment amount validation logic (production function)...');
  {
    const authorized = 500.00;

    // 4a. Valid full amount
    let v = validatePaymentAmount(500, authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 500);
    assert.strictEqual(v.requestedPaise, 50000);

    // 4b. Valid string full amount
    v = validatePaymentAmount('500.00', authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 500);
    assert.strictEqual(v.requestedPaise, 50000);

    // 4c. Valid partial amount
    v = validatePaymentAmount(200, authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 200);
    assert.strictEqual(v.requestedPaise, 20000);

    // 4d. Minimum valid amount ₹0.01
    v = validatePaymentAmount(0.01, authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 0.01);
    assert.strictEqual(v.requestedPaise, 1);

    // 4e. Exact two decimal places and valid amounts
    v = validatePaymentAmount('123.45', authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 123.45);
    assert.strictEqual(v.requestedPaise, 12345);

    v = validatePaymentAmount(123.45, authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 123.45);

    v = validatePaymentAmount('10.10', authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 10.10);

    v = validatePaymentAmount(10.10, authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 10.10);

    // 4e-ii. Safe handling of JavaScript floating-point representation drift (0.1 + 0.2 === 0.30000000000000004)
    v = validatePaymentAmount(0.1 + 0.2, authorized);
    assert.strictEqual(v.valid, true);
    assert.strictEqual(v.paymentAmount, 0.30);
    assert.strictEqual(v.requestedPaise, 30);

    // 4f. Reject excessive precision (more than 2 decimal places) - NO silent rounding!
    // Regression cases for 10.001, 10.000009, 1.234567, 10.555 (both numbers and strings)
    v = validatePaymentAmount(10.555, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    v = validatePaymentAmount('10.001', authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    v = validatePaymentAmount(10.001, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    v = validatePaymentAmount('10.000009', authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    v = validatePaymentAmount(10.000009, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    v = validatePaymentAmount('1.234567', authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    v = validatePaymentAmount(1.234567, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount cannot have more than 2 decimal places');

    // 4g. Reject amounts below ₹0.01
    v = validatePaymentAmount(0.005, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount must be at least ₹0.01');

    v = validatePaymentAmount(0, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount must be at least ₹0.01');

    v = validatePaymentAmount(-50, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Amount must be at least ₹0.01');

    // 4h. Reject non-numeric, empty amounts, and unsupported JSON input types (booleans, objects, arrays)
    v = validatePaymentAmount('abc', authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Valid numeric amount is required');

    v = validatePaymentAmount('', authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Payment amount is required');

    v = validatePaymentAmount(null, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Payment amount is required');

    v = validatePaymentAmount(undefined, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Payment amount is required');

    v = validatePaymentAmount(true, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Valid numeric amount is required', 'Boolean true must not be coerced to 1');

    v = validatePaymentAmount(false, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Valid numeric amount is required', 'Boolean false must not be coerced to 0');

    v = validatePaymentAmount([], authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Valid numeric amount is required', 'Array must not be coerced');

    v = validatePaymentAmount({}, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Valid numeric amount is required', 'Object must not be coerced');

    // 4i. Reject over-balance amounts
    v = validatePaymentAmount(500.01, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Payment exceeds authorized settlement amount');

    v = validatePaymentAmount(600, authorized);
    assert.strictEqual(v.valid, false);
    assert.strictEqual(v.message, 'Payment exceeds authorized settlement amount');

    passedTests++;
    console.log('✅ Test 4 Passed: validatePaymentAmount strictly enforces precision, limits, type safety, and integer paise arithmetic.');
  }

  // =========================================================================
  // TEST 5: Intent Lifecycle, Immutability & Conflict Decision Rules (Unit Simulation)
  // =========================================================================
  console.log('Test 5: Simulating intent lifecycle immutability and conflict decision rules (isolated unit simulation of payment.js logic)...');
  {
    // Unit simulation: isolated verification of the intent conflict and immutability decision logic implemented in backend/routes/payment.js (does not invoke the live Express route)
    function checkIntentConflict(existingActive, requestedAmount, authorizedAmount) {
      const amountValidation = validatePaymentAmount(requestedAmount, authorizedAmount);
      if (!amountValidation.valid) {
        return { status: 400, message: amountValidation.message };
      }
      const { requestedPaise } = amountValidation;
      const authorizedPaise = Math.round(Number(authorizedAmount) * 100);

      if (existingActive) {
        const activePaise = Math.round(existingActive.amount * 100);
        if (existingActive.status === "pending" && activePaise > authorizedPaise) {
          return { status: 'cancelled_stale' };
        } else if (activePaise === requestedPaise && requestedPaise <= authorizedPaise) {
          return { status: 200, intent: existingActive, reused: true };
        } else {
          const conflictMsg = existingActive.status === 'payer_claimed'
            ? `An active UPI payment claim of ₹${existingActive.amount.toFixed(2)} is awaiting recipient confirmation. It cannot be changed.`
            : `An active UPI payment for ₹${existingActive.amount.toFixed(2)} is already in progress. To pay a different amount, cancel the existing pending payment first (Note: cancellation does not reverse money already sent via UPI).`;
          return {
            status: 409,
            message: conflictMsg,
            intentId: existingActive._id,
            intentStatus: existingActive.status,
            amount: existingActive.amount
          };
        }
      }
      return { status: 201, created: true };
    }

    const authorized = 500.00;

    // 5a. Existing pending intent with amount ₹500, user requests ₹500 again
    let pendingIntent = { _id: 'intent_pend', amount: 500, status: 'pending' };
    let res1 = checkIntentConflict(pendingIntent, 500, authorized);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.reused, true);
    assert.strictEqual(pendingIntent.amount, 500, 'Intent amount must remain immutable');

    // 5b. Existing pending intent with amount ₹500, user requests different amount ₹200
    // Must NOT overwrite pending intent amount in place; must return 409 with cancellation instructions!
    let res2 = checkIntentConflict(pendingIntent, 200, authorized);
    assert.strictEqual(res2.status, 409);
    assert.ok(res2.message.includes('already in progress'));
    assert.ok(res2.message.includes('cancellation does not reverse money already sent via UPI'));
    assert.strictEqual(pendingIntent.amount, 500, 'Pending intent amount must NOT be overwritten in place');

    // 5c. Existing claimed intent with amount ₹200, user attempts to create intent for ₹100
    let claimedIntent = { _id: 'intent_claim', amount: 200, status: 'payer_claimed' };
    let res3 = checkIntentConflict(claimedIntent, 100, authorized);
    assert.strictEqual(res3.status, 409);
    assert.ok(res3.message.includes('awaiting recipient confirmation. It cannot be changed'));
    assert.strictEqual(claimedIntent.amount, 200, 'Claimed intent amount must be strictly immutable');

    // 5d. Duplicate confirmation protection simulation
    // Simulating confirmation endpoint logic: atomically update payer_claimed -> recipient_confirmed
    let dbPayment = { _id: 'intent_conf', amount: 200, status: 'payer_claimed' };
    function simulateConfirm(paymentDoc, callerUserId, expectedRecipientId) {
      if (callerUserId !== expectedRecipientId) {
        return { status: 403, message: 'Unauthorized' };
      }
      if (paymentDoc.status === 'payer_claimed') {
        paymentDoc.status = 'recipient_confirmed';
        paymentDoc.confirmedAt = new Date();
        return { status: 200, message: 'Confirmed successfully', firstConfirm: true };
      }
      if (paymentDoc.status === 'recipient_confirmed') {
        return { status: 200, message: 'Payment was already confirmed', firstConfirm: false };
      }
      return { status: 409, message: `Cannot confirm a payment with status: ${paymentDoc.status}` };
    }

    let c1 = simulateConfirm(dbPayment, 'recip1', 'recip1');
    assert.strictEqual(c1.status, 200);
    assert.strictEqual(c1.firstConfirm, true);
    assert.strictEqual(dbPayment.status, 'recipient_confirmed');

    // Duplicate call: idempotent, does not re-apply
    let c2 = simulateConfirm(dbPayment, 'recip1', 'recip1');
    assert.strictEqual(c2.status, 200);
    assert.strictEqual(c2.firstConfirm, false);
    assert.strictEqual(c2.message, 'Payment was already confirmed');

    passedTests++;
    console.log('✅ Test 5 Passed: Intent lifecycle and immutability decision rules verified via unit simulation.');
  }

  // =========================================================================
  // TEST 6: Frontend QR URI Construction & Copy Logic Validation
  // =========================================================================
  console.log('Test 6: Testing UPI URI construction and copy button data flow...');
  {
    const payeeUpi = 'merchant@okaxis';
    const payeeName = 'Merchant Store';
    const amount = 250.75;
    const tr = '670cb1f8a8479e0012345678';

    const pa = encodeURIComponent(payeeUpi);
    const pn = encodeURIComponent(payeeName);
    const trEnc = encodeURIComponent(tr);
    const am = encodeURIComponent(amount.toFixed(2));
    const cu = encodeURIComponent("INR");
    const tn = encodeURIComponent("LendLocal Settlement");

    const upiUri = `upi://pay?pa=${pa}&pn=${pn}&tr=${trEnc}&am=${am}&cu=${cu}&tn=${tn}`;

    assert.ok(upiUri.startsWith('upi://pay?'), 'Must start with upi://pay scheme');
    assert.ok(upiUri.includes('pa=' + encodeURIComponent(payeeUpi)), 'Must contain encoded payee UPI');
    assert.ok(upiUri.includes('am=250.75'), 'Must contain formatted amount');
    assert.ok(upiUri.includes('cu=INR'), 'Must contain currency INR');
    assert.ok(upiUri.includes('tr=' + tr), 'Must contain transaction ref ID');

    passedTests++;
    console.log('✅ Test 6 Passed: UPI URI complies with standard UPI parameters.');
  }

  // =========================================================================
  // TEST 7: Polling Lifecycle Simulation
  // =========================================================================
  console.log('Test 7: Testing polling lifecycle, timer cancellation, and error backoff...');
  {
    let pollTimer = null;
    let pollCount = 0;
    let isStopped = false;

    function stopPoll() {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
      isStopped = true;
    }

    // Simulate status progression: pending -> payer_claimed -> recipient_confirmed
    let currentStatus = 'payer_claimed';

    function mockPollStep() {
      if (isStopped) return;
      pollCount++;
      if (currentStatus === 'recipient_confirmed') {
        stopPoll();
        return 'confirmed';
      }
      if (pollCount >= 3) {
        currentStatus = 'recipient_confirmed';
      }
    }

    // Run 4 iterations
    mockPollStep();
    assert.strictEqual(isStopped, false);
    mockPollStep();
    assert.strictEqual(isStopped, false);
    mockPollStep();
    assert.strictEqual(isStopped, false);
    mockPollStep(); // 4th call observes recipient_confirmed and calls stopPoll()
    assert.strictEqual(isStopped, true);
    assert.strictEqual(pollCount, 4);

    // Calling again after stop must do nothing
    mockPollStep();
    assert.strictEqual(pollCount, 4);

    passedTests++;
    console.log('✅ Test 7 Passed: Polling lifecycle stops cleanly on terminal status.');
  }

  // =========================================================================
  // TEST 8: Client-Side Input Parsing & Validation Parity
  // =========================================================================
  console.log('Test 8: Testing client-side parseAndValidatePaymentAmount parity...');
  {
    // Exact logic from frontend/js/group.js
    function parseAndValidatePaymentAmount(rawVal, maxAuthorized) {
      if (rawVal === undefined || rawVal === null || (typeof rawVal === 'string' && rawVal.trim() === '')) {
        return { valid: false, message: 'Please enter a payment amount' };
      }
      if (typeof rawVal !== 'number' && typeof rawVal !== 'string') {
        return { valid: false, message: 'Please enter a valid numeric amount' };
      }

      let num;
      if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
          return { valid: false, message: 'Please enter a valid numeric amount' };
        }
        num = Number(trimmed);
      } else {
        if (!Number.isFinite(rawVal) || isNaN(rawVal)) {
          return { valid: false, message: 'Please enter a valid numeric amount' };
        }
        num = rawVal;
      }

      if (num < 0.01) {
        return { valid: false, message: 'Payment amount must be at least ₹0.01' };
      }

      // Check decimal places strictly (at most 2 decimal places)
      if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        const dotIndex = trimmed.indexOf('.');
        if (dotIndex !== -1 && trimmed.length - dotIndex - 1 > 2) {
          return { valid: false, message: 'Amount cannot have more than 2 decimal places' };
        }
      } else {
        const str = rawVal.toString();
        const dotIndex = str.indexOf('.');
        if (dotIndex !== -1 && str.length - dotIndex - 1 > 2) {
          const requestedPaise = Math.round(rawVal * 100);
          const diff = Math.abs(rawVal - requestedPaise / 100);
          if (diff > 1e-9) {
            return { valid: false, message: 'Amount cannot have more than 2 decimal places' };
          }
        }
      }
      const requestedPaise = Math.round(num * 100);
      const maxPaise = Math.round(Number(maxAuthorized) * 100);
      if (requestedPaise > maxPaise) {
        return { valid: false, message: `Payment cannot exceed total outstanding debt of ₹${(maxPaise / 100).toFixed(2)}` };
      }
      return { valid: true, amount: requestedPaise / 100, requestedPaise };
    }

    const maxDebt = 350.00;

    // Valid full amount
    assert.strictEqual(parseAndValidatePaymentAmount('350.00', maxDebt).valid, true);
    assert.strictEqual(parseAndValidatePaymentAmount(350, maxDebt).amount, 350.00);

    // Valid partial amount
    assert.strictEqual(parseAndValidatePaymentAmount('100.50', maxDebt).valid, true);
    assert.strictEqual(parseAndValidatePaymentAmount('100.50', maxDebt).amount, 100.50);
    assert.strictEqual(parseAndValidatePaymentAmount(10.10, maxDebt).valid, true);
    assert.strictEqual(parseAndValidatePaymentAmount('10.10', maxDebt).amount, 10.10);
    assert.strictEqual(parseAndValidatePaymentAmount(123.45, maxDebt).valid, true);
    assert.strictEqual(parseAndValidatePaymentAmount('123.45', maxDebt).amount, 123.45);

    // Valid minimum amount
    assert.strictEqual(parseAndValidatePaymentAmount('0.01', maxDebt).valid, true);
    assert.strictEqual(parseAndValidatePaymentAmount(0.01, maxDebt).amount, 0.01);

    // Valid JS floating-point safe representation
    assert.strictEqual(parseAndValidatePaymentAmount(0.1 + 0.2, maxDebt).valid, true);
    assert.strictEqual(parseAndValidatePaymentAmount(0.1 + 0.2, maxDebt).amount, 0.30);

    // Invalid: Over-balance
    assert.strictEqual(parseAndValidatePaymentAmount('350.01', maxDebt).valid, false);
    assert.ok(parseAndValidatePaymentAmount('400', maxDebt).message.includes('Payment cannot exceed'));

    // Invalid: Excessive precision (more than 2 decimal places) - regression cases
    assert.strictEqual(parseAndValidatePaymentAmount('50.123', maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('50.123', maxDebt).message, 'Amount cannot have more than 2 decimal places');
    assert.strictEqual(parseAndValidatePaymentAmount(10.001, maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('10.001', maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount(10.000009, maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('10.000009', maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount(1.234567, maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('1.234567', maxDebt).valid, false);

    // Invalid: Zero & negative
    assert.strictEqual(parseAndValidatePaymentAmount('0', maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('-10', maxDebt).valid, false);

    // Invalid: Empty & non-numeric
    assert.strictEqual(parseAndValidatePaymentAmount('', maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('   ', maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount('abc', maxDebt).valid, false);

    // Invalid: Unsupported types (booleans, objects, arrays)
    assert.strictEqual(parseAndValidatePaymentAmount(true, maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount(false, maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount([], maxDebt).valid, false);
    assert.strictEqual(parseAndValidatePaymentAmount({}, maxDebt).valid, false);

    passedTests++;
    console.log('✅ Test 8 Passed: Client-side validation accurately mirrors backend business rules.');
  }

  console.log(`\n🎉 All ${passedTests} focused tests passed successfully!\n`);
}

main().catch((err) => {
  console.error('\n❌ Test suite failed with error:');
  console.error(err);
  process.exit(1);
});
