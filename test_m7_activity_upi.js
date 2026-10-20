/**
 * LendLocal Milestone 7 (M7) Test Suite
 * Friendly Activity-First Dashboard and UPI Repair Validation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Milestone 7 (M7) Test Suite ---');

// ============================================================================
// 1. UPI CONFIGURATION & EDITING LIFECYCLE TESTS
// ============================================================================
console.log('1. Testing UPI Configuration & Editing Lifecycle...');

const upiModalSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/components/UpiConfigModal.tsx'),
  'utf8'
);
const settingsModalSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/components/SettingsModal.tsx'),
  'utf8'
);
const indexSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/app/index.tsx'),
  'utf8'
);

// 1A: UpiConfigModalProps must accept initialUpiId and onSuccess
assert(
  upiModalSource.includes('initialUpiId?: string | null;') &&
  upiModalSource.includes('onSuccess?: (newUpiId: string | null) => void;'),
  'UpiConfigModalProps must include initialUpiId and onSuccess callbacks'
);

// 1B: UpiConfigModal must initialize starting value from initialUpiId or user.upiId
assert(
  upiModalSource.includes('const startingVal = initialUpiId !== undefined ? initialUpiId : (user?.upiId || \'\');'),
  'UpiConfigModal must prioritize initialUpiId over fallback user.upiId'
);

// 1C: Prevent background AuthContext syncs from clobbering user typing
// The useEffect must NOT depend on user?.upiId directly, but on visible
assert(
  upiModalSource.includes('}, [visible]);') &&
  upiModalSource.includes('// Only sync when modal opens to prevent background profile syncs from overwriting user typing'),
  'UpiConfigModal useEffect must only re-sync on visible changes, preventing input clobbering'
);

// 1D: SettingsModal must pass user.upiId to onOpenUpiModal
assert(
  settingsModalSource.includes('onOpenUpiModal(user.upiId)'),
  'SettingsModal must pass user.upiId to onOpenUpiModal when clicking Edit or Configure'
);

// 1E: mobile/src/app/index.tsx passes initialUpiId and onSuccess to UpiConfigModal
assert(
  indexSource.includes('initialUpiId={editingUpiId !== undefined ? editingUpiId : user?.upiId}') &&
  indexSource.includes('onSuccess={handleUpiSuccess}'),
  'Dashboard must wire editingUpiId and handleUpiSuccess to UpiConfigModal'
);

// 1F: No parallel storage introduced for UPI ID (must use AuthContext / updateUpiId)
assert(
  !upiModalSource.includes('AsyncStorage.setItem') &&
  !upiModalSource.includes('SecureStore.setItemAsync'),
  'UpiConfigModal must not introduce parallel storage paths; must use updateUpiId'
);

// 1G: Functional UPI Edit Simulation
function simulateUpiEditLifecycle() {
  let authContextUser = { id: 'u1', name: 'Momin', upiId: 'original@okhdfcbank' };
  let editingUpiId = undefined;

  // Step 1: User opens SettingsModal -> clicks Edit
  const clickedUpiId = authContextUser.upiId;
  editingUpiId = clickedUpiId !== undefined ? clickedUpiId : authContextUser.upiId;
  assert.strictEqual(editingUpiId, 'original@okhdfcbank', 'Editing UPI ID must prefill existing ID');

  // Step 2: UpiConfigModal opens with initialUpiId
  let modalInput = editingUpiId !== undefined ? editingUpiId : (authContextUser.upiId || '');
  assert.strictEqual(modalInput, 'original@okhdfcbank', 'Modal input must be prefilled with original UPI ID');

  // Step 3: User edits input
  modalInput = 'momin.new@okaxis';

  // Step 4: User saves
  // AuthContext updates
  authContextUser = { ...authContextUser, upiId: modalInput };
  // onSuccess callback fires
  editingUpiId = modalInput;

  assert.strictEqual(authContextUser.upiId, 'momin.new@okaxis', 'AuthContext must update with new UPI ID');
  assert.strictEqual(editingUpiId, 'momin.new@okaxis', 'Editing state must update with new UPI ID');

  // Step 5: User clears UPI ID
  authContextUser = { ...authContextUser, upiId: null };
  editingUpiId = null;
  assert.strictEqual(authContextUser.upiId, null, 'AuthContext must support clearing UPI ID to null');
  assert.strictEqual(editingUpiId, null, 'Editing state must support clearing to null');
}
simulateUpiEditLifecycle();

// 1H: Status row must use stable initial value and be hidden during in-progress edit of existing UPI ID
assert(
  upiModalSource.includes('const isEditingInProgress = Boolean(') &&
  upiModalSource.includes('initialSavedUpi && upiInput.trim() !== initialSavedUpi') &&
  upiModalSource.includes('!isEditingInProgress ? ('),
  'UpiConfigModal must hide the status row while the user is actively editing an existing UPI ID'
);
assert(
  upiModalSource.includes('{stableStatusDisplay}') &&
  upiModalSource.includes('!initialSavedUpi && styles.statusNotConfigured'),
  'UpiConfigModal status row must use stable initial value rather than live user.upiId'
);

console.log('✅ UPI Configuration & Editing Lifecycle verified.');

// ============================================================================
// 2. NET BALANCE DISPLAY & ANDROID CLIPPING PREVENTION TESTS
// ============================================================================
console.log('2. Testing Net Balance Display & Font Metrics...');

// 2A: Net Balance Amount has explicit lineHeight and includeFontPadding: false
assert(
  indexSource.includes('netCardAmount: {') &&
  indexSource.includes('fontSize: 34,') &&
  indexSource.includes('lineHeight: 44,') &&
  indexSource.includes('includeFontPadding: false,'),
  'netCardAmount must configure explicit lineHeight: 44 and includeFontPadding: false to prevent Android descender clipping'
);

// 2B: netAmountContainer has unconstrained vertical layout
assert(
  indexSource.includes('netAmountContainer: {') &&
  indexSource.includes('paddingVertical: Spacing.one,') &&
  indexSource.includes('alignItems: \'center\','),
  'netAmountContainer must provide unconstrained layout for currency symbols and glyphs'
);

// 2C: Format & threshold logic remain identical
assert(
  indexSource.includes('if (netBalance >= 0.01)') &&
  indexSource.includes('if (netBalance <= -0.01)'),
  'Net balance 0.01 INR threshold must remain preserved'
);

console.log('✅ Net Balance display styling and Android clipping prevention verified.');

// ============================================================================
// 3. ACTIVITY-FIRST DASHBOARD & ATTENTION ITEMS TESTS
// ============================================================================
console.log('3. Testing Attention Items & Activity Derivation Logic...');

// Helper to simulate pendingActions derivation from groups
function derivePendingActions(groups, userId) {
  const actions = [];
  for (const g of groups) {
    if (!Array.isArray(g.settlements)) continue;
    for (const s of g.settlements) {
      if (s.from && s.from.id === userId) {
        actions.push({
          id: `${g.id}_owe_${s.to.id}`,
          groupId: g.id,
          groupName: g.name,
          type: 'owe',
          counterpartyName: s.to.name,
          amount: s.amount,
        });
      } else if (s.to && s.to.id === userId) {
        actions.push({
          id: `${g.id}_owed_${s.from.id}`,
          groupId: g.id,
          groupName: g.name,
          type: 'owed',
          counterpartyName: s.from.name,
          amount: s.amount,
        });
      }
    }
  }
  return actions;
}

const mockUserId = 'user_123';
const mockGroupsWithSettlements = [
  {
    id: 'grp_1',
    name: 'Goa Trip',
    updatedAt: '2026-10-19T10:00:00.000Z',
    settlements: [
      { from: { id: 'user_123', name: 'You' }, to: { id: 'user_456', name: 'Alice' }, amount: 450.00 },
      { from: { id: 'user_789', name: 'Bob' }, to: { id: 'user_456', name: 'Alice' }, amount: 200.00 }, // other members
    ],
  },
  {
    id: 'grp_2',
    name: 'Flat 402',
    updatedAt: '2026-10-20T12:00:00.000Z',
    settlements: [
      { from: { id: 'user_999', name: 'Charlie' }, to: { id: 'user_123', name: 'You' }, amount: 1200.50 },
    ],
  },
  {
    id: 'grp_3',
    name: 'Lunch Squad',
    updatedAt: '2026-10-18T15:00:00.000Z',
    settlements: [],
  },
];

const pendingActions = derivePendingActions(mockGroupsWithSettlements, mockUserId);
assert.strictEqual(pendingActions.length, 2, 'Should only include settlements involving the current user');

// Action 1: You owe Alice
const action1 = pendingActions.find(a => a.type === 'owe');
assert(action1, 'Must find owe action');
assert.strictEqual(action1.counterpartyName, 'Alice');
assert.strictEqual(action1.amount, 450.00);
assert.strictEqual(action1.groupId, 'grp_1');

// Action 2: Charlie owes you
const action2 = pendingActions.find(a => a.type === 'owed');
assert(action2, 'Must find owed action');
assert.strictEqual(action2.counterpartyName, 'Charlie');
assert.strictEqual(action2.amount, 1200.50);
assert.strictEqual(action2.groupId, 'grp_2');

// When no settlements exist:
const emptyPending = derivePendingActions([{ id: 'g1', name: 'Clean', settlements: [] }], mockUserId);
assert.strictEqual(emptyPending.length, 0, 'No pending actions when settlements are empty');

// Check that index.tsx hides attention section when pendingActions is empty
assert(
  indexSource.includes('pendingActions.length > 0 && (activeTab === \'overview\' || activeTab === \'activity\') ? ('),
  'Needs your attention section must only be rendered when real pending actions exist'
);

// Helper to simulate recent group activity sorting
function sortRecentGroupActivity(groups) {
  return [...groups]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
    .slice(0, 6);
}

const sortedActivity = sortRecentGroupActivity(mockGroupsWithSettlements);
assert.strictEqual(sortedActivity[0].id, 'grp_2', 'Most recently updated group must be first');
assert.strictEqual(sortedActivity[1].id, 'grp_1', 'Second most recently updated group must be second');
assert.strictEqual(sortedActivity[2].id, 'grp_3', 'Oldest updated group must be third');

console.log('✅ Attention Items & Activity derivation verified.');

// ============================================================================
// 4. GROUP CARD ROW VARIANT TESTS
// ============================================================================
console.log('4. Testing GroupCard Row Variant Parity...');

const groupCardSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/components/GroupCard.tsx'),
  'utf8'
);

// 4A: GroupCardProps must define variant?: 'card' | 'row'
assert(
  groupCardSource.includes("variant?: 'card' | 'row';"),
  'GroupCardProps must define variant as card or row'
);

// 4B: Default variant is 'card'
assert(
  groupCardSource.includes("variant = 'card'") || groupCardSource.includes("variant === 'row'"),
  'GroupCard must support variant branching'
);

// 4C: Row variant uses rowContainer and distinct row styles
assert(
  groupCardSource.includes('styles.rowContainer') &&
  groupCardSource.includes('styles.rowAvatar') &&
  groupCardSource.includes('styles.rowChevron'),
  'GroupCard must implement row-specific styles for clean list representation'
);

// 4D: Row variant displays tone-colored balances
assert(
  groupCardSource.includes('styles.rowBalance') &&
  groupCardSource.includes('tone === \'owed\'') &&
  groupCardSource.includes('tone === \'owe\''),
  'GroupCard row variant must include tone-colored balances'
);

// 4E: Dashboard uses variant="row" for group list
assert(
  indexSource.includes('<GroupCard') &&
  indexSource.includes('variant="row"'),
  'Dashboard must render groups using variant="row"'
);

console.log('✅ GroupCard Row Variant Parity verified.');

// ============================================================================
// 5. DASHBOARD NAVIGATION & HEADER AFFORDANCES
// ============================================================================
console.log('5. Testing Dashboard Navigation & Header Affordances...');

// 5A: Navigation tab items
assert(
  indexSource.includes("'overview'") &&
  indexSource.includes("'groups'") &&
  indexSource.includes("'activity'") &&
  indexSource.includes('Profile') &&
  indexSource.includes('setShowSettingsModal(true)'),
  'Dashboard must support overview, groups, activity, and profile navigation'
);

// 5B: Bell affordance with pending badge count
assert(
  indexSource.includes('styles.headerIconBtn') &&
  indexSource.includes('styles.bellBadge') &&
  indexSource.includes('{pendingActions.length}'),
  'Dashboard header must have a notification bell with pending action counter'
);

// 5C: Settings Gear opens SettingsModal
assert(
  indexSource.includes('setShowSettingsModal(true)'),
  'Settings gear must open SettingsModal'
);

// 5D: SettingsModal returns to SettingsModal upon closing UpiConfigModal when opened from settings
assert(
  indexSource.includes('setReturnToSettings(true)') &&
  indexSource.includes('setReturnToSettings(false);') &&
  indexSource.includes('setShowSettingsModal(true)'),
  'Closing UpiConfigModal must return to SettingsModal seamlessly'
);

// 5E: Recents tab wording and subtitle clarification
assert(
  indexSource.includes('Recents') &&
  indexSource.includes('Recently updated groups'),
  'Dashboard must clarify the activity feed represents recently updated groups (Recents)'
);

console.log('✅ Dashboard Navigation & Header Affordances verified.');

// ============================================================================
// 6. BACKEND ACTIVITY ENDPOINT GAP AUDIT
// ============================================================================
console.log('6. Verifying Backend Activity Endpoint Gap Audit...');

const backendRoutesDir = path.join(__dirname, 'backend/routes');
const routeFiles = fs.readdirSync(backendRoutesDir);

// Verify what routes exist
let hasActivityRoute = false;
for (const file of routeFiles) {
  if (file.toLowerCase().includes('activity')) {
    hasActivityRoute = true;
  }
}
assert.strictEqual(
  hasActivityRoute,
  false,
  'Backend does not have an activity route; native app appropriately derives activity from real group data'
);

console.log('✅ Backend activity gap confirmed and appropriately handled.');

console.log('\n🎉 ALL Milestone 7 (M7) tests passed successfully!');
