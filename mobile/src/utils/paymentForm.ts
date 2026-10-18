/**
 * LendLocal Native Mobile — Payment & UPI Validation Helpers
 *
 * Source-verified against backend routes:
 * - backend/routes/auth.js (POST /api/auth/upi-id)
 * - backend/routes/payment.js
 * - backend/models/payment.js
 */

import type {
  CreateUpiIntentPayload,
  IntentActionPayload,
  PaymentStatus,
} from '../types/api';

/**
 * Standard UPI Virtual Payment Address (VPA) regex matching backend auth.js.
 * Conservative validation: username@bank
 * - Username: alphanumeric characters, underscores, dots, hyphens ([\w.-]+)
 * - Separator: @
 * - Bank handle: alphabetical characters only ([a-zA-Z]+)
 */
export const UPI_REGEX = /^[\w.-]+@[a-zA-Z]+$/;

export interface ValidateUpiIdResult {
  valid: boolean;
  upiId: string | null;
  isClearing: boolean;
  error?: string;
}

/**
 * Validates a UPI ID input string or clearing value.
 *
 * Rules:
 * 1. null, undefined, or empty/whitespace string represents clearing the UPI ID.
 *    When allowEmpty is true, this is treated as a valid clearing operation.
 * 2. Non-empty string must strictly match the UPI_REGEX format.
 * 3. Non-string types are rejected.
 */
export function validateUpiId(
  input: string | null | undefined,
  allowEmpty = true
): ValidateUpiIdResult {
  if (input === null || input === undefined) {
    if (allowEmpty) {
      return { valid: true, upiId: null, isClearing: true };
    }
    return { valid: false, upiId: null, isClearing: false, error: 'UPI ID is required' };
  }

  if (typeof input !== 'string') {
    return { valid: false, upiId: null, isClearing: false, error: 'UPI ID must be a string' };
  }

  const trimmed = input.trim();

  if (!trimmed) {
    if (allowEmpty) {
      return { valid: true, upiId: null, isClearing: true };
    }
    return { valid: false, upiId: null, isClearing: false, error: 'UPI ID is required' };
  }

  if (!UPI_REGEX.test(trimmed)) {
    return {
      valid: false,
      upiId: null,
      isClearing: false,
      error: 'Invalid UPI ID format (e.g. username@bank)',
    };
  }

  return {
    valid: true,
    upiId: trimmed,
    isClearing: false,
  };
}

/**
 * Normalizes input for POST /api/auth/upi-id payload.
 */
export function buildUpdateUpiIdPayload(input: string | null | undefined): { upiId: string | null } {
  const result = validateUpiId(input, true);
  if (!result.valid) {
    throw new Error(result.error || 'Invalid UPI ID format');
  }
  return { upiId: result.upiId };
}

export interface ValidatePaymentAmountResult {
  valid: boolean;
  message?: string;
  numericAmount?: number;
  requestedPaise?: number;
  paymentAmount?: number;
}

/**
 * Validates a payment amount matching backend helpers.js validatePaymentAmount.
 * Enforces integer paise arithmetic, positive numbers, min ₹0.01,
 * maximum 2 decimal places, and caps at authorized settlement amount.
 */
export function validatePaymentAmount(
  amount: unknown,
  authorizedAmount?: number | null
): ValidatePaymentAmountResult {
  if (amount === undefined || amount === null || (typeof amount === 'string' && amount.trim() === '')) {
    return { valid: false, message: 'Payment amount is required' };
  }

  // Reject unsupported input types (e.g. booleans, arrays, objects)
  if (typeof amount !== 'number' && typeof amount !== 'string') {
    return { valid: false, message: 'Valid numeric amount is required' };
  }

  let numericAmount: number;

  if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { valid: false, message: 'Valid numeric amount is required' };
    }
    numericAmount = Number(trimmed);
  } else {
    if (!Number.isFinite(amount) || isNaN(amount)) {
      return { valid: false, message: 'Valid numeric amount is required' };
    }
    numericAmount = amount;
  }

  if (numericAmount < 0.01) {
    return { valid: false, message: 'Amount must be at least ₹0.01' };
  }

  // Check decimal places strictly (at most 2 decimal places)
  if (typeof amount === 'string') {
    const trimmed = amount.trim();
    const dotIndex = trimmed.indexOf('.');
    if (dotIndex !== -1 && trimmed.length - dotIndex - 1 > 2) {
      return { valid: false, message: 'Amount cannot have more than 2 decimal places' };
    }
  } else {
    const str = amount.toString();
    const dotIndex = str.indexOf('.');
    if (dotIndex !== -1 && str.length - dotIndex - 1 > 2) {
      const requestedPaise = Math.round(amount * 100);
      const diff = Math.abs(amount - requestedPaise / 100);
      if (diff > 1e-9) {
        return { valid: false, message: 'Amount cannot have more than 2 decimal places' };
      }
    }
  }

  const requestedPaise = Math.round(numericAmount * 100);

  if (authorizedAmount !== undefined && authorizedAmount !== null) {
    const authorizedPaise = Math.round(Number(authorizedAmount) * 100);
    if (requestedPaise > authorizedPaise) {
      return { valid: false, message: 'Payment exceeds authorized settlement amount' };
    }
  }

  return {
    valid: true,
    numericAmount: requestedPaise / 100,
    requestedPaise,
    paymentAmount: requestedPaise / 100,
  };
}

export interface BuildCreateIntentParams {
  groupId: string;
  toUserId: string;
  amount: string | number;
  authorizedAmount?: number | null;
  currentUserId?: string | null;
}

