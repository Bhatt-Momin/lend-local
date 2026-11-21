const assert = require('assert');
const {
  parseAmountToPaise,
  buildEqualPreview,
  validateCustomSplits,
  canEditExpense,
  canDeleteExpense,
  MIN_EXPENSE_AMOUNT,
  MAX_EXPENSE_AMOUNT,
  MutationRefreshError,
  executeMutationWithGuardedRefresh,
  buildEqualExpensePayload,
  validateExpenseDate,
  hasDepartedSplitParticipants,
  buildCustomExpensePayload,
} = require('./mobile/src/utils/expenseForm.ts');

console.log('--- Running Stage 3 Phase 4 M1 Unit Tests ---');

// ============================================================================
// 1. Amount Parsing, Decimal Precision & String Boundaries
// ============================================================================
console.log('Testing parseAmountToPaise...');

// Valid numeric and string amounts
const a1 = parseAmountToPaise(100);
assert.strictEqual(a1.valid, true);
assert.strictEqual(a1.paise, 10000);
assert.strictEqual(a1.amount, 100);

const a2 = parseAmountToPaise('123.45');
assert.strictEqual(a2.valid, true);
assert.strictEqual(a2.paise, 12345);
assert.strictEqual(a2.amount, 123.45);

const aMin = parseAmountToPaise(MIN_EXPENSE_AMOUNT);
assert.strictEqual(aMin.valid, true);
assert.strictEqual(aMin.paise, 1);
assert.strictEqual(aMin.amount, 0.01);

const aMax = parseAmountToPaise(MAX_EXPENSE_AMOUNT);
assert.strictEqual(aMax.valid, true);
assert.strictEqual(aMax.paise, 1000000000);
assert.strictEqual(aMax.amount, 10000000);

// Invalid amounts: blank / empty / whitespace
assert.strictEqual(parseAmountToPaise('').valid, false);
assert.strictEqual(parseAmountToPaise('   ').valid, false);
assert.strictEqual(parseAmountToPaise(null).valid, false);
assert.strictEqual(parseAmountToPaise(undefined).valid, false);

// Invalid amounts: malformed strings (scientific notation, commas, currency symbols, words)
assert.strictEqual(parseAmountToPaise('1e3').valid, false); // scientific notation rejected
assert.strictEqual(parseAmountToPaise('1,000').valid, false); // commas rejected
assert.strictEqual(parseAmountToPaise('₹500').valid, false); // currency symbol rejected
assert.strictEqual(parseAmountToPaise('$100').valid, false); // dollar symbol rejected
assert.strictEqual(parseAmountToPaise('abc').valid, false);
assert.strictEqual(parseAmountToPaise('12.34.56').valid, false);
assert.strictEqual(parseAmountToPaise('-50').valid, false);
assert.strictEqual(parseAmountToPaise(0).valid, false);
assert.strictEqual(parseAmountToPaise(0.001).valid, false); // below min
assert.strictEqual(parseAmountToPaise(10000000.01).valid, false); // above max

// Invalid numeric inputs: NaN and Infinity
assert.strictEqual(parseAmountToPaise(NaN).valid, false);
assert.strictEqual(parseAmountToPaise(Infinity).valid, false);
assert.strictEqual(parseAmountToPaise(-Infinity).valid, false);

// Invalid amounts: over-precision (> 2 decimal places)
assert.strictEqual(parseAmountToPaise('10.999').valid, false);
assert.strictEqual(parseAmountToPaise('10.001').valid, false);
assert.strictEqual(parseAmountToPaise(10.123).valid, false);

console.log('✅ parseAmountToPaise tests passed.');

// ============================================================================
// 2. Equal-Split Remainder Distribution, Participant Order & Single Participant
// ============================================================================
console.log('Testing buildEqualPreview...');

// Case 2a: Single-participant equal split
const eqSingle = buildEqualPreview(10000, ['u1']);
assert.strictEqual(eqSingle.valid, true);
assert.strictEqual(eqSingle.basePaise, 10000);
assert.strictEqual(eqSingle.remainderPaise, 0);
assert.strictEqual(eqSingle.splits.length, 1);
assert.strictEqual(eqSingle.splits[0].user, 'u1');
assert.strictEqual(eqSingle.splits[0].sharePaise, 10000);
assert.strictEqual(eqSingle.splits[0].share, 100.0);

// Case 2b: ₹100.00 split 3 ways -> 33.34, 33.33, 33.33 (order preserved!)
const eq3 = buildEqualPreview(10000, ['u1', 'u2', 'u3']);
assert.strictEqual(eq3.valid, true);
assert.strictEqual(eq3.basePaise, 3333);
assert.strictEqual(eq3.remainderPaise, 1);
assert.strictEqual(eq3.splits.length, 3);
assert.strictEqual(eq3.splits[0].user, 'u1');
assert.strictEqual(eq3.splits[0].sharePaise, 3334);
assert.strictEqual(eq3.splits[0].share, 33.34);
assert.strictEqual(eq3.splits[1].user, 'u2');
assert.strictEqual(eq3.splits[1].sharePaise, 3333);
assert.strictEqual(eq3.splits[1].share, 33.33);
assert.strictEqual(eq3.splits[2].user, 'u3');
assert.strictEqual(eq3.splits[2].sharePaise, 3333);
assert.strictEqual(eq3.splits[2].share, 33.33);

// Verify total sum of shares in paise matches exactly
const totalEq3 = eq3.splits.reduce((acc, s) => acc + s.sharePaise, 0);
assert.strictEqual(totalEq3, 10000);

