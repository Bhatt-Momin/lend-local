/**
 * LendLocal Native Mobile — Expense Form & Split Logic Helpers
 *
 * Source-verified against backend routes:
 * - backend/routes/expenses.js
 * - backend/models/Expense.js
 * - backend/utils/helpers.js
 *
 * FINANCIAL ACCURACY & INTEGER PAISE RULES:
 * 1. All balance and ledger calculations are performed authoritatively by the backend.
 * 2. Mobile validation uses exact integer paise arithmetic to guarantee 100% compatibility
 *    with backend Mongoose and accounting validation before network submission.
 * 3. Monetary amounts in INR have at most two decimal places: ₹0.01 <= amount <= ₹10,000,000.
 */

import type { CreateExpensePayload } from '../types/api';

export const MIN_EXPENSE_AMOUNT = 0.01;
export const MAX_EXPENSE_AMOUNT = 10000000; // ₹10,000,000

/**
 * Error thrown when a mutation succeeded on the server, but the subsequent
 * state refresh failed (e.g. intermittent network disconnect right after mutation).
 * This prevents treating saved mutations as unsaved failures.
 */
export class MutationRefreshError extends Error {
  readonly isRefreshFailure = true;
  readonly mutationResponse: any;

  constructor(message: string, mutationResponse: any, cause?: any) {
    super(message);
    this.name = 'MutationRefreshError';
    this.mutationResponse = mutationResponse;
    if (cause) (this as any).cause = cause;
  }
}

export const EXPENSE_CATEGORIES = [
  'General',
  'Food',
  'Rent',
  'Travel',
  'Utilities',
  'Entertainment',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const FILTER_CATEGORIES = ['All', ...EXPENSE_CATEGORIES] as const;

export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

export const CATEGORY_ICONS: Record<string, string> = {
  Food: '🍔',
  Transport: '🚗',
  Utilities: '⚡',
  Entertainment: '🎬',
  Shopping: '🛍️',
  Travel: '✈️',
  Health: '💊',
  General: '🏷️',
  Rent: '🏠',
};

export function getCategoryIcon(category?: string | null): string {
  if (!category) return '🏷️';
  return CATEGORY_ICONS[category] || '🏷️';
}

export interface ParseAmountResult {
  valid: boolean;
  paise: number;
  amount: number;
  error?: string;
}

/**
 * Validates and parses user amount input to exact integer paise and Rupees number.
 * Enforces:
 * - Non-empty string or positive finite number.
 * - Minimum ₹0.01, maximum ₹10,000,000.
 * - At most two decimal places.
 * - Safe integer paise (Math.round(amount * 100)).
 * - Rejects blank, malformed, negative, or over-precision input.
 */
export function parseAmountToPaise(input: string | number | null | undefined): ParseAmountResult {
  if (input === null || input === undefined) {
    return { valid: false, paise: 0, amount: 0, error: 'Amount is required' };
  }

  let num: number;
  if (typeof input === 'number') {
    num = input;
  } else {
    const trimmed = String(input).trim();
    if (!trimmed) {
      return { valid: false, paise: 0, amount: 0, error: 'Amount is required' };
    }
    // Reject malformed strings like "abc", "12.34.56", "-5", "+10", "NaN"
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      return { valid: false, paise: 0, amount: 0, error: 'Please enter a valid amount' };
    }
    // Precision check on string input: reject more than 2 decimal places
    const parts = trimmed.split('.');
    if (parts.length === 2 && parts[1].length > 2) {
      return { valid: false, paise: 0, amount: 0, error: 'Amount must have at most two decimal places' };
    }
    num = Number(trimmed);
  }

  if (!Number.isFinite(num) || isNaN(num) || num <= 0) {
    return { valid: false, paise: 0, amount: 0, error: 'Amount must be a positive number' };
  }

  if (num < MIN_EXPENSE_AMOUNT) {
    return { valid: false, paise: 0, amount: 0, error: 'Amount must be at least ₹0.01' };
  }

  if (num > MAX_EXPENSE_AMOUNT) {
    return {
      valid: false,
      paise: 0,
      amount: 0,
      error: `Amount cannot exceed ₹${MAX_EXPENSE_AMOUNT.toLocaleString('en-IN')}`,
    };
  }

  // Exact 2 decimal places numerical check
  if (parseFloat(num.toFixed(2)) !== num) {
    return { valid: false, paise: 0, amount: 0, error: 'Amount must have at most two decimal places' };
  }

  const paise = Math.round(num * 100);
  if (!Number.isSafeInteger(paise) || paise <= 0 || paise > Math.round(MAX_EXPENSE_AMOUNT * 100)) {
    return { valid: false, paise: 0, amount: 0, error: 'Expense amount exceeds safe arithmetic limits' };
  }

  return {
    valid: true,
    paise,
    amount: paise / 100,
  };
}

