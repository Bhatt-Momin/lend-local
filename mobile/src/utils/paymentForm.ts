/**
 * LendLocal Native Mobile — Payment & UPI Validation Helpers
 *
 * Source-verified against backend routes:
 * - backend/routes/auth.js (POST /api/auth/upi-id)
 * - backend/routes/payment.js
 * - backend/models/payment.js
 */

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