// Case 2c: ₹10.02 split 4 ways -> 251, 251, 250, 250 (remainder 2 -> first two get +1)
const eq4 = buildEqualPreview(1002, ['alice', 'bob', 'carol', 'dave']);
assert.strictEqual(eq4.valid, true);
assert.strictEqual(eq4.basePaise, 250);
assert.strictEqual(eq4.remainderPaise, 2);
assert.strictEqual(eq4.splits[0].sharePaise, 251);
assert.strictEqual(eq4.splits[1].sharePaise, 251);
assert.strictEqual(eq4.splits[2].sharePaise, 250);
assert.strictEqual(eq4.splits[3].sharePaise, 250);
assert.strictEqual(eq4.splits.reduce((acc, s) => acc + s.sharePaise, 0), 1002);

// Case 2d: Empty participants list rejected
const emptyEq = buildEqualPreview(10000, []);
assert.strictEqual(emptyEq.valid, false);
assert.strictEqual(emptyEq.error, 'At least one participant is required for equal split');

// Case 2e: Duplicate participants rejected
const dupEq = buildEqualPreview(10000, ['u1', 'u2', 'u1']);
assert.strictEqual(dupEq.valid, false);
assert.strictEqual(dupEq.error, 'Duplicate split participant');

console.log('✅ buildEqualPreview tests passed.');

// ============================================================================
// 3. Custom Split Paise Totals, Boundary Tests & Non-Numeric Rejection
// ============================================================================
console.log('Testing validateCustomSplits...');

// Case 3a: Empty custom split array rejected
const cEmpty = validateCustomSplits([], 1000);
assert.strictEqual(cEmpty.valid, false);
assert.strictEqual(cEmpty.error, 'Custom splits are required');

// Case 3b: Exact decimal sum ₹0.10 + ₹0.20 = ₹0.30
const c1 = validateCustomSplits(
  [
    { user: 'u1', share: 0.1 },
    { user: 'u2', share: 0.2 },
  ],
  30 // 30 paise
);
assert.strictEqual(c1.valid, true);
assert.strictEqual(c1.allocatedPaise, 30);
assert.strictEqual(c1.remainingPaise, 0);

// Case 3c: Legitimate numeric zero shares valid (both number and string "0")
const cZeroNum = validateCustomSplits(
  [
    { user: 'u1', share: 50.0 },
    { user: 'u2', share: 0.0 },
  ],
  5000 // ₹50.00
);
assert.strictEqual(cZeroNum.valid, true);
assert.strictEqual(cZeroNum.splits[1].share, 0);
assert.strictEqual(cZeroNum.splits[1].sharePaise, 0);

const cZeroStr = validateCustomSplits(
  [
    { user: 'u1', share: '50.00' },
    { user: 'u2', share: '0' },
  ],
  5000
);
assert.strictEqual(cZeroStr.valid, true);
assert.strictEqual(cZeroStr.splits[1].share, 0);
assert.strictEqual(cZeroStr.splits[1].sharePaise, 0);

// Case 3d: Non-numeric custom shares must be rejected (null, undefined, booleans, words)
const cNull = validateCustomSplits([{ user: 'u1', share: 50 }, { user: 'u2', share: null }], 5000);
assert.strictEqual(cNull.valid, false);
assert.strictEqual(cNull.error, 'Each participant share must be a valid numeric amount');

const cUndef = validateCustomSplits([{ user: 'u1', share: 50 }, { user: 'u2', share: undefined }], 5000);
assert.strictEqual(cUndef.valid, false);
assert.strictEqual(cUndef.error, 'Each participant share must be a valid numeric amount');

const cFalse = validateCustomSplits([{ user: 'u1', share: 50 }, { user: 'u2', share: false }], 5000);
assert.strictEqual(cFalse.valid, false);
assert.strictEqual(cFalse.error, 'Each participant share must be a valid numeric amount');

const cTrue = validateCustomSplits([{ user: 'u1', share: 49 }, { user: 'u2', share: true }], 5000);
assert.strictEqual(cTrue.valid, false);
assert.strictEqual(cTrue.error, 'Each participant share must be a valid numeric amount');

const cWord = validateCustomSplits([{ user: 'u1', share: 50 }, { user: 'u2', share: 'free' }], 5000);
assert.strictEqual(cWord.valid, false);
assert.strictEqual(cWord.error, 'Each participant share must be a valid numeric amount');

// Case 3e: Under-allocation
const cUnder = validateCustomSplits(
  [
    { user: 'u1', share: 30 },
    { user: 'u2', share: 30 },
  ],
  10000 // ₹100.00
);
assert.strictEqual(cUnder.valid, false);
assert.strictEqual(cUnder.allocatedPaise, 6000);
assert.strictEqual(cUnder.remainingPaise, 4000);
assert.strictEqual(cUnder.error.includes('₹40.00 remaining to allocate'), true);

// Case 3f: Over-allocation
const cOver = validateCustomSplits(
  [
    { user: 'u1', share: 60 },
    { user: 'u2', share: 50 },
  ],
  10000 // ₹100.00
);
assert.strictEqual(cOver.valid, false);
assert.strictEqual(cOver.allocatedPaise, 11000);
assert.strictEqual(cOver.remainingPaise, -1000);
assert.strictEqual(cOver.error.includes('Overallocated by ₹10.00'), true);

// Case 3g: Duplicate participants rejected
const cDup = validateCustomSplits(
  [
    { user: 'u1', share: 50 },
    { user: 'u1', share: 50 },
  ],
  10000
);
assert.strictEqual(cDup.valid, false);
assert.strictEqual(cDup.error, 'Duplicate split participant');

// Case 3h: Member validation against group members
const cMemberCheck = validateCustomSplits(
  [
    { user: 'u1', share: 50 },
    { user: 'stranger', share: 50 },
  ],
  10000,
  ['u1', 'u2']
);
assert.strictEqual(cMemberCheck.valid, false);
assert.strictEqual(cMemberCheck.error, 'All split users must be group members');

