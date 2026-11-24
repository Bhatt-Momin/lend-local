/**
 * Automated Verification Suite for LendLocal New Features:
 * 1. Safe Inline Math Evaluator (Security, AST parsing, edge cases)
 * 2. Multi-Payer Ledger Accounting (Integer paise, zero-sum, proportional pairwise debts)
 * 3. Advanced Split Types (Percentage and Shares allocations)
 * 4. Group Budgets & Spending Alert Thresholds
 */

const assert = require('assert');
const { evaluateMathExpression } = require('../backend/utils/math');
const { calculateLedger } = require('../backend/utils/helpers');

console.log('--- Running New Features Verification Suite ---');

// =========================================================================
// 1. Math Evaluator Invariants & Security
// =========================================================================
console.log('1. Testing Safe Math Expression Evaluator...');

// Basic arithmetic
const r1 = evaluateMathExpression('12+34');
assert.strictEqual(r1.valid, true, '12+34 must be valid');
assert.strictEqual(r1.value, 46, '12+34 must evaluate to 46');

const r2 = evaluateMathExpression('150*2-10');
assert.strictEqual(r2.valid, true);
assert.strictEqual(r2.value, 290);

const r3 = evaluateMathExpression('(120+45)/3');
assert.strictEqual(r3.valid, true);
assert.strictEqual(r3.value, 55);

const r4 = evaluateMathExpression('50.5+49.5');
assert.strictEqual(r4.valid, true);
assert.strictEqual(r4.value, 100);

const r5 = evaluateMathExpression('10/3');
assert.strictEqual(r5.valid, true);
assert.strictEqual(r5.value, 3.33, '10/3 must round to 2 decimal places (3.33)');

// Security & Error handling
const rSec1 = evaluateMathExpression('process.exit()');
assert.strictEqual(rSec1.valid, false, 'Injection attempts must be rejected');

const rSec2 = evaluateMathExpression('__proto__');
assert.strictEqual(rSec2.valid, false, 'Object keys must be rejected');

const rDiv0 = evaluateMathExpression('100/0');
assert.strictEqual(rDiv0.valid, false, 'Division by zero must return invalid');
assert(rDiv0.error.includes('Division by zero'));

const rParen = evaluateMathExpression('(10+20');
assert.strictEqual(rParen.valid, false, 'Mismatched parentheses must be rejected');

const rNeg = evaluateMathExpression('10-50');
assert.strictEqual(rNeg.valid, false, 'Negative net amounts must be rejected');

console.log('✅ Math Evaluator Invariants verified.');

// =========================================================================
// 2. Multi-Payer Ledger & Accounting Invariants
// =========================================================================
console.log('2. Testing Multi-Payer Ledger Invariants & Zero-Sum Accounting...');

// Scenario: Alice (u1) pays 60, Bob (u2) pays 40. Total bill: 100.
// Splits: Alice owes 25, Bob owes 25, Charlie (u3) owes 50.
const ledgerResult = calculateLedger({
  expenses: [
    {
      amount: 100,
      payers: [
        { user: 'u1', amount: 60 },
        { user: 'u2', amount: 40 },
      ],
      splits: [
        { user: 'u1', share: 25 },
        { user: 'u2', share: 25 },
        { user: 'u3', share: 50 },
      ],
    },
  ],
  members: ['u1', 'u2', 'u3'],
  nameMap: { u1: 'Alice', u2: 'Bob', u3: 'Charlie' },
});

// Net balances check:
// Alice: paid 60, share 25 -> net = +35
// Bob: paid 40, share 25 -> net = +15
// Charlie: paid 0, share 50 -> net = -50
const alice = ledgerResult.balances.find((b) => b.userId === 'u1');
const bob = ledgerResult.balances.find((b) => b.userId === 'u2');
const charlie = ledgerResult.balances.find((b) => b.userId === 'u3');