/**
 * Validates and constructs the payload for POST /api/payment/intent.
 */
export function buildCreateIntentPayload(params: BuildCreateIntentParams): CreateUpiIntentPayload {
  const { groupId, toUserId, amount, authorizedAmount, currentUserId } = params;

  if (!groupId || typeof groupId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(groupId)) {
    throw new Error('Valid group and receiver IDs are required');
  }

  if (!toUserId || typeof toUserId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(toUserId)) {
    throw new Error('Valid group and receiver IDs are required');
  }

  if (currentUserId && String(currentUserId) === String(toUserId)) {
    throw new Error('You cannot pay yourself');
  }

  const result = validatePaymentAmount(amount, authorizedAmount);
  if (!result.valid || result.paymentAmount === undefined) {
    throw new Error(result.message || 'Valid amount is required');
  }

  return {
    groupId,
    toUserId,
    amount: result.paymentAmount,
  };
}

/**
 * Determines whether a payment intent can be claimed by the user.
 * FINANCIAL RULE: Only the debtor/payer (intent.from) can claim payment,
 * and only while the intent is in 'pending' status.
 */
export function canClaimIntent(status: PaymentStatus, isPayer: boolean): boolean {
  return Boolean(isPayer && status === 'pending');
}

/**
 * Determines whether a payment intent can be cancelled.
 * FINANCIAL RULE: Only the debtor/payer (intent.from) can cancel payment,
 * and strictly while the status is 'pending'. Once claimed, cancellation is forbidden.
 */
export function canCancelIntent(status: PaymentStatus, isPayer: boolean): boolean {
  return Boolean(isPayer && status === 'pending');
}

/**
 * Determines whether an incoming payment intent can be confirmed by the user.
 * FINANCIAL RULE: Only the creditor/recipient (intent.to) can confirm receipt,
 * and strictly while the status is 'payer_claimed'.
 */
export function canConfirmIntent(status: PaymentStatus, isRecipient: boolean): boolean {
  return Boolean(isRecipient && status === 'payer_claimed');
}

/**
 * Determines whether an incoming payment intent can be rejected by the user.
 * FINANCIAL RULE: Only the creditor/recipient (intent.to) can reject a claim,
 * and strictly while the status is 'payer_claimed'.
 */
export function canRejectIntent(status: PaymentStatus, isRecipient: boolean): boolean {
  return Boolean(isRecipient && status === 'payer_claimed');
}

/**
 * Checks whether an intent status has reached a terminal state.
 * Terminal states require stopping all polling and refreshing.
 */
export function isTerminalStatus(status: PaymentStatus): boolean {
  return (
    status === 'recipient_confirmed' ||
    status === 'recipient_rejected' ||
    status === 'cancelled' ||
    status === 'paid' ||
    status === 'failed' ||
    status === 'reversed'
  );
}

/**
 * Validates an intentId for /api/payment/claim, /cancel, /status.
 */
export function buildIntentActionPayload(intentId: string): IntentActionPayload {
  if (!intentId || typeof intentId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(intentId.trim())) {
    throw new Error('Valid intentId is required');
  }
  return { intentId: intentId.trim() };
}

export type PaymentBadgeTone = 'pending' | 'claimed' | 'confirmed' | 'rejected' | 'cancelled' | 'unknown';

export interface PaymentStatusBadgeInfo {
  label: string;
  color: string;
  bgColor: string;
  tone: PaymentBadgeTone;
}

/**
 * Returns human-readable UI presentation badge details for payment statuses.
 */
export function getPaymentStatusBadge(status: PaymentStatus | string): PaymentStatusBadgeInfo {
  switch (status) {
    case 'pending':
      return {
        label: 'Payment Pending',
        color: '#F59E0B',
        bgColor: '#F59E0B1A',
        tone: 'pending',
      };
    case 'payer_claimed':
      return {
        label: 'Claimed (Awaiting Confirmation)',
        color: '#38BDF8',
        bgColor: '#38BDF81A',
        tone: 'claimed',
      };
    case 'recipient_confirmed':
    case 'paid':
      return {
        label: 'Confirmed & Settled',
        color: '#10B981',
        bgColor: '#10B9811A',
        tone: 'confirmed',
      };
    case 'recipient_rejected':
    case 'failed':
      return {
        label: 'Rejected',
        color: '#EF4444',
        bgColor: '#EF44441A',
        tone: 'rejected',
      };
    case 'cancelled':
    case 'reversed':
      return {
        label: 'Cancelled',
        color: '#94A3B8',
        bgColor: '#94A3B81A',
        tone: 'cancelled',
      };
    default:
      return {
        label: 'Unknown',
        color: '#94A3B8',
        bgColor: '#94A3B81A',
        tone: 'unknown',
      };
  }
}

/**
 * Safely extracts the payee UPI VPA ('pa' query parameter) from a UPI intent URI.
 * e.g., 'upi://pay?pa=alice%40okhdfcbank&pn=Alice&...' -> 'alice@okhdfcbank'
 * Returns null if URI is absent, malformed, or does not contain a valid 'pa' parameter.
 */
export function extractUpiVpa(upiUri?: string | null): string | null {
  if (!upiUri || typeof upiUri !== 'string') {
    return null;
  }
  try {
    const match = upiUri.match(/[?&]pa=([^&]+)/);
    if (!match || !match[1]) {
      return null;
    }
    const decoded = decodeURIComponent(match[1]).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