// Case 3i: Over-precision share rejected (> 2 decimals)
const cPrec = validateCustomSplits(
  [
    { user: 'u1', share: 33.333 },
    { user: 'u2', share: 66.667 },
  ],
  10000
);
assert.strictEqual(cPrec.valid, false);
assert.strictEqual(cPrec.error.includes('Participant shares cannot have more than 2 decimal places'), true);

console.log('✅ validateCustomSplits tests passed.');

// ============================================================================
// 4. Authorization Helper Tests (canEditExpense & canDeleteExpense)
// ============================================================================
console.log('Testing canEditExpense & canDeleteExpense...');

const groupCreatorCtx = { currentUserId: 'creator_1', groupCreatorId: 'creator_1', isActiveMember: true };
const expenseCreatorCtx = { currentUserId: 'user_1', groupCreatorId: 'creator_1', isActiveMember: true };
const payerOnlyCtx = { currentUserId: 'payer_1', groupCreatorId: 'creator_1', isActiveMember: true };
const nonMemberCtx = { currentUserId: 'other_user', groupCreatorId: 'creator_1', isActiveMember: true };
const departedCreatorCtx = { currentUserId: 'user_1', groupCreatorId: 'creator_1', isActiveMember: false };

// Modern expense (with createdBy)
const modernExpense = {
  createdBy: 'user_1',
  paidBy: { id: 'payer_1', name: 'Payer' },
};

// 4a. Group creator can edit and delete modern expense
assert.strictEqual(canEditExpense(modernExpense, groupCreatorCtx), true);
assert.strictEqual(canDeleteExpense(modernExpense, groupCreatorCtx), true);

// 4b. Expense creator can edit and delete modern expense
assert.strictEqual(canEditExpense(modernExpense, expenseCreatorCtx), true);
assert.strictEqual(canDeleteExpense(modernExpense, expenseCreatorCtx), true);

// 4c. Payer-only user CANNOT edit or delete modern expense
assert.strictEqual(canEditExpense(modernExpense, payerOnlyCtx), false);
assert.strictEqual(canDeleteExpense(modernExpense, payerOnlyCtx), false);

// 4d. Unrelated user CANNOT edit or delete
assert.strictEqual(canEditExpense(modernExpense, nonMemberCtx), false);
assert.strictEqual(canDeleteExpense(modernExpense, nonMemberCtx), false);

// 4e. Departed expense creator: UI hides both Edit and Delete
assert.strictEqual(canEditExpense(modernExpense, departedCreatorCtx), false);
assert.strictEqual(canDeleteExpense(modernExpense, departedCreatorCtx), false);
// Backend asymmetry test: allowDeparted parameter allows raw delete check
assert.strictEqual(canDeleteExpense(modernExpense, departedCreatorCtx, true), true);

// 4f. Payer identity representation tests: string ID vs id object vs _id object
// Legacy expense (without createdBy)
const legacyStringPayer = { createdBy: null, paidBy: 'payer_1' };
const legacyIdObjPayer = { createdBy: null, paidBy: { id: 'payer_1', name: 'Legacy Payer' } };
const legacyUnderscoreIdObjPayer = { createdBy: null, paidBy: { _id: 'payer_1', name: 'Legacy Payer' } };

assert.strictEqual(canEditExpense(legacyStringPayer, payerOnlyCtx), true);
assert.strictEqual(canDeleteExpense(legacyStringPayer, payerOnlyCtx), true);

assert.strictEqual(canEditExpense(legacyIdObjPayer, payerOnlyCtx), true);
assert.strictEqual(canDeleteExpense(legacyIdObjPayer, payerOnlyCtx), true);

assert.strictEqual(canEditExpense(legacyUnderscoreIdObjPayer, payerOnlyCtx), true);
assert.strictEqual(canDeleteExpense(legacyUnderscoreIdObjPayer, payerOnlyCtx), true);

// Modern expense with _id object: payer-only remains rejected
const modernUnderscoreIdObj = { createdBy: 'user_1', paidBy: { _id: 'payer_1', name: 'Payer' } };
assert.strictEqual(canEditExpense(modernUnderscoreIdObj, payerOnlyCtx), false);
assert.strictEqual(canDeleteExpense(modernUnderscoreIdObj, payerOnlyCtx), false);

// Legacy expense: non-payer non-creator is NOT authorized
assert.strictEqual(canEditExpense(legacyIdObjPayer, expenseCreatorCtx), false);
assert.strictEqual(canDeleteExpense(legacyIdObjPayer, expenseCreatorCtx), false);

console.log('✅ canEditExpense & canDeleteExpense tests passed.');

// ============================================================================
// 5. MutationRefreshError & executeMutationWithGuardedRefresh Integration Tests
// ============================================================================
console.log('Testing MutationRefreshError and executeMutationWithGuardedRefresh...');

// Test 5a: MutationRefreshError instance checks
const mockMutationResponse = { expense: { id: 'exp_1', amount: 100 } };
const sampleRefreshErr = new Error('Network timeout');
const customErr = new MutationRefreshError(
  'Expense saved, but updating group ledger failed. Please pull to refresh.',
  mockMutationResponse,
  sampleRefreshErr
);

assert.strictEqual(customErr instanceof Error, true);
assert.strictEqual(customErr.isRefreshFailure, true);
assert.strictEqual(customErr.mutationResponse.expense.id, 'exp_1');
assert.strictEqual(customErr.cause, sampleRefreshErr);
assert.strictEqual(customErr.message.includes('updating group ledger failed'), true);

