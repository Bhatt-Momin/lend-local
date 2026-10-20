/**
 * LendLocal Native Mobile — Server Configuration & URL Utilities
 *
 * Provides pure URL normalization, validation, and default resolution logic
 * for both standalone production builds and local development environments.
 */

export const PRODUCTION_API_URL = 'https://lendlocal-58sf.onrender.com/api';
export const HEALTH_CHECK_TIMEOUT_MS = 20000; // 20 seconds (Render cold-start resilience)

export interface ValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  error?: string;
}

export interface ResolveDefaultUrlOptions {
  envUrl?: string;
  isDev?: boolean;
  hostUri?: string;
  platform?: string;
  isDevice?: boolean;
}

/**
 * Normalizes an API base URL:
 * - Trims leading/trailing whitespace
 * - Strips redundant trailing slashes
 * - Strips accidental /health or /health/ suffixes
 * - Ensures a clean /api suffix
 */
export function normalizeApiBaseUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (!url) return '';

  // Strip trailing slashes
  url = url.replace(/\/+$/, '');

  // Strip accidental /health endpoint if pasted by user
  if (url.endsWith('/health')) {
    url = url.slice(0, -'/health'.length).replace(/\/+$/, '');
  }

  // Ensure /api suffix
  if (!url.endsWith('/api')) {
    url = `${url}/api`;
  }

  return url;
}

/**
 * Validates whether a given string is a usable backend API URL:
 * - Must be non-empty
 * - Must specify http:// or https:// protocol
 * - Must parse into a valid hostname (IP address, localhost, or domain)
 */
export function validateApiBaseUrl(rawUrl: string): ValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'Please enter a server URL' };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter a server URL' };
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, error: 'URL must start with http:// or https://' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Protocol must be http:// or https://' };
    }
    if (!parsed.hostname) {
      return { valid: false, error: 'URL must include a valid hostname or IP address' };
    }
  } catch (_err) {
    return { valid: false, error: 'Malformed URL format' };
  }

  return {
    valid: true,
    normalizedUrl: normalizeApiBaseUrl(trimmed),
  };
}

/**
 * Resolves the default API base URL based on runtime environment:
 * 1. Explicit EXPO_PUBLIC_API_URL environment variable has highest priority.
 * 2. In development mode (__DEV__ === true):
 *    - Physical device running Expo Go: detects dev machine LAN IP from hostUri.
 *    - Android emulator: detects 10.0.2.2:3000/api.
 *    - iOS Simulator / Web: localhost:3000/api.
 * 3. In standalone production APK (or whenever dev host is undetectable on device):
 *    - Unconditionally falls back to PRODUCTION_API_URL.
 */
export function resolveDefaultApiBaseUrl(options: ResolveDefaultUrlOptions = {}): string {
  // 1. Explicit environment variable override
  if (options.envUrl && options.envUrl.trim()) {
    return normalizeApiBaseUrl(options.envUrl);
  }

  // 2. Development mode detection
  const isDev =
    options.isDev ??
    (typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production');

  if (isDev) {
    // 2a. Physical device running Expo Go — detect Metro host IP
    if (options.isDevice && options.hostUri) {
      const host = options.hostUri.split(':')[0];
      if (host) {
        return `http://${host}:3000/api`;
      }
    }

    // 2b. Android emulator
    if (options.platform === 'android' && !options.isDevice) {
      return 'http://10.0.2.2:3000/api';
    }

    // 2c. iOS Simulator & Web local dev (non-device)
    if (!options.isDevice) {
      return 'http://localhost:3000/api';
    }
  }

  // 3. Standalone release / production fallback
  return PRODUCTION_API_URL;
}