export interface EqualSplitPreviewItem {
  user: string;
  sharePaise: number;
  share: number;
}

export interface EqualPreviewResult {
  valid: boolean;
  splits: EqualSplitPreviewItem[];
  basePaise: number;
  remainderPaise: number;
  error?: string;
}

/**
 * Builds equal split share allocations matching the backend's exact algorithm:
 * - Integer division of total paise: basePaise = Math.floor(totalPaise / n)
 * - Remainder paise: remainderPaise = totalPaise % n
 * - Distribute 1 extra paisa to the first `remainderPaise` participants in submitted order.
 * - Rejects empty participant lists (never send an empty equal-split list because the backend
 *   would default that to all active group members).
 * - Rejects duplicate participant IDs.
 */
export function buildEqualPreview(
  amountPaise: number,
  participantIds: string[]
): EqualPreviewResult {
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    return {
      valid: false,
      splits: [],
      basePaise: 0,
      remainderPaise: 0,
      error: 'At least one participant is required for equal split',
    };
  }

  const unique = new Set<string>();
  for (const id of participantIds) {
    const trimmedId = String(id ?? '').trim();
    if (!trimmedId) {
      return {
        valid: false,
        splits: [],
        basePaise: 0,
        remainderPaise: 0,
        error: 'Invalid participant ID',
      };
    }
    if (unique.has(trimmedId)) {
      return {
        valid: false,
        splits: [],
        basePaise: 0,
        remainderPaise: 0,
        error: 'Duplicate split participant',
      };
    }
    unique.add(trimmedId);
  }

  if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    return {
      valid: false,
      splits: [],
      basePaise: 0,
      remainderPaise: 0,
      error: 'Valid positive amount in paise is required',
    };
  }

  const n = participantIds.length;
  const basePaise = Math.floor(amountPaise / n);
  const remainderPaise = amountPaise % n;

  const splits: EqualSplitPreviewItem[] = participantIds.map((id, idx) => {
    const sharePaise = basePaise + (idx < remainderPaise ? 1 : 0);
    return {
      user: String(id).trim(),
      sharePaise,
      share: sharePaise / 100,
    };
  });

  return {
    valid: true,
    splits,
    basePaise,
    remainderPaise,
  };
}

export interface CustomSplitInputItem {
  user: string;
  share: number | string;
}

export interface CustomSplitValidatedItem {
  user: string;
  share: number;
  sharePaise: number;
}

export interface ValidateCustomSplitsResult {
  valid: boolean;
  allocatedPaise: number;
  remainingPaise: number;
  splits: CustomSplitValidatedItem[];
  error?: string;
}

/**
 * Validates custom split shares in integer paise.
 * Rules:
 * - splits array must not be empty.
 * - No duplicate participants.
 * - If validMemberIds is provided, all split participants must be valid group members.
 * - Each share must be a valid, finite number >= 0 with at most 2 decimal places.
 * - Zero-valued shares are allowed if the total matches.
 * - Total allocated paise must strictly match totalPaise (remainingPaise === 0).
 */