(async () => {
  // Test 5b: executeMutationWithGuardedRefresh - Mutation succeeds, Refresh fails with 500/network error
  let mutatingHistoryA = [];
  const setMutatingA = (val) => mutatingHistoryA.push(val);
  let unauthorizedCalledA = false;
  const onUnauthorizedA = () => { unauthorizedCalledA = true; };

  const successfulMutationRes = { expense: { id: 'exp_success_99', amount: 500 } };
  const mockMutationFnA = async () => successfulMutationRes;
  const mockRefreshFnA = async () => { throw new Error('Ledger 500 Internal Server Error'); };

  try {
    await executeMutationWithGuardedRefresh(
      mockMutationFnA,
      mockRefreshFnA,
      onUnauthorizedA,
      setMutatingA,
      'Expense saved, but updating group ledger failed. Please pull to refresh.'
    );
    assert.fail('Should have thrown MutationRefreshError');
  } catch (err) {
    assert.strictEqual(err.isRefreshFailure, true, 'Must identify as refresh failure');
    assert.strictEqual(err.name, 'MutationRefreshError');
    assert.strictEqual(err.mutationResponse.expense.id, 'exp_success_99', 'Successful mutation response must be preserved on error');
    assert.strictEqual(unauthorizedCalledA, false, 'Should not trigger 401 unauthorized');
    assert.deepStrictEqual(mutatingHistoryA, [true, false], 'isMutating must be toggled true then reset to false');
  }

  // Test 5c: executeMutationWithGuardedRefresh - Mutation succeeds, Refresh succeeds
  let mutatingHistoryB = [];
  const setMutatingB = (val) => mutatingHistoryB.push(val);
  let refreshCalledB = false;
  const mockRefreshFnB = async () => { refreshCalledB = true; };

  const resultB = await executeMutationWithGuardedRefresh(
    mockMutationFnA,
    mockRefreshFnB,
    () => {},
    setMutatingB,
    'Failed refresh'
  );
  assert.strictEqual(resultB.expense.id, 'exp_success_99');
  assert.strictEqual(refreshCalledB, true);
  assert.deepStrictEqual(mutatingHistoryB, [true, false]);

  // Test 5d: executeMutationWithGuardedRefresh - Mutation succeeds, Refresh fails with 401
  let mutatingHistoryC = [];
  const setMutatingC = (val) => mutatingHistoryC.push(val);
  const authErr401 = new Error('Token expired');
  authErr401.status = 401;
  const mockRefreshFnC = async () => { throw authErr401; };

  try {
    await executeMutationWithGuardedRefresh(
      mockMutationFnA,
      mockRefreshFnC,
      () => {},
      setMutatingC,
      'Failed refresh'
    );
    assert.fail('Should have rethrown 401');
  } catch (err) {
    assert.strictEqual(err.status, 401);
    assert.strictEqual(err.isRefreshFailure, undefined, '401 during refresh must NOT be disguised as normal refresh failure');
    assert.deepStrictEqual(mutatingHistoryC, [true, false]);
  }

  // Test 5e: executeMutationWithGuardedRefresh - Mutation itself fails (e.g. 400 validation error)
  let mutatingHistoryD = [];
  const setMutatingD = (val) => mutatingHistoryD.push(val);
  let refreshCalledD = false;
  const mockMutationFnD = async () => {
    const err = new Error('Custom splits are required');
    err.status = 400;
    throw err;
  };

  try {
    await executeMutationWithGuardedRefresh(
      mockMutationFnD,
      async () => { refreshCalledD = true; },
      () => {},
      setMutatingD,
      'Failed refresh'
    );
    assert.fail('Should have thrown mutation error');
  } catch (err) {
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.message, 'Custom splits are required');
    assert.strictEqual(refreshCalledD, false, 'Refresh must never run if mutation failed');
    assert.deepStrictEqual(mutatingHistoryD, [true, false]);
  }

  console.log('✅ MutationRefreshError & executeMutationWithGuardedRefresh tests passed.');

  // ============================================================================
  // 6. Build Equal Expense Payload (M2 Helper)
  // ============================================================================
  console.log('Testing buildEqualExpensePayload...');

  const validMembers = ['user_1', 'user_2', 'user_3'];
  const validBaseParams = {
    groupId: 'grp_123',
    description: 'Dinner at Taj',
    amountInput: '150.75',
    paidBy: 'user_1',
    selectedParticipants: ['user_1', 'user_2', 'user_3'],
    category: 'Food',
    dateInput: '2026-10-16T12:00:00.000Z',
    validMemberIds: validMembers,
  };

  // 6a. Valid payload creation
  const resValid = buildEqualExpensePayload(validBaseParams);
  assert.strictEqual(resValid.valid, true);
  assert.strictEqual(resValid.payload.groupId, 'grp_123');
  assert.strictEqual(resValid.payload.description, 'Dinner at Taj');
  assert.strictEqual(resValid.payload.amount, 150.75);
  assert.strictEqual(resValid.payload.paidBy, 'user_1');
  assert.strictEqual(resValid.payload.splitType, 'equal');
  assert.deepStrictEqual(resValid.payload.splits, ['user_1', 'user_2', 'user_3']);
  assert.strictEqual(resValid.payload.category, 'Food');
  assert.strictEqual(resValid.payload.date, '2026-10-16T12:00:00.000Z');

  // 6b. Trimming description & group ID
  const resTrimmed = buildEqualExpensePayload({
    ...validBaseParams,
    groupId: '  grp_123  ',
    description: '  Lunch with team  ',
  });
  assert.strictEqual(resTrimmed.valid, true);
  assert.strictEqual(resTrimmed.payload.groupId, 'grp_123');
  assert.strictEqual(resTrimmed.payload.description, 'Lunch with team');

  // 6c. Missing / invalid group ID
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, groupId: '' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, groupId: '   ' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, groupId: null }).valid, false);

  // 6d. Missing / invalid description
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, description: '' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, description: '   ' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, description: 'a'.repeat(201) }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, description: 'a'.repeat(200) }).valid, true);

  // 6e. Invalid amount
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, amountInput: '0' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, amountInput: '-50' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, amountInput: '10.999' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, amountInput: 'abc' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, amountInput: '' }).valid, false);

  // 6f. Payer validation
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, paidBy: '' }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, paidBy: 'unknown_user' }).valid, false);
  assert.strictEqual(
    buildEqualExpensePayload({ ...validBaseParams, paidBy: 'unknown_user', validMemberIds: undefined }).valid,
    true
  ); // if validMemberIds not provided, allows valid non-empty string

  // 6g. Selected participants validation
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, selectedParticipants: [] }).valid, false);
  assert.strictEqual(buildEqualExpensePayload({ ...validBaseParams, selectedParticipants: null }).valid, false);
  assert.strictEqual(
    buildEqualExpensePayload({ ...validBaseParams, selectedParticipants: ['user_1', 'user_1'] }).valid,
    false,
    'Duplicate participants must be rejected'
  );
  assert.strictEqual(
    buildEqualExpensePayload({ ...validBaseParams, selectedParticipants: ['user_1', ''] }).valid,
    false,
    'Empty participant string must be rejected'
  );
  assert.strictEqual(
    buildEqualExpensePayload({ ...validBaseParams, selectedParticipants: ['user_1', 'outsider'] }).valid,
    false,
    'Outsider participant must be rejected when validMemberIds provided'
  );

  // 6h. Category default & length trimming
  const resCatDefault = buildEqualExpensePayload({ ...validBaseParams, category: '' });
  assert.strictEqual(resCatDefault.valid, true);
  assert.strictEqual(resCatDefault.payload.category, 'General');

  const resCatTrimmed = buildEqualExpensePayload({ ...validBaseParams, category: 'A'.repeat(50) });
  assert.strictEqual(resCatTrimmed.valid, true);
  assert.strictEqual(resCatTrimmed.payload.category, 'A'.repeat(40));

  // 6i. Date parsing & strict validation
  const resDateObj = buildEqualExpensePayload({
    ...validBaseParams,
    dateInput: new Date('2026-10-15T08:00:00.000Z'),
  });
  assert.strictEqual(resDateObj.valid, true);
  assert.strictEqual(resDateObj.payload.date, '2026-10-15T08:00:00.000Z');

  // Strict date validation: bad date inputs must be rejected, not silently defaulted to today
  const resDateInvalid = buildEqualExpensePayload({ ...validBaseParams, dateInput: 'not-a-date' });
  assert.strictEqual(resDateInvalid.valid, false, 'Malformed date string must be rejected');
  assert.ok(resDateInvalid.error.includes('valid date'));

  const resDateInvalidCalendar = buildEqualExpensePayload({ ...validBaseParams, dateInput: '2026-02-31' });
  assert.strictEqual(resDateInvalidCalendar.valid, false, 'Non-existent calendar date (Feb 31) must be rejected');

  // Empty or undefined date cleanly defaults to current ISO string
  const resDateEmpty = buildEqualExpensePayload({ ...validBaseParams, dateInput: undefined });
  assert.strictEqual(resDateEmpty.valid, true);
  assert.ok(typeof resDateEmpty.payload.date === 'string');
  assert.ok(!isNaN(new Date(resDateEmpty.payload.date).getTime()));

  console.log('✅ buildEqualExpensePayload tests passed.');

  // ============================================================================
  // 7. M3 Date Validation & Hook-Level Re-entrancy Guard
  // ============================================================================
  console.log('Testing validateExpenseDate...');

  // 7a. validateExpenseDate - valid cases
  assert.strictEqual(validateExpenseDate(undefined).valid, true);
  assert.strictEqual(validateExpenseDate(null).valid, true);
  assert.strictEqual(validateExpenseDate('').valid, true);
  assert.strictEqual(validateExpenseDate('   ').valid, true);

  const vd1 = validateExpenseDate('2026-10-16');
  assert.strictEqual(vd1.valid, true);
  assert.ok(vd1.isoDate.startsWith('2026-10-16'));

  const vdObj = validateExpenseDate(new Date('2026-05-20T10:00:00Z'));
  assert.strictEqual(vdObj.valid, true);
  assert.strictEqual(vdObj.isoDate, '2026-05-20T10:00:00.000Z');

  // 7b. validateExpenseDate - invalid cases
  assert.strictEqual(validateExpenseDate('not-a-date').valid, false);
  assert.strictEqual(validateExpenseDate(new Date('invalid')).valid, false);
  assert.strictEqual(validateExpenseDate('2026-02-30').valid, false); // Feb 30 does not exist
  assert.strictEqual(validateExpenseDate('2026-04-31').valid, false); // Apr 31 does not exist
  assert.strictEqual(validateExpenseDate('2026-13-01').valid, false); // Month 13
  assert.strictEqual(validateExpenseDate('2026-00-10').valid, false); // Month 0
  assert.strictEqual(validateExpenseDate('2026-05-32').valid, false); // Day 32

  console.log('✅ validateExpenseDate tests passed.');

  // 7c. executeMutationWithGuardedRefresh Re-entrancy Guard
  console.log('Testing executeMutationWithGuardedRefresh re-entrancy guard...');

  const isMutatingRef = { current: true };
  let mutationCalled = false;
  let refreshCalled = false;

  try {
    await executeMutationWithGuardedRefresh(
      async () => { mutationCalled = true; },
      async () => { refreshCalled = true; },
      () => {},
      () => {},
      'Refresh error',
      isMutatingRef
    );
    assert.fail('Should have thrown mutation in progress error');
  } catch (err) {
    assert.strictEqual(err.message, 'A mutation is already in progress');
    assert.strictEqual(mutationCalled, false, 'Mutation must not execute when already in progress');
    assert.strictEqual(refreshCalled, false, 'Refresh must not execute when already in progress');
  }

  // Normal execution toggles isMutatingRef.current true and resets to false
  const activeRef = { current: false };
  let observedInFlightRef = null;
  const resGuarded = await executeMutationWithGuardedRefresh(
    async () => {
      observedInFlightRef = activeRef.current;
      return { success: true };
    },
    async () => {},
    () => {},
    () => {},
    'Refresh error',
    activeRef
  );
  assert.strictEqual(resGuarded.success, true);
  assert.strictEqual(observedInFlightRef, true, 'isMutatingRef must be true during execution');
  assert.strictEqual(activeRef.current, false, 'isMutatingRef must reset to false after completion');

  // Mutation error resets isMutatingRef.current to false
  const errorRef = { current: false };
  try {
    await executeMutationWithGuardedRefresh(
      async () => { throw new Error('Mutation failed'); },
      async () => {},
      () => {},
      () => {},
      'Refresh error',
      errorRef
    );
    assert.fail('Should have thrown');
  } catch (err) {
    assert.strictEqual(err.message, 'Mutation failed');
    assert.strictEqual(errorRef.current, false, 'isMutatingRef must reset to false on mutation failure');
  }

  console.log('✅ executeMutationWithGuardedRefresh re-entrancy guard tests passed.');

  // ============================================================================
  // 8. Authorization Scenarios (Modern vs Legacy & Departed Members)
  // ============================================================================
  console.log('Testing authorization scenarios...');

  const groupCreator = 'user_gc';
  const expCreator = 'user_ec';
  const payerUser = 'user_payer';
  const strangerUser = 'user_other';

  const modernExpense = {
    id: 'exp_mod',
    createdBy: expCreator,
    paidBy: { id: payerUser, name: 'Payer' },
  };

  const legacyExpense = {
    id: 'exp_leg',
    createdBy: null,
    paidBy: { id: payerUser, name: 'Payer' },
  };

  // Modern expense:
  // - Expense creator can edit and delete
  assert.strictEqual(canEditExpense(modernExpense, { currentUserId: expCreator, groupCreatorId: groupCreator, isActiveMember: true }), true);
  assert.strictEqual(canDeleteExpense(modernExpense, { currentUserId: expCreator, groupCreatorId: groupCreator, isActiveMember: true }), true);

  // - Group creator can edit and delete
  assert.strictEqual(canEditExpense(modernExpense, { currentUserId: groupCreator, groupCreatorId: groupCreator, isActiveMember: true }), true);
  assert.strictEqual(canDeleteExpense(modernExpense, { currentUserId: groupCreator, groupCreatorId: groupCreator, isActiveMember: true }), true);

  // - Payer who is NOT creator CANNOT edit or delete modern expense
  assert.strictEqual(canEditExpense(modernExpense, { currentUserId: payerUser, groupCreatorId: groupCreator, isActiveMember: true }), false);
  assert.strictEqual(canDeleteExpense(modernExpense, { currentUserId: payerUser, groupCreatorId: groupCreator, isActiveMember: true }), false);

  // - Stranger cannot edit or delete
  assert.strictEqual(canEditExpense(modernExpense, { currentUserId: strangerUser, groupCreatorId: groupCreator, isActiveMember: true }), false);
  assert.strictEqual(canDeleteExpense(modernExpense, { currentUserId: strangerUser, groupCreatorId: groupCreator, isActiveMember: true }), false);

  // Legacy expense:
  // - Original payer CAN edit and delete
  assert.strictEqual(canEditExpense(legacyExpense, { currentUserId: payerUser, groupCreatorId: groupCreator, isActiveMember: true }), true);
  assert.strictEqual(canDeleteExpense(legacyExpense, { currentUserId: payerUser, groupCreatorId: groupCreator, isActiveMember: true }), true);

  // - Group creator CAN edit and delete
  assert.strictEqual(canEditExpense(legacyExpense, { currentUserId: groupCreator, groupCreatorId: groupCreator, isActiveMember: true }), true);
  assert.strictEqual(canDeleteExpense(legacyExpense, { currentUserId: groupCreator, groupCreatorId: groupCreator, isActiveMember: true }), true);

  // - Stranger cannot edit or delete legacy expense
  assert.strictEqual(canEditExpense(legacyExpense, { currentUserId: strangerUser, groupCreatorId: groupCreator, isActiveMember: true }), false);
  assert.strictEqual(canDeleteExpense(legacyExpense, { currentUserId: strangerUser, groupCreatorId: groupCreator, isActiveMember: true }), false);

  // Departed member (isActiveMember: false):
  // Cannot edit or delete regardless of creator or payer role
  assert.strictEqual(canEditExpense(modernExpense, { currentUserId: expCreator, groupCreatorId: groupCreator, isActiveMember: false }), false);
  assert.strictEqual(canDeleteExpense(modernExpense, { currentUserId: expCreator, groupCreatorId: groupCreator, isActiveMember: false }), false);
  assert.strictEqual(canEditExpense(legacyExpense, { currentUserId: payerUser, groupCreatorId: groupCreator, isActiveMember: false }), false);
  assert.strictEqual(canDeleteExpense(legacyExpense, { currentUserId: payerUser, groupCreatorId: groupCreator, isActiveMember: false }), false);

  console.log('✅ Authorization scenario tests passed.');

  // ============================================================================
  // 9. Milestone 4 Custom Split & Departed Member Unit Tests
  // ============================================================================
  console.log('Testing Milestone 4 Custom Splits & Departed Members...');

  // 9a. Departed Member Detection (hasDepartedSplitParticipants)
  const activeGroupMembers = ['user_alice', 'user_bob', 'user_carol'];
  const activeMemberSet = new Set(activeGroupMembers);

  // All participants are active members (both string arrays and object splits)
  assert.strictEqual(
    hasDepartedSplitParticipants(['user_alice', 'user_bob'], activeGroupMembers),
    false,
    'Active string split should not report departed members'
  );
  assert.strictEqual(
    hasDepartedSplitParticipants(
      [
        { user: 'user_alice', share: 50 },
        { user: { id: 'user_bob', name: 'Bob' }, share: 50 },
      ],
      activeMemberSet
    ),
    false,
    'Active object split should not report departed members'
  );
  assert.strictEqual(
    hasDepartedSplitParticipants(
      [
        { user: { _id: 'user_carol', name: 'Carol' }, share: 100 },
      ],
      activeGroupMembers
    ),
    false,
    '_id user object split should not report departed members'
  );

  // Participant who left the group
  assert.strictEqual(
    hasDepartedSplitParticipants(
      ['user_alice', 'user_departed_dave'],
      activeGroupMembers
    ),
    true,
    'Departed string split participant must be detected'
  );
  assert.strictEqual(
    hasDepartedSplitParticipants(
      [
        { user: 'user_alice', share: 50 },
        { user: 'user_departed_dave', share: 50 },
      ],
      activeGroupMembers
    ),
    true,
    'Departed user ID in object split must be detected'
  );
  assert.strictEqual(
    hasDepartedSplitParticipants(
      [
        { user: { id: 'user_departed_dave', name: 'Dave' }, share: 100 },
      ],
      activeGroupMembers
    ),
    true,
    'Departed user id in object split must be detected'
  );
  assert.strictEqual(
    hasDepartedSplitParticipants(
      [
        { user: { _id: 'user_departed_dave', name: 'Dave' }, share: 100 },
      ],
      activeGroupMembers
    ),
    true,
    'Departed user _id in object split must be detected'
  );

  // Edge cases: null, empty, undefined
  assert.strictEqual(hasDepartedSplitParticipants([], activeGroupMembers), false);
  assert.strictEqual(hasDepartedSplitParticipants(null, activeGroupMembers), false);
  assert.strictEqual(hasDepartedSplitParticipants(undefined, activeGroupMembers), false);

  // 9b. Custom Split Validation (validateCustomSplits integer paise math)
  // Total ₹100.00 (10000 paise) split 3 ways: 33.34 + 33.33 + 33.33 = 100.00 (Exact match)
  const exactCustomSplits = [
    { user: 'user_alice', share: '33.34' },
    { user: 'user_bob', share: '33.33' },
    { user: 'user_carol', share: '33.33' },
  ];
  const exactRes = validateCustomSplits(exactCustomSplits, 10000, activeMemberSet);
  assert.strictEqual(exactRes.valid, true);
  assert.strictEqual(exactRes.allocatedPaise, 10000);
  assert.strictEqual(exactRes.remainingPaise, 0);
  assert.strictEqual(exactRes.splits.length, 3);
  assert.strictEqual(exactRes.splits[0].share, 33.34);
  assert.strictEqual(exactRes.splits[1].share, 33.33);
  assert.strictEqual(exactRes.splits[2].share, 33.33);

  // Total ₹100.00, sum = 99.99 (9999 paise) -> 1 paisa remaining (Under-allocated)
  const underCustomSplits = [
    { user: 'user_alice', share: '33.33' },
    { user: 'user_bob', share: '33.33' },
    { user: 'user_carol', share: '33.33' },
  ];
  const underRes = validateCustomSplits(underCustomSplits, 10000, activeMemberSet);
  assert.strictEqual(underRes.valid, false);
  assert.strictEqual(underRes.allocatedPaise, 9999);
  assert.strictEqual(underRes.remainingPaise, 1);
  assert.strictEqual(underRes.error.includes('0.01 remaining'), true);

  // Total ₹100.00, sum = 100.01 (10001 paise) -> 1 paisa over (Over-allocated)
  const overCustomSplits = [
    { user: 'user_alice', share: '33.34' },
    { user: 'user_bob', share: '33.34' },
    { user: 'user_carol', share: '33.33' },
  ];
  const overRes = validateCustomSplits(overCustomSplits, 10000, activeMemberSet);
  assert.strictEqual(overRes.valid, false);
  assert.strictEqual(overRes.allocatedPaise, 10001);
  assert.strictEqual(overRes.remainingPaise, -1);
  assert.strictEqual(overRes.error.includes('Overallocated by ₹0.01'), true);

  // Two decimals precision: ₹0.10 + ₹0.20 = ₹0.30 (30 paise)
  const decimalRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '0.10' },
      { user: 'user_bob', share: '0.20' },
    ],
    30,
    activeMemberSet
  );
  assert.strictEqual(decimalRes.valid, true);
  assert.strictEqual(decimalRes.allocatedPaise, 30);
  assert.strictEqual(decimalRes.remainingPaise, 0);

  // Fractions beyond 2 decimals rejected: e.g. "33.333"
  const fractionRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '33.333' },
      { user: 'user_bob', share: '66.667' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(fractionRes.valid, false);
  assert.strictEqual(fractionRes.error.includes('cannot have more than 2 decimal places'), true);

  // Zero share is allowed: user_alice pays full ₹100, user_bob has 0 share
  const zeroShareRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '100' },
      { user: 'user_bob', share: '0' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(zeroShareRes.valid, true);
  assert.strictEqual(zeroShareRes.allocatedPaise, 10000);
  assert.strictEqual(zeroShareRes.splits[1].share, 0);

  // Negative share rejected (both string and numeric format)
  const negStringRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '110' },
      { user: 'user_bob', share: '-10' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(negStringRes.valid, false);

  const negNumRes = validateCustomSplits(
    [
      { user: 'user_alice', share: 50 },
      { user: 'user_bob', share: -10 },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(negNumRes.valid, false);
  assert.strictEqual(negNumRes.error.includes('non-negative'), true);

  // Non-numeric share rejected
  const nonNumRes = validateCustomSplits(
    [
      { user: 'user_alice', share: 'abc' },
      { user: 'user_bob', share: '100' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(nonNumRes.valid, false);

  // Empty share string rejected
  const emptyShareRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '' },
      { user: 'user_bob', share: '100' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(emptyShareRes.valid, false);

  // Duplicate user rejected
  const dupUserRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '50' },
      { user: 'user_alice', share: '50' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(dupUserRes.valid, false);
  assert.strictEqual(dupUserRes.error.includes('Duplicate'), true);

  // Non-member rejected when memberSet provided
  const nonMemberRes = validateCustomSplits(
    [
      { user: 'user_alice', share: '50' },
      { user: 'user_stranger', share: '50' },
    ],
    10000,
    activeMemberSet
  );
  assert.strictEqual(nonMemberRes.valid, false);
  assert.strictEqual(nonMemberRes.error.includes('group member'), true);

  // 9c. buildCustomExpensePayload Unit Tests
  const validCustomParams = {
    groupId: 'grp_m4_test',
    description: 'Team Lunch Outing',
    amountInput: '150.50',
    paidBy: 'user_alice',
    customSplits: [
      { user: 'user_alice', share: '75.25' },
      { user: 'user_bob', share: '75.25' },
    ],
    category: 'Food',
    dateInput: '2026-10-17',
    validMemberIds: activeGroupMembers,
  };

  const customPayloadRes = buildCustomExpensePayload(validCustomParams);
  assert.strictEqual(customPayloadRes.valid, true);
  assert.strictEqual(customPayloadRes.payload.groupId, 'grp_m4_test');
  assert.strictEqual(customPayloadRes.payload.description, 'Team Lunch Outing');
  assert.strictEqual(customPayloadRes.payload.amount, 150.5);
  assert.strictEqual(customPayloadRes.payload.paidBy, 'user_alice');
  assert.strictEqual(customPayloadRes.payload.splitType, 'custom');
  assert.strictEqual(customPayloadRes.payload.category, 'Food');
  assert.deepStrictEqual(customPayloadRes.payload.splits, [
    { user: 'user_alice', share: 75.25 },
    { user: 'user_bob', share: 75.25 },
  ]);

  // Amount and custom split mismatch returns valid: false
  const mismatchedCustomParams = {
    ...validCustomParams,
    amountInput: '200.00',
  };
  const mismatchedRes = buildCustomExpensePayload(mismatchedCustomParams);
  assert.strictEqual(mismatchedRes.valid, false);
  assert.strictEqual(mismatchedRes.remainingPaise, 4950); // 20000 - 15050 = 4950 paise

  // Missing or non-member payer
  assert.strictEqual(
    buildCustomExpensePayload({ ...validCustomParams, paidBy: '' }).valid,
    false
  );
  assert.strictEqual(
    buildCustomExpensePayload({ ...validCustomParams, paidBy: 'user_nonmember' }).valid,
    false
  );

  // Description validation (empty or > 200 chars)
  assert.strictEqual(
    buildCustomExpensePayload({ ...validCustomParams, description: '' }).valid,
    false
  );
  assert.strictEqual(
    buildCustomExpensePayload({ ...validCustomParams, description: 'a'.repeat(201) }).valid,
    false
  );

  // Invalid date rejected
  assert.strictEqual(
    buildCustomExpensePayload({ ...validCustomParams, dateInput: '2026-02-31' }).valid,
    false
  );

  // 9d. Editing Prepopulation Round-Trip Safety Check
  // Simulating an existing custom-split expense being edited
  const existingCustomExpense = {
    id: 'exp_existing_custom',
    description: 'Movie Night',
    amount: 90,
    paidBy: { id: 'user_alice', name: 'Alice' },
    splitType: 'custom',
    splits: [
      { user: { id: 'user_alice', name: 'Alice' }, share: 30 },
      { user: { id: 'user_bob', name: 'Bob' }, share: 60 },
    ],
  };

  // Prepopulate state format
  const prepopulatedSplits = existingCustomExpense.splits.map((s) => ({
    user: typeof s.user === 'object' ? s.user.id : s.user,
    share: String(s.share),
  }));

  const roundTripRes = buildCustomExpensePayload({
    groupId: 'grp_m4_test',
    description: existingCustomExpense.description,
    amountInput: String(existingCustomExpense.amount),
    paidBy: existingCustomExpense.paidBy.id,
    customSplits: prepopulatedSplits,
    validMemberIds: activeGroupMembers,
  });

  assert.strictEqual(roundTripRes.valid, true);
  assert.strictEqual(roundTripRes.payload.amount, 90);
  assert.deepStrictEqual(roundTripRes.payload.splits, [
    { user: 'user_alice', share: 30 },
    { user: 'user_bob', share: 60 },
  ]);

  console.log('✅ Milestone 4 Custom Split & Departed Member tests passed.');
  console.log('🎉 All Phase 4 M1, M2, M3 & M4 unit tests passed successfully!');
})();