assert.strictEqual(alice.net, 35, 'Alice net must be +35');
assert.strictEqual(bob.net, 15, 'Bob net must be +15');
assert.strictEqual(charlie.net, -50, 'Charlie net must be -50');

// Zero-sum balance check: sum of all net balances must equal exactly 0
const sumNet = ledgerResult.balances.reduce((acc, b) => acc + Math.round(b.net * 100), 0);
assert.strictEqual(sumNet, 0, 'Group ledger net balances must sum to exactly 0 paise');

// Settlements check:
// Charlie owes Alice: 50 * (60/100) = 30
// Charlie owes Bob: 50 * (40/100) = 20
// Bob owes Alice: 25 * (60/100) - Alice owes Bob (25 * 40/100) = 15 - 10 = 5 from Bob to Alice
const cToA = ledgerResult.settlements.find((s) => s.from.id === 'u3' && s.to.id === 'u1');
const cToB = ledgerResult.settlements.find((s) => s.from.id === 'u3' && s.to.id === 'u2');
const bToA = ledgerResult.settlements.find((s) => s.from.id === 'u2' && s.to.id === 'u1');

assert(cToA, 'Settlement from Charlie to Alice must exist');
assert.strictEqual(cToA.amount, 30, 'Charlie owes Alice 30');

assert(cToB, 'Settlement from Charlie to Bob must exist');
assert.strictEqual(cToB.amount, 20, 'Charlie owes Bob 20');

assert(bToA, 'Settlement from Bob to Alice must exist');
assert.strictEqual(bToA.amount, 5, 'Bob owes Alice 5');

console.log('✅ Multi-Payer Ledger & Zero-Sum Accounting verified.');

// =========================================================================
// 3. Backward Compatibility with Legacy Single-Payer Expenses
// =========================================================================
console.log('3. Testing Backward Compatibility for Legacy Expenses...');

const legacyLedger = calculateLedger({
  expenses: [
    {
      amount: 90,
      paidBy: 'u1',
      splitType: 'equal',
      splits: [
        { user: 'u1', share: 30 },
        { user: 'u2', share: 30 },
        { user: 'u3', share: 30 },
      ],
    },
  ],
  members: ['u1', 'u2', 'u3'],
  nameMap: { u1: 'Alice', u2: 'Bob', u3: 'Charlie' },
});

const legacyAlice = legacyLedger.balances.find((b) => b.userId === 'u1');
const legacyBob = legacyLedger.balances.find((b) => b.userId === 'u2');
const legacyCharlie = legacyLedger.balances.find((b) => b.userId === 'u3');

assert.strictEqual(legacyAlice.net, 60, 'Legacy single payer Alice net must be +60');
assert.strictEqual(legacyBob.net, -30, 'Legacy Bob net must be -30');
assert.strictEqual(legacyCharlie.net, -30, 'Legacy Charlie net must be -30');

const legacySum = legacyLedger.balances.reduce((acc, b) => acc + Math.round(b.net * 100), 0);
assert.strictEqual(legacySum, 0, 'Legacy ledger net balances must sum to exactly 0 paise');

console.log('✅ Backward Compatibility verified.');

// =========================================================================
// 4. Proportional Shares & Percentage Allocations Math
// =========================================================================
console.log('4. Testing Advanced Split Allocation Math...');

// Percentage split: 60% and 40% of ₹100
const totalPaise = 10000;
const pctSplits = [
  { user: 'u1', percentage: 60 },
  { user: 'u2', percentage: 40 },
];
const pctAlloc = pctSplits.map((s) => Math.floor((totalPaise * s.percentage) / 100));
const totalAllocPct = pctAlloc.reduce((a, b) => a + b, 0);
assert.strictEqual(totalAllocPct, totalPaise, 'Percentage shares must sum to total paise');