export function validateCustomSplits(
  splits: CustomSplitInputItem[],
  totalPaise: number,
  validMemberIds?: string[] | Set<string>
): ValidateCustomSplitsResult {
  if (!Array.isArray(splits) || splits.length === 0) {
    return {
      valid: false,
      allocatedPaise: 0,
      remainingPaise: totalPaise,
      splits: [],
      error: 'Custom splits are required',
    };
  }

  const memberSet = validMemberIds
    ? validMemberIds instanceof Set
      ? validMemberIds
      : new Set(validMemberIds.map((m) => String(m).trim()))
    : null;

  const unique = new Set<string>();
  const validatedSplits: CustomSplitValidatedItem[] = [];
  let allocatedPaise = 0;

  for (const item of splits) {
    const userId = String(item.user || '').trim();
    if (!userId) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'Invalid split participant',
      };
    }

    if (unique.has(userId)) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'Duplicate split participant',
      };
    }
    unique.add(userId);

    if (memberSet && !memberSet.has(userId)) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'All split users must be group members',
      };
    }

    const rawShare = item.share;
    if (
      rawShare === null ||
      rawShare === undefined ||
      typeof rawShare === 'boolean'
    ) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'Each participant share must be a valid numeric amount',
      };
    }

    let share: number;
    if (typeof rawShare === 'number') {
      share = rawShare;
    } else {
      const trimmed = String(rawShare).trim();
      if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) {
        return {
          valid: false,
          allocatedPaise,
          remainingPaise: totalPaise - allocatedPaise,
          splits: [],
          error: 'Each participant share must be a valid numeric amount',
        };
      }
      share = Number(trimmed);
    }

    if (!Number.isFinite(share) || isNaN(share) || share < 0) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'Each participant share must be a valid non-negative number',
      };
    }

    // Decimal precision check
    if (parseFloat(share.toFixed(2)) !== share) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'Participant shares cannot have more than 2 decimal places',
      };
    }

    const sharePaise = Math.round(share * 100);
    if (!Number.isSafeInteger(sharePaise) || sharePaise < 0 || sharePaise > totalPaise) {
      return {
        valid: false,
        allocatedPaise,
        remainingPaise: totalPaise - allocatedPaise,
        splits: [],
        error: 'Invalid share amount',
      };
    }

    allocatedPaise += sharePaise;
    validatedSplits.push({
      user: userId,
      share: sharePaise / 100,
      sharePaise,
    });
  }

  const remainingPaise = totalPaise - allocatedPaise;

  if (remainingPaise !== 0) {
    const diffFormatted = (Math.abs(remainingPaise) / 100).toFixed(2);
    const allocFormatted = (allocatedPaise / 100).toFixed(2);
    const totalFormatted = (totalPaise / 100).toFixed(2);
    const errorMsg =
      remainingPaise > 0
        ? `₹${diffFormatted} remaining to allocate (allocated ₹${allocFormatted} of ₹${totalFormatted})`
        : `Overallocated by ₹${diffFormatted} (allocated ₹${allocFormatted} of ₹${totalFormatted})`;

    return {
      valid: false,
      allocatedPaise,
      remainingPaise,
      splits: validatedSplits,
      error: errorMsg,
    };
  }

  return {
    valid: true,
    allocatedPaise,
    remainingPaise: 0,
    splits: validatedSplits,
  };
}

export interface ExpenseAuthContext {
  currentUserId?: string | null;
  groupCreatorId?: string | null;
  isActiveMember?: boolean;
}

export interface ExpenseAuthTarget {
  createdBy?: string | null;
  paidBy?: { id?: string | null; _id?: string | null } | string | null;
}

