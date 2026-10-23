/**
 * phone.js — International Phone Number Normalization and Validation
 *
 * Enforces strict ITU-T E.164 compliance using libphonenumber-js.
 * Requires clients to provide full international numbers with country calling code.
 * Rejects domestic-only numbers, extensions, letters, and impossible number combinations.
 */

const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Validates and normalizes an international phone number to E.164.
 *
 * @param {string} rawPhone - Candidate phone number string (e.g. "+91 98765 43210")
 * @returns {{ valid: boolean, e164?: string, country?: string, callingCode?: string, error?: string }}
 */
function validateAndNormalizePhone(rawPhone) {
  if (typeof rawPhone !== 'string') {
    return { valid: false, error: 'Phone number must be a string' };
  }

  const trimmed = rawPhone.trim();
  if (!trimmed) {
    return { valid: false, error: 'Phone number is required' };
  }

  // Enforce explicit international country code with leading '+'
  if (!trimmed.startsWith('+')) {
    return {
      valid: false,
      error: 'Phone number must include an international country code starting with "+" (e.g. +919876543210 or +14155552671)',
    };
  }

  // Reject extensions, letters, and suspicious characters
  if (/[a-zA-Z]/.test(trimmed)) {
    return {
      valid: false,
      error: 'Phone number cannot contain extensions or alphabetic characters',
    };
  }

  try {
    const parsed = parsePhoneNumberFromString(trimmed);
    if (!parsed) {
      return { valid: false, error: 'Invalid international phone number format' };
    }

    if (parsed.ext) {
      return { valid: false, error: 'Phone number cannot contain extensions' };
    }

    if (!parsed.isValid()) {
      return {
        valid: false,
        error: 'Phone number is not valid for the specified country calling code',
      };
    }

    return {
      valid: true,
      e164: parsed.format('E.164'),
      country: parsed.country || null,
      callingCode: parsed.countryCallingCode || null,
    };
  } catch (err) {
    return { valid: false, error: 'Failed to parse phone number' };
  }
}

/**
 * Masks a phone number for safe logging without exposing full digits.
 * e.g. "+14155552671" -> "+141****2671"
 *
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return 'unknown';
  const clean = phone.trim();
  if (clean.length <= 6) return '****';
  const prefix = clean.slice(0, 4);
  const suffix = clean.slice(-4);
  return `${prefix}${'*'.repeat(Math.max(clean.length - 8, 3))}${suffix}`;
}

module.exports = {
  validateAndNormalizePhone,
  maskPhone,
};