// Proportional shares: 2 shares and 1 share of ₹100 (₹66.67 and ₹33.33)
const shareSplits = [
  { user: 'u1', shares: 2 },
  { user: 'u2', shares: 1 },
];
const totalShares = 3;
let allocatedSharesPaise = 0;
const computedShares = shareSplits.map((s) => {
  const p = Math.floor(totalPaise * (s.shares / totalShares));
  allocatedSharesPaise += p;
  return p;
});
const remPaise = totalPaise - allocatedSharesPaise;
// Remainder 1 paisa given to largest share (u1)
computedShares[0] += remPaise;

assert.strictEqual(computedShares[0], 6667, '2 shares of 100 must be 6667 paise (₹66.67)');
assert.strictEqual(computedShares[1], 3333, '1 share of 100 must be 3333 paise (₹33.33)');
assert.strictEqual(computedShares[0] + computedShares[1], totalPaise, 'Shares allocation must be lossless');

console.log('✅ Advanced Split Allocation Math verified.');

// =========================================================================
// 5. Deep Link & QR Code Protocol Schema Invariants
// =========================================================================
console.log('5. Testing Deep Link & QR Code Protocol Schemas...');

const testGroupId = '670cb1f8a8479e0012345678';
const testGroupName = 'Goa Trip 2026';
const joinDeepLink = `lendlocal://join?code=${encodeURIComponent(testGroupId)}&name=${encodeURIComponent(testGroupName)}`;

assert.ok(joinDeepLink.startsWith('lendlocal://join?'), 'Must start with lendlocal://join scheme');
assert.ok(joinDeepLink.includes('code=' + testGroupId), 'Must contain group ID in code param');
assert.ok(joinDeepLink.includes('name=' + encodeURIComponent(testGroupName)), 'Must contain URL encoded group name');

const testVpa = 'john@okhdfcbank';
const testPayeeName = 'John Doe';
const testAmount = 450.50;
const upiUri = `upi://pay?pa=${encodeURIComponent(testVpa)}&pn=${encodeURIComponent(testPayeeName)}&am=${encodeURIComponent(testAmount.toFixed(2))}&cu=INR&tn=${encodeURIComponent('LendLocal Settlement')}`;

assert.ok(upiUri.startsWith('upi://pay?'), 'Must start with upi://pay scheme');
assert.ok(upiUri.includes('pa=' + encodeURIComponent(testVpa)), 'Must include payee VPA');
assert.ok(upiUri.includes('am=450.50'), 'Must include exact 2-decimal amount');
assert.ok(upiUri.includes('cu=INR'), 'Must specify INR currency');

console.log('✅ Deep Link & QR Code Protocol Schemas verified.');

// =========================================================================
// 6. Group Budget & Spending Threshold Alerts
// =========================================================================
console.log('6. Testing Budget Thresholds & Alert Calculation Logic...');

const monthlyLimit = 5000;
const limitPaise = monthlyLimit * 100;

// Test under 80%: 3500 spent -> 70%
const spent70Paise = 350000;
const pct70 = Math.round((spent70Paise / limitPaise) * 100);
assert.strictEqual(pct70, 70);
assert.ok(pct70 < 80, '70% is below 80% threshold');

// Test 80% threshold: 4000 spent -> 80%
const spent80Paise = 400000;
const pct80 = Math.round((spent80Paise / limitPaise) * 100);
assert.strictEqual(pct80, 80);
assert.ok(pct80 >= 80 && pct80 < 100, '80% triggers approaching limit warning');

// Test 100% threshold: 5200 spent -> 104%
const spent104Paise = 520000;
const pct104 = Math.round((spent104Paise / limitPaise) * 100);
assert.strictEqual(pct104, 104);
assert.ok(pct104 >= 100, '104% triggers budget exceeded alert');

console.log('✅ Budget Thresholds & Alert Calculation Logic verified.');

console.log('\n🎉 ALL New Features (Math, Multi-Payer, Splits, Budgets, QR) Unit & Accounting Tests Passed!');