/**
 * Determines whether the current user is authorized to edit an expense.
 *
 * Backend authorization rules (PUT /api/expenses/:id):
 * 1. Requires active group membership (assertMember). If user has departed, returns false.
 * 2. Group creator is always authorized (group.createdBy.equals(userId)).
 * 3. Modern expenses (with `createdBy` populated): Only the expense creator or group creator
 *    can edit. A payer who did not create the expense is NOT authorized.
 * 4. Legacy expenses (with no `createdBy`): Fallback allows the original payer or group creator.
 */
export function canEditExpense(
  expense: ExpenseAuthTarget,
  context: ExpenseAuthContext
): boolean {
  const currentUserId = context.currentUserId ? String(context.currentUserId).trim() : null;
  if (!currentUserId) return false;

  // Editing strictly requires active group membership
  if (!context.isActiveMember) return false;

  const groupCreatorId = context.groupCreatorId ? String(context.groupCreatorId).trim() : null;
  const isGroupCreator = Boolean(groupCreatorId && groupCreatorId === currentUserId);
  if (isGroupCreator) return true;

  const expenseCreatorId = expense.createdBy ? String(expense.createdBy).trim() : null;

  if (expenseCreatorId) {
    // Modern expense: Only creator or group creator
    return expenseCreatorId === currentUserId;
  }

  // Legacy expense fallback: original payer or group creator
  const payerId =
    typeof expense.paidBy === 'string'
      ? String(expense.paidBy).trim()
      : expense.paidBy
      ? String(expense.paidBy.id ?? expense.paidBy._id ?? '').trim()
      : null;

  return Boolean(payerId && payerId === currentUserId);
}

/**
 * Determines whether the current user is authorized to delete an expense.
 *
 * Backend authorization rules (DELETE /api/expenses/:id):
 * Note on backend asymmetry: In backend/routes/expenses.js, DELETE does not invoke
 * assertMember, allowing a departed creator to technically delete their expense via the raw API.
 * However, in the mobile UI, per product specifications, we prefer hiding both Edit and Delete
 * actions for departed members.
 *
 * 1. If not an active member, returns false (hides action in UI).
 * 2. Group creator is authorized.
 * 3. Modern expenses: Only expense creator or group creator is authorized (payer-only is rejected).
 * 4. Legacy expenses: Payer or group creator is authorized.
 */
export function canDeleteExpense(
  expense: ExpenseAuthTarget,
  context: ExpenseAuthContext,
  allowDeparted = false
): boolean {
  const currentUserId = context.currentUserId ? String(context.currentUserId).trim() : null;
  if (!currentUserId) return false;

  // Prefer hiding both actions for departed members in UI unless explicitly allowed
  if (!allowDeparted && !context.isActiveMember) return false;

  const groupCreatorId = context.groupCreatorId ? String(context.groupCreatorId).trim() : null;
  const isGroupCreator = Boolean(groupCreatorId && groupCreatorId === currentUserId);
  if (isGroupCreator) return true;

  const expenseCreatorId = expense.createdBy ? String(expense.createdBy).trim() : null;

  if (expenseCreatorId) {
    return expenseCreatorId === currentUserId;
  }

  const payerId =
    typeof expense.paidBy === 'string'
      ? String(expense.paidBy).trim()
      : expense.paidBy
      ? String(expense.paidBy.id ?? expense.paidBy._id ?? '').trim()
      : null;

  return Boolean(payerId && payerId === currentUserId);
}

export interface ValidateExpenseDateResult {
  valid: boolean;
  isoDate?: string;
  error?: string;
}

/**
 * Validates date input explicitly rather than silently falling back to today.
 *
 * Accepted formats:
 * - undefined, null, or empty string: defaults to current date (valid).
 * - Date object: must be a valid Date instance (not NaN).
 * - YYYY-MM-DD: parsed into year, month, day with strict calendar date validation (leap years, month days).
 * - Valid ISO / RFC date string: parsed and verified with Date.parse.
 *
 * Any malformed or non-calendar string is rejected with an informative error.
 */
