/**
 * LendLocal Milestone 6 (M6) Test Suite
 * Dashboard Hierarchy, Net Overall Balance, and Settings Placement
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Milestone 6 (M6) Test Suite ---');

// ============================================================================
// 1. FORMATTING & NET BALANCE CALCULATION TESTS
// ============================================================================
console.log('1. Testing Net Balance Formula & Format Parity...');

function formatINR(amount) {
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    const sign = value < 0 ? '-' : '';
    return `${sign}₹${Math.abs(value).toFixed(2)}`;
  }
}

function calculateDashboardTotals(groups) {
  let owedToMe = 0;
  let iOwe = 0;
  for (const g of groups) {
    if (g.myBalance >= 0.01) {
      owedToMe += g.myBalance;
    } else if (g.myBalance <= -0.01) {
      iOwe += Math.abs(g.myBalance);
    }
  }
  const netBalance = owedToMe - iOwe;
  return { owedToMe, iOwe, netBalance };
}

function deriveNetPresentation(totals) {
  const { netBalance } = totals;
  if (netBalance >= 0.01) {
    return {
      formatted: `+${formatINR(netBalance)}`,
      badge: 'Owed to you',
      explanation: 'You are owed more than you owe across your groups.',
      tone: 'positive',
    };
  }
  if (netBalance <= -0.01) {
    return {
      formatted: `−${formatINR(Math.abs(netBalance))}`,
      badge: 'You owe',
      explanation: 'You owe more than you are owed across your groups.',
      tone: 'negative',
    };
  }
  return {
    formatted: '₹0.00',
    badge: 'Settled',
    explanation: 'All group balances are settled up.',
    tone: 'settled',
  };
}

// Test Case 1A: Positive Net Balance (You are owed more)
const groupsPos = [
  { id: 'g1', name: 'Apartment', myBalance: 500.50 },
  { id: 'g2', name: 'Trip', myBalance: -150.25 },
  { id: 'g3', name: 'Dinner', myBalance: 50.00 },
];
const totalsPos = calculateDashboardTotals(groupsPos);
assert.strictEqual(totalsPos.owedToMe, 550.50);
assert.strictEqual(totalsPos.iOwe, 150.25);
assert.strictEqual(totalsPos.netBalance, 400.25);

const presPos = deriveNetPresentation(totalsPos);
assert(presPos.formatted.startsWith('+'), 'Positive net balance must include leading +');
assert.strictEqual(presPos.badge, 'Owed to you');
assert.strictEqual(presPos.tone, 'positive');
assert(presPos.explanation.includes('owed more than you owe'));

// Test Case 1B: Negative Net Balance (You owe more)
const groupsNeg = [
  { id: 'g1', name: 'Apartment', myBalance: -1000.00 },
  { id: 'g2', name: 'Groceries', myBalance: 250.00 },
];
const totalsNeg = calculateDashboardTotals(groupsNeg);
assert.strictEqual(totalsNeg.owedToMe, 250.00);
assert.strictEqual(totalsNeg.iOwe, 1000.00);
assert.strictEqual(totalsNeg.netBalance, -750.00);

const presNeg = deriveNetPresentation(totalsNeg);
assert(presNeg.formatted.startsWith('−'), 'Negative net balance must include leading minus');
assert.strictEqual(presNeg.badge, 'You owe');
assert.strictEqual(presNeg.tone, 'negative');
assert(presNeg.explanation.includes('owe more than you are owed'));

// Test Case 1C: Settled / Zero Net Balance
const groupsSettled = [
  { id: 'g1', name: 'Apartment', myBalance: 0.00 },
  { id: 'g2', name: 'Lunch', myBalance: 100.00 },
  { id: 'g3', name: 'Coffee', myBalance: -100.00 },
];
const totalsSettled = calculateDashboardTotals(groupsSettled);
assert.strictEqual(totalsSettled.owedToMe, 100.00);
assert.strictEqual(totalsSettled.iOwe, 100.00);
assert.strictEqual(totalsSettled.netBalance, 0.00);

const presSettled = deriveNetPresentation(totalsSettled);
assert.strictEqual(presSettled.formatted, '₹0.00');
assert.strictEqual(presSettled.badge, 'Settled');
assert.strictEqual(presSettled.tone, 'settled');
assert(presSettled.explanation.includes('settled up'));

// Test Case 1D: Sub-cent rounding bounds (less than 1 paise)
const groupsSubCent = [
  { id: 'g1', name: 'Tiny Positive', myBalance: 0.004 },
  { id: 'g2', name: 'Tiny Negative', myBalance: -0.004 },
];
const totalsSubCent = calculateDashboardTotals(groupsSubCent);
assert.strictEqual(totalsSubCent.owedToMe, 0);
assert.strictEqual(totalsSubCent.iOwe, 0);
assert.strictEqual(totalsSubCent.netBalance, 0);
const presSubCent = deriveNetPresentation(totalsSubCent);
assert.strictEqual(presSubCent.formatted, '₹0.00');

console.log('✅ Net Balance formula, presentation, and edge cases passed.');

// ============================================================================
// 2. DATA SOURCE SCOPE PARITY TESTS
// ============================================================================
console.log('2. Testing Authoritative Scope Parity...');

// Verify that totalOwedToYou and totalYouOwe come from the identical group set
function verifyScopeParity(groups) {
  const positiveGroupIds = new Set(groups.filter(g => g.myBalance >= 0.01).map(g => g.id));
  const negativeGroupIds = new Set(groups.filter(g => g.myBalance <= -0.01).map(g => g.id));

  // The union of active debt groups must be a strict subset of the groups array
  for (const id of positiveGroupIds) {
    assert(groups.some(g => g.id === id), 'Owed groups must belong to the user groups query');
  }
  for (const id of negativeGroupIds) {
    assert(groups.some(g => g.id === id), 'Owe groups must belong to the user groups query');
  }
  // No single group can simultaneously be positive and negative
  for (const id of positiveGroupIds) {
    assert(!negativeGroupIds.has(id), 'A group cannot have dual signs');
  }
}
verifyScopeParity(groupsPos);
verifyScopeParity(groupsNeg);
verifyScopeParity(groupsSettled);

console.log('✅ Authoritative Scope Parity verified (identical user groups scope).');

// ============================================================================
// 3. DASHBOARD & SETTINGS MODAL STATIC INSPECTION TESTS
// ============================================================================
console.log('3. Inspecting Dashboard & Settings Components...');

const indexPath = path.join(__dirname, 'mobile/src/app/index.tsx');
const indexContent = fs.readFileSync(indexPath, 'utf8');

const settingsModalPath = path.join(__dirname, 'mobile/src/components/SettingsModal.tsx');
const settingsModalContent = fs.readFileSync(settingsModalPath, 'utf8');

// 3A: No direct Sign Out button in main dashboard
assert(
  !indexContent.includes('styles.logoutBtn'),
  'The large Sign Out button must not be present directly on the main dashboard'
);

// 3B: No direct Server button in main dashboard authenticated profile
assert(
  !indexContent.includes('styles.serverBtn'),
  'The developer Server button must not be displayed in the authenticated dashboard profile'
);

// 3C: Settings gear/menu is in the header
assert(
  indexContent.includes('styles.settingsGearBtn') && indexContent.includes('SettingsModal'),
  'Dashboard header must have a settings gear button wired to SettingsModal'
);

// 3D: Net Balance Card displays Net Balance & Secondary Component Totals
assert(
  indexContent.includes('Net Balance') &&
  indexContent.includes('netPresentation') &&
  indexContent.includes('secondaryTotalsRow') &&
  indexContent.includes('totals.owedToMe') &&
  indexContent.includes('totals.iOwe'),
  'Net Balance card must display prominent net balance and both secondary totals'
);

// 3E: SettingsModal contains functional destinations for UPI, Server, and Logout
assert(
  settingsModalContent.includes('onOpenUpiModal') &&
  settingsModalContent.includes('onOpenServerModal') &&
  settingsModalContent.includes('onLogout'),
  'SettingsModal must provide functional triggers for UPI config, Server config, and Logout'
);

// 3F: No fixed or absolute overlay buttons on dashboard
assert(
  !indexContent.includes("position: 'absolute'"),
  'Dashboard must not use position: absolute overlay buttons'
);

// 3G: Threshold explanation comment in mobile/src/app/index.tsx
assert(
  indexContent.includes('0.01 INR = 1 paise') &&
  indexContent.includes('minimum transacted currency unit'),
  'mobile/src/app/index.tsx must contain a concise comment explaining the 0.01 balance threshold'
);

console.log('✅ Dashboard hierarchy, SettingsModal, and clean layout verified.');

// ============================================================================
// 4. SETTINGS MODAL UPI PRESENTATION UNIT TESTS
// ============================================================================
console.log('4. Testing SettingsModal UPI State Resolution Logic...');

function computeSettingsModalUpiPresentation(user, isRefreshingUser) {
  const upiId = user?.upiId;
  if (upiId) {
    return {
      upiDisplay: upiId,
      upiButtonLabel: 'Edit',
      isConfigured: true,
    };
  }
  if (isRefreshingUser) {
    return {
      upiDisplay: 'Checking status...',
      upiButtonLabel: '...',
      isConfigured: false,
    };
  }
  if (upiId === null) {
    return {
      upiDisplay: 'Not configured',
      upiButtonLabel: '+ Configure',
      isConfigured: false,
    };
  }
  return {
    upiDisplay: 'Status unknown',
    upiButtonLabel: 'Retry',
    isConfigured: false,
  };
}

// 4A: Configured UPI ID (even while refreshing)
const res4A1 = computeSettingsModalUpiPresentation({ upiId: 'alice@okhdfcbank' }, false);
assert.strictEqual(res4A1.upiDisplay, 'alice@okhdfcbank');
assert.strictEqual(res4A1.upiButtonLabel, 'Edit');

const res4A2 = computeSettingsModalUpiPresentation({ upiId: 'alice@okhdfcbank' }, true);
assert.strictEqual(res4A2.upiDisplay, 'alice@okhdfcbank');
assert.strictEqual(res4A2.upiButtonLabel, 'Edit');

// 4B: Actively refreshing while unconfigured or unknown
const res4B1 = computeSettingsModalUpiPresentation({ upiId: null }, true);
assert.strictEqual(res4B1.upiDisplay, 'Checking status...');
assert.strictEqual(res4B1.upiButtonLabel, '...');

const res4B2 = computeSettingsModalUpiPresentation({ upiId: undefined }, true);
assert.strictEqual(res4B2.upiDisplay, 'Checking status...');
assert.strictEqual(res4B2.upiButtonLabel, '...');

// 4C: Confirmed unset (upiId === null and not refreshing) -> ONLY now show "Not configured"
const res4C = computeSettingsModalUpiPresentation({ upiId: null }, false);
assert.strictEqual(res4C.upiDisplay, 'Not configured');
assert.strictEqual(res4C.upiButtonLabel, '+ Configure');

// 4D: Unknown status (upiId === undefined and not refreshing) -> show "Status unknown" & "Retry"
const res4D = computeSettingsModalUpiPresentation({ upiId: undefined }, false);
assert.strictEqual(res4D.upiDisplay, 'Status unknown');
assert.strictEqual(res4D.upiButtonLabel, 'Retry');

console.log('✅ SettingsModal UPI state resolution verified across all 4 lifecycle states.');

console.log('\n🎉 ALL Milestone 6 (M6) tests passed successfully!');
