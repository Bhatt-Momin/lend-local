console.log("Starting test script for expenses edit/filter...");
process.env.JWT_SECRET = 'lendlocal_test_secret';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/lendlocal';

const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const assert = require('assert');
const http = require('http');

const expenseRouter = require('./routes/expenses');
const balanceRouter = require('./routes/balances');
const groupRouter = require('./routes/groups');
const User = require('./models/User');
const Group = require('./models/Group');
const Expense = require('./models/Expense');

async function runTests() {
  const TEST_DB_URI = process.env.MONGODB_URI + '_test_expenses_' + Date.now();
  await mongoose.connect(TEST_DB_URI);
  console.log('Connected to test DB:', TEST_DB_URI);

  // Set up fixtures
  const user1 = await User.create({ name: "User One", email: "user1@example.com", password: "password" });
  const user2 = await User.create({ name: "User Two", email: "user2@example.com", password: "password" });
  const user3 = await User.create({ name: "User Three", email: "user3@example.com", password: "password" });
  const user4 = await User.create({ name: "User Four", email: "user4@example.com", password: "password" });

  const group = await Group.create({
    name: "Test Group",
    createdBy: user1._id,
    members: [user1._id, user2._id, user3._id]
  });

  const expense = await Expense.create({
    group: group._id,
    description: "Dinner",
    amount: 100,
    paidBy: user1._id,
    createdBy: user1._id,
    category: "Food", // matches frontend <option>Food</option> mapping, or general if it was "Food & Drink"
    date: new Date("2023-01-10"),
    splitType: "equal",
    splits: [
      { user: user1._id, share: 33.34 },
      { user: user2._id, share: 33.33 },
      { user: user3._id, share: 33.33 }
    ]
  });

  const expense2 = await Expense.create({
    group: group._id,
    description: "Taxi",
    amount: 60,
    paidBy: user2._id,
    createdBy: user2._id,
    category: "Travel",
    date: new Date("2023-01-12"),
    splitType: "equal",
    splits: [
      { user: user1._id, share: 30 },
      { user: user2._id, share: 30 }
    ]
  });

  // Start app
  const app = express();
  app.use(express.json());
  app.use('/api/expenses', expenseRouter);
  app.use('/api/balances', balanceRouter);
  
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api`;

  const token1 = jwt.sign({ id: user1._id }, process.env.JWT_SECRET);
  const token2 = jwt.sign({ id: user2._id }, process.env.JWT_SECRET);
  const token3 = jwt.sign({ id: user3._id }, process.env.JWT_SECRET);
  const token4 = jwt.sign({ id: user4._id }, process.env.JWT_SECRET); // Unrelated

  let failed = false;

  async function fetchWithAuth(url, token, options = {}) {
    const fetchOptions = { ...options, headers: { ...options.headers } };
    if (token) fetchOptions.headers['Authorization'] = `Bearer ${token}`;
    if (fetchOptions.body) fetchOptions.headers['Content-Type'] = 'application/json';
    const res = await fetch(baseUrl + url, fetchOptions);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  try {
    console.log("--- Testing Edit Authorization (PUT /api/expenses/:id) ---");

    // Unrelated user editing
    let res = await fetchWithAuth(`/expenses/${expense._id}`, token4, {
      method: 'PUT',
      body: JSON.stringify({ description: "Lunch", amount: 100 })
    });
    assert.strictEqual(res.status, 403, "Expected 403 for non-member");

    // Member but not creator/payer
    res = await fetchWithAuth(`/expenses/${expense._id}`, token3, {
      method: 'PUT',
      body: JSON.stringify({ description: "Lunch", amount: 100 })
    });
    assert.strictEqual(res.status, 403, "Expected 403 for non-authorized member");

    // Creator editing
    res = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Lunch Edited", 
        amount: 90,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 40 },
          { user: user2._id.toString(), share: 50 }
        ]
      })
    });
    assert.strictEqual(res.status, 200, "Expected 200 for creator edit");
    assert.strictEqual(res.body.expense.description, "Lunch Edited");
    assert.strictEqual(res.body.expense.amount, 90);

    console.log("--- Testing Edit Validation ---");

    // Amount 10.004 is rejected
    let precisionRes = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({
        description: "Precision Test",
        amount: 10.004,
        paidBy: user1._id.toString(),
        splitType: "equal"
      })
    });
    assert.strictEqual(precisionRes.status, 400, "Expected 400 for amount 10.004");

    // Custom share with excess decimal precision is rejected
    precisionRes = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({
        description: "Precision Test",
        amount: 10.01,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 5.005 },
          { user: user2._id.toString(), share: 5.005 }
        ]
      })
    });
    assert.strictEqual(precisionRes.status, 400, "Expected 400 for share 5.005");

    // Amount 10.01 with shares 5.00 and 5.01 succeeds
    precisionRes = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({
        description: "Precision Test",
        amount: 10.01,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 5.00 },
          { user: user2._id.toString(), share: 5.01 }
        ]
      })
    });
    assert.strictEqual(precisionRes.status, 200, "Expected 200 for valid 10.01 split");
    
    // Assert rejected edits leave the saved expense unchanged 
    // We already edited to 10.01 above, so let's try a failing edit then verify it is still 10.01
    let failEditRes = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({
        description: "Hacked Description",
        amount: 20.001, // Failing amount
        paidBy: user1._id.toString(),
        splitType: "equal"
      })
    });
    assert.strictEqual(failEditRes.status, 400, "Expected 400 for 20.001");
    
    // Verify it is still 10.01 and "Precision Test"
    let unchangedCheck = await fetchWithAuth(`/expenses/${group._id}`, token1);
    let unchangedExpense = unchangedCheck.body.expenses.find(e => e.id === expense._id.toString() || e._id === expense._id.toString());
    assert.strictEqual(unchangedExpense.amount, 10.01, "Amount should be unchanged");
    assert.strictEqual(unchangedExpense.description, "Precision Test", "Description should be unchanged");

    // Restore to 90 for the rest of the tests to work properly
    await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Lunch Edited", 
        amount: 90,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 40 },
          { user: user2._id.toString(), share: 50 }
        ]
      })
    });


    // Invalid split total
    res = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Lunch Edited", 
        amount: 90,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 40 },
          { user: user2._id.toString(), share: 40 } // Total 80 != 90
        ]
      })
    });
    assert.strictEqual(res.status, 400, "Expected 400 for invalid split total");

    // 0.02 mismatch test
    res = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Lunch Edited", 
        amount: 100,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 33.33 },
          { user: user2._id.toString(), share: 33.33 },
          { user: user3._id.toString(), share: 33.32 }
        ]
      })
    });
    assert.strictEqual(res.status, 400, "Expected 400 for 0.02 mismatch");

    // Duplicate participant
    res = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Lunch Edited", 
        amount: 90,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 45 },
          { user: user1._id.toString(), share: 45 }
        ]
      })
    });
    assert.strictEqual(res.status, 400, "Expected 400 for duplicate participant");

    // Nonmember participant
    res = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Lunch Edited", 
        amount: 90,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 45 },
          { user: user4._id.toString(), share: 45 }
        ]
      })
    });
    assert.strictEqual(res.status, 400, "Expected 400 for nonmember participant");

    // Empty description
    res = await fetchWithAuth(`/expenses/${expense._id}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "   ", 
        amount: 90,
        paidBy: user1._id.toString(),
        splitType: "equal",
        splits: []
      })
    });
    assert.strictEqual(res.status, 400, "Expected 400 for empty description");

    console.log("--- Testing Balances after Edit ---");

    res = await fetchWithAuth(`/balances/${group._id}`, token1);
    const balances = res.body.balances;
    // user1 paid 90 for expense 1, share is 40 -> user1 net +50
    // user2 share is 50 -> user2 net -50
    // expense 2: user2 paid 60, user1 share 30, user2 share 30 -> user2 net +30, user1 net -30
    // total: user1 net +20, user2 net -20, user3 net 0
    let u1Bal = balances.find(b => b.userId === user1._id.toString()).net;
    let u2Bal = balances.find(b => b.userId === user2._id.toString()).net;
    assert.strictEqual(Math.round(u1Bal), 20);
    assert.strictEqual(Math.round(u2Bal), -20);


    console.log("--- Testing Settlements ---");
    // 1. Create an isolated group for the settled-expense scenario
    const isolatedGroup = await Group.create({
      name: "Isolated Settlement Group",
      createdBy: user1._id,
      members: [user1._id, user2._id]
    });

    // Create an ₹80 expense split equally between two users
    let resIsolated = await fetchWithAuth('/expenses', token1, {
      method: 'POST',
      body: JSON.stringify({
        groupId: isolatedGroup._id.toString(),
        description: "Dinner",
        amount: 80,
        paidBy: user1._id.toString(),
        splitType: "equal",
        splits: [
          { user: user1._id.toString(), share: 40 },
          { user: user2._id.toString(), share: 40 }
        ],
        category: "Food"
      })
    });
    assert.strictEqual(resIsolated.status, 201, "Expected 201 for creating isolated expense");
    const isolatedExpenseId = resIsolated.body.expense.id;

    // 2. Assert the resulting ₹40 obligation using the production balance endpoint
    let resBal = await fetchWithAuth(`/balances/${isolatedGroup._id}`, token1);
    let u1BalIsolated = resBal.body.balances.find(b => b.userId === user1._id.toString()).net;
    let u2BalIsolated = resBal.body.balances.find(b => b.userId === user2._id.toString()).net;
    // User 1 paid 80, share 40 -> net +40 (owed)
    // User 2 share 40 -> net -40 (owes)
    assert.strictEqual(Math.round(u1BalIsolated * 100), 4000, "User1 should be owed 40");
    assert.strictEqual(Math.round(u2BalIsolated * 100), -4000, "User2 should owe 40");

    // 3. Insert an isolated synthetic settlement using the exact fields/status that the production ledger recognizes
    const Payment = require('./models/payment');
    const isolatedPayment = await Payment.create({
      group: isolatedGroup._id,
      from: user2._id,
      to: user1._id,
      amount: 40,
      method: 'razorpay',
      status: 'paid', // Production ledger recognizes 'paid' and 'recipient_confirmed'
      createdAt: new Date()
    });

    // Assert zero balances
    resBal = await fetchWithAuth(`/balances/${isolatedGroup._id}`, token1);
    u1BalIsolated = resBal.body.balances.find(b => b.userId === user1._id.toString()).net;
    u2BalIsolated = resBal.body.balances.find(b => b.userId === user2._id.toString()).net;
    assert.strictEqual(Math.round(u1BalIsolated * 100), 0, "User1 balance should be 0 after settlement");
    assert.strictEqual(Math.round(u2BalIsolated * 100), 0, "User2 balance should be 0 after settlement");

    // 4. Authenticate as an authorized editor and PUT the expense amount to ₹60 through the production edit route
    resIsolated = await fetchWithAuth(`/expenses/${isolatedExpenseId}`, token1, {
      method: 'PUT',
      body: JSON.stringify({ 
        description: "Dinner", 
        amount: 60,
        paidBy: user1._id.toString(),
        splitType: "custom",
        splits: [
          { user: user1._id.toString(), share: 30 },
          { user: user2._id.toString(), share: 30 }
        ]
      })
    });
    
    // 5. Assert the response succeeds and the balance endpoint reports the expected ₹10 credit
    if (resIsolated.status !== 200) {
      console.error("Edit failed with body:", resIsolated.body);
    }
    assert.strictEqual(resIsolated.status, 200, "Expected 200 for editing settled expense");

    resBal = await fetchWithAuth(`/balances/${isolatedGroup._id}`, token1);
    u1BalIsolated = resBal.body.balances.find(b => b.userId === user1._id.toString()).net;
    u2BalIsolated = resBal.body.balances.find(b => b.userId === user2._id.toString()).net;
    
    // User1 net: pays 60, share 30 = +30. Payment received from user2: 40. Net: +30 - 40 = -10 (owes 10)
    // User2 net: share 30 = -30. Payment sent to user1: 40. Net: -30 + 40 = +10 (owed 10)
    assert.strictEqual(Math.round(u1BalIsolated * 100), -1000, "User1 should owe 10");
    assert.strictEqual(Math.round(u2BalIsolated * 100), 1000, "User2 should be owed 10");

    // 6. Compare the payment record before and after editing and assert it is unchanged
    const fetchedPayment = await Payment.findById(isolatedPayment._id);
    assert.strictEqual(fetchedPayment.amount, 40, "Payment amount should be unchanged");
    assert.strictEqual(fetchedPayment.status, 'paid', "Payment status should be unchanged");
    assert.strictEqual(fetchedPayment.group.toString(), isolatedGroup._id.toString(), "Payment group should be unchanged");
    assert.strictEqual(fetchedPayment.from.toString(), user2._id.toString(), "Payment from user should be unchanged");
    assert.strictEqual(fetchedPayment.to.toString(), user1._id.toString(), "Payment to user should be unchanged");


    console.log("--- Testing Filters (GET /api/expenses/:groupId) ---");

    // No filters
    res = await fetchWithAuth(`/expenses/${group._id}`, token1);
    assert.strictEqual(res.body.expenses.length, 2);

    // Search filter with regex metacharacters
    await Expense.create({
      group: group._id, description: "Lunch [Edited] (Again)", amount: 10,
      paidBy: user1._id, createdBy: user1._id, category: "Food", date: new Date(), splitType: "equal", splits: [{ user: user1._id, share: 10 }]
    });
    res = await fetchWithAuth(`/expenses/${group._id}?search=${encodeURIComponent('[Edited] (Again)')}`, token1);
    assert.strictEqual(res.body.expenses.length, 1);

    // Invalid payer ID filter
    res = await fetchWithAuth(`/expenses/${group._id}?payer=invalid`, token1);
    assert.strictEqual(res.status, 400);

    // Invalid date filter
    res = await fetchWithAuth(`/expenses/${group._id}?startDate=not-a-date`, token1);
    assert.strictEqual(res.status, 400);

    // Reversed date ranges filter
    res = await fetchWithAuth(`/expenses/${group._id}?startDate=2023-01-15&endDate=2023-01-10`, token1);
    assert.strictEqual(res.status, 400);

    console.log("✅ All edit and filter assertions passed.");
  } catch (err) {
    console.error("Test failed:", err);
    failed = true;
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    server.close();
    if (failed) process.exit(1);
  }
}

runTests();