export function validateExpenseDate(dateInput?: string | Date | null): ValidateExpenseDateResult {
  if (dateInput === undefined || dateInput === null || dateInput === '') {
    return { valid: true, isoDate: new Date().toISOString() };
  }

  if (dateInput instanceof Date) {
    if (isNaN(dateInput.getTime())) {
      return { valid: false, error: 'Please enter a valid date' };
    }
    return { valid: true, isoDate: dateInput.toISOString() };
  }

  const str = String(dateInput).trim();
  if (!str) {
    return { valid: true, isoDate: new Date().toISOString() };
  }

  // Strict YYYY-MM-DD validation
  const ymdMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);

    if (month < 1 || month > 12) {
      return { valid: false, error: 'Month must be between 01 and 12' };
    }
    if (day < 1 || day > 31) {
      return { valid: false, error: 'Day must be between 01 and 31' };
    }
    if (year < 1970 || year > 2100) {
      return { valid: false, error: 'Year must be between 1970 and 2100' };
    }

    const testDate = new Date(Date.UTC(year, month - 1, day));
    if (
      testDate.getUTCFullYear() !== year ||
      testDate.getUTCMonth() + 1 !== month ||
      testDate.getUTCDate() !== day
    ) {
      return { valid: false, error: 'Invalid calendar date' };
    }

    return { valid: true, isoDate: testDate.toISOString() };
  }

  // Attempt standard ISO parsing
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Please enter a valid date in YYYY-MM-DD format' };
  }

  return { valid: true, isoDate: parsed.toISOString() };
}

/**
 * Shared mutation runner with atomic guarded refresh, re-entrancy protection, and clear refresh-failure propagation.
 *
 * Requirements:
 * 1. If an optional isMutatingRef is provided and currently true, throws immediately to prevent re-entrant duplicate mutations.
 * 2. If mutationFn() throws, errors are caught, loading state is reset, and 401 triggers onUnauthorized.
 * 3. If mutationFn() succeeds, the mutation was committed by the server.
 * 4. Next, refreshFn() runs to update group, expenses, and ledger state.
 * 5. If refreshFn() throws 401, handles session loss without disguising it as an ordinary unsaved mutation.
 * 6. If refreshFn() fails with any other error (network/500), wraps it in MutationRefreshError
 *    so the caller knows the change was saved and the ledger refresh failed, preserving res on err.mutationResponse.
 * 7. Loading flags (both state and ref) are guaranteed to reset in finally.
 * 8. Never automatically resubmits mutations.
 */
export async function executeMutationWithGuardedRefresh<T>(
  mutationFn: () => Promise<T>,
  refreshFn: () => Promise<void>,
  onUnauthorized: () => Promise<void> | void,
  setIsMutating: (loading: boolean) => void,
  refreshErrorMessage: string,
  isMutatingRef?: { current: boolean }
): Promise<T> {
  if (isMutatingRef?.current) {
    const err: any = new Error('A mutation is already in progress');
    err.code = 'MUTATION_IN_PROGRESS';
    throw err;
  }
  if (isMutatingRef) {
    isMutatingRef.current = true;
  }
  setIsMutating(true);

  let res: T;
  try {
    try {
      res = await mutationFn();
    } catch (err: any) {
      if (err?.status === 401) {
        await onUnauthorized();
      }
      throw err;
    }

    try {
      await refreshFn();
    } catch (refreshErr: any) {
      if (refreshErr?.status === 401) {
        throw refreshErr;
      }
      throw new MutationRefreshError(refreshErrorMessage, res, refreshErr);
    }
  } finally {
    if (isMutatingRef) {
      isMutatingRef.current = false;
    }
    setIsMutating(false);
  }

  return res;
}

export interface BuildEqualExpenseParams {
  groupId: string;
  description: string;
  amountInput: string | number;
  paidBy: string;
  selectedParticipants: string[];
  category?: string;
  dateInput?: string | Date;
  validMemberIds?: string[] | Set<string>;
}

export interface BuildEqualExpenseResult {
  valid: boolean;
  payload?: CreateExpensePayload;
  error?: string;
}

/**
 * Validates form inputs and constructs a normalized CreateExpensePayload for equal split.
 * Enforces:
 * - Non-empty groupId.
 * - Trimmed description between 1 and 200 characters.
 * - Amount parsed via parseAmountToPaise (within limits, safe integer paise, at most 2 decimals).
 * - Payer must be a non-empty string and a valid group member if validMemberIds provided.
 * - At least one participant selected (never empty, preventing backend default-to-all).
 * - All participants must be unique and valid group members if validMemberIds provided.
 * - Category trimmed, max 40 characters, defaults to 'General'.
 * - Date strictly validated via validateExpenseDate (no silent conversion of bad dates).
 */
export function buildEqualExpensePayload(params: BuildEqualExpenseParams): BuildEqualExpenseResult {
  const groupId = String(params.groupId || '').trim();
  if (!groupId) {
    return { valid: false, error: 'Group ID is required' };
  }

  const trimmedDesc = String(params.description || '').trim();
  if (!trimmedDesc) {
    return { valid: false, error: 'Description is required' };
  }
  if (trimmedDesc.length > 200) {
    return { valid: false, error: 'Description cannot exceed 200 characters' };
  }

  const parsedAmount = parseAmountToPaise(params.amountInput);
  if (!parsedAmount.valid) {
    return { valid: false, error: parsedAmount.error || 'Please enter a valid amount' };
  }

  const memberSet = params.validMemberIds
    ? params.validMemberIds instanceof Set
      ? params.validMemberIds
      : new Set(params.validMemberIds.map((m) => String(m).trim()))
    : null;

  const paidBy = String(params.paidBy || '').trim();
  if (!paidBy) {
    return { valid: false, error: 'Payer is required' };
  }
  if (memberSet && !memberSet.has(paidBy)) {
    return { valid: false, error: 'Payer must be a member of the group' };
  }

  if (!Array.isArray(params.selectedParticipants) || params.selectedParticipants.length === 0) {
    return { valid: false, error: 'At least one participant is required for equal split' };
  }

  const uniqueParticipants = new Set<string>();
  const normalizedParticipants: string[] = [];

  for (const p of params.selectedParticipants) {
    const pId = String(p || '').trim();
    if (!pId) {
      return { valid: false, error: 'Invalid split participant ID' };
    }
    if (uniqueParticipants.has(pId)) {
      return { valid: false, error: 'Duplicate split participant' };
    }
    uniqueParticipants.add(pId);

    if (memberSet && !memberSet.has(pId)) {
      return { valid: false, error: 'All split participants must be group members' };
    }
    normalizedParticipants.push(pId);
  }

  const trimmedCategory = String(params.category || '').trim().slice(0, 40);
  const category = trimmedCategory || 'General';

  const dateResult = validateExpenseDate(params.dateInput);
  if (!dateResult.valid || !dateResult.isoDate) {
    return { valid: false, error: dateResult.error || 'Please enter a valid date' };
  }

  return {
    valid: true,
    payload: {
      groupId,
      description: trimmedDesc,
      amount: parsedAmount.amount,
      paidBy,
      splitType: 'equal',
      splits: normalizedParticipants,
      category,
      date: dateResult.isoDate,
    },
  };
}

/**
 * Detects if an expense has any participants who are no longer active group members.
 * Used to safeguard existing expenses from being corrupted or failing backend validation
 * when a past member has left the group.
 */
export function hasDepartedSplitParticipants(
  splits: Array<{ user: any; share?: number } | string> | undefined | null,
  validMemberIds: string[] | Set<string>
): boolean {
  if (!Array.isArray(splits) || splits.length === 0) return false;
  const memberSet =
    validMemberIds instanceof Set
      ? validMemberIds
      : new Set(Array.from(validMemberIds).map((m) => String(m).trim()));

  for (const s of splits) {
    let uId = '';
    if (typeof s === 'string') {
      uId = s.trim();
    } else if (s && typeof s === 'object') {
      if (s.user && typeof s.user === 'object') {
        uId = String(s.user.id ?? s.user._id ?? '').trim();
      } else if (s.user) {
        uId = String(s.user).trim();
      }
    }
    if (uId && !memberSet.has(uId)) {
      return true;
    }
  }
  return false;
}

export interface BuildCustomExpenseParams {
  groupId: string;
  description: string;
  amountInput: string | number;
  paidBy: string;
  customSplits: CustomSplitInputItem[];
  category?: string;
  dateInput?: string | Date;
  validMemberIds?: string[] | Set<string>;
}

export interface BuildCustomExpenseResult {
  valid: boolean;
  payload?: CreateExpensePayload;
  allocatedPaise?: number;
  remainingPaise?: number;
  error?: string;
}

/**
 * Validates form inputs and constructs a normalized CreateExpensePayload for custom split.
 * Enforces:
 * - Non-empty groupId.
 * - Trimmed description between 1 and 200 characters.
 * - Amount parsed via parseAmountToPaise (within limits, safe integer paise, at most 2 decimals).
 * - Payer must be a non-empty string and a valid group member if validMemberIds provided.
 * - Custom splits non-empty, unique participants, valid members.
 * - Each share must be non-negative numeric amount with at most 2 decimal places.
 * - Zero shares are allowed.
 * - Sum of all shares in integer paise must strictly match the total amount in paise.
 * - Category trimmed, max 40 characters, defaults to 'General'.
 * - Date strictly validated via validateExpenseDate.
 */
export function buildCustomExpensePayload(params: BuildCustomExpenseParams): BuildCustomExpenseResult {
  const groupId = String(params.groupId || '').trim();
  if (!groupId) {
    return { valid: false, error: 'Group ID is required' };
  }

  const trimmedDesc = String(params.description || '').trim();
  if (!trimmedDesc) {
    return { valid: false, error: 'Description is required' };
  }
  if (trimmedDesc.length > 200) {
    return { valid: false, error: 'Description cannot exceed 200 characters' };
  }

  const parsedAmount = parseAmountToPaise(params.amountInput);
  if (!parsedAmount.valid) {
    return { valid: false, error: parsedAmount.error || 'Please enter a valid amount' };
  }

  const memberSet = params.validMemberIds
    ? params.validMemberIds instanceof Set
      ? params.validMemberIds
      : new Set(Array.from(params.validMemberIds).map((m) => String(m).trim()))
    : null;

  const paidBy = String(params.paidBy || '').trim();
  if (!paidBy) {
    return { valid: false, error: 'Payer is required' };
  }
  if (memberSet && !memberSet.has(paidBy)) {
    return { valid: false, error: 'Payer must be a member of the group' };
  }

  const splitResult = validateCustomSplits(params.customSplits, parsedAmount.paise, memberSet || undefined);
  if (!splitResult.valid) {
    return {
      valid: false,
      allocatedPaise: splitResult.allocatedPaise,
      remainingPaise: splitResult.remainingPaise,
      error: splitResult.error || 'Custom splits do not match total amount',
    };
  }

  const trimmedCategory = String(params.category || '').trim().slice(0, 40);
  const category = trimmedCategory || 'General';

  const dateResult = validateExpenseDate(params.dateInput);
  if (!dateResult.valid || !dateResult.isoDate) {
    return { valid: false, error: dateResult.error || 'Please enter a valid date' };
  }

  const finalSplits = splitResult.splits.map((s) => ({
    user: s.user,
    share: s.share,
  }));

  return {
    valid: true,
    allocatedPaise: splitResult.allocatedPaise,
    remainingPaise: 0,
    payload: {
      groupId,
      description: trimmedDesc,
      amount: parsedAmount.amount,
      paidBy,
      splitType: 'custom',
      splits: finalSplits,
      category,
      date: dateResult.isoDate,
    },
  };
}
