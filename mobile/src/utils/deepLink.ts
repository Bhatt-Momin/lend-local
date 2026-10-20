/**
 * LendLocal Native Mobile — Payment Deep-Link Routing Utilities
 *
 * Provides pure URL parsing, validation, duplicate event suppression,
 * in-memory pending link store, and group resolution logic.
 *
 * Supported Link Formats:
 * 1. Custom scheme:
 *    - lendlocal://group/:groupId?claimIntentId=:intentId
 *    - lendlocal://group.html?id=:groupId&claimIntentId=:intentId
 *    - lendlocal://payment/claim?claimIntentId=:intentId&groupId=:groupId
 *    - lendlocal://claim?claimIntentId=:intentId
 *    - lendlocal://?claimIntentId=:intentId&groupId=:groupId
 *    - lendlocal://group/:groupId (ordinary navigation)
 *    - lendlocal:// (home dashboard)
 * 2. Web HTTPS URLs:
 *    - https://lendlocal-58sf.onrender.com/group.html?id=:groupId&claimIntentId=:intentId
 *    - https://lendlocal-58sf.onrender.com/group/:groupId?claimIntentId=:intentId
 *    - https://lendlocal-58sf.onrender.com/group.html?id=:groupId (ordinary navigation)
 */

export const MONGO_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Allowed production and local development hostnames for HTTPS/HTTP web deep links.
 * Arbitrary third-party domains are rejected to protect against malicious link injection.
 */
export const TRUSTED_WEB_HOSTS = new Set([
  'lendlocal-58sf.onrender.com',
  'localhost',
  '127.0.0.1',
  '10.0.2.2',
]);

export function isTrustedWebHost(hostname: string): boolean {
  if (!hostname || typeof hostname !== 'string') return false;
  return TRUSTED_WEB_HOSTS.has(hostname.toLowerCase());
}

export interface ParsedDeepLink {
  isValid: boolean;
  rawUrl: string;
  scheme?: string;
  host?: string;
  path?: string;
  groupId?: string;
  claimIntentId?: string;
  isPaymentClaim: boolean;
  error?: string;
}

/**
 * Parses and validates an incoming deep link URL.
 * Extracts groupId and claimIntentId, verifying 24-character hexadecimal ObjectId format.
 */
export function parseDeepLink(rawUrl: string): ParsedDeepLink {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, rawUrl: '', isPaymentClaim: false, error: 'Empty deep link URL' };
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { isValid: false, rawUrl: trimmed, isPaymentClaim: false, error: 'Empty deep link URL' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (_err) {
    return { isValid: false, rawUrl: trimmed, isPaymentClaim: false, error: 'Malformed URL format' };
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  // Valid schemes: lendlocal, https, http
  if (scheme !== 'lendlocal' && scheme !== 'https' && scheme !== 'http') {
    return {
      isValid: false,
      rawUrl: trimmed,
      scheme,
      isPaymentClaim: false,
      error: `Unsupported scheme: ${scheme}`,
    };
  }

  // Restrict HTTP/HTTPS links strictly to trusted LendLocal production and dev domains
  if (scheme === 'https' || scheme === 'http') {
    if (!isTrustedWebHost(parsed.hostname)) {
      return {
        isValid: false,
        rawUrl: trimmed,
        scheme,
        host: parsed.host,
        isPaymentClaim: false,
        error: `Untrusted domain for LendLocal web link: ${parsed.hostname}`,
      };
    }
  }

  // 1. Extract claimIntentId from query parameters
  const claimIntentIdParam =
    parsed.searchParams.get('claimIntentId') ||
    parsed.searchParams.get('intentId') ||
    parsed.searchParams.get('paymentId');

  let claimIntentId: string | undefined;
  if (claimIntentIdParam) {
    const cleanIntentId = claimIntentIdParam.trim();
    if (!MONGO_ID_REGEX.test(cleanIntentId)) {
      return {
        isValid: false,
        rawUrl: trimmed,
        scheme,
        claimIntentId: cleanIntentId,
        isPaymentClaim: true,
        error: 'Invalid payment claim intent ID format',
      };
    }
    claimIntentId = cleanIntentId;
  }

  // 2. Extract groupId from query parameters or path segments
  let groupIdParam =
    parsed.searchParams.get('groupId') ||
    parsed.searchParams.get('id');

  if (!groupIdParam) {
    // Check path segments (e.g. lendlocal://group/<id> or https://domain/group/<id>)
    const segments = [parsed.host, ...parsed.pathname.split('/')].filter(Boolean);
    const groupIdx = segments.findIndex((s) => s.toLowerCase() === 'group');
    if (groupIdx !== -1 && segments[groupIdx + 1]) {
      groupIdParam = segments[groupIdx + 1];
    }
  }

  let groupId: string | undefined;
  if (groupIdParam) {
    const cleanGroupId = groupIdParam.trim();
    if (!MONGO_ID_REGEX.test(cleanGroupId)) {
      return {
        isValid: false,
        rawUrl: trimmed,
        scheme,
        groupId: cleanGroupId,
        isPaymentClaim: Boolean(claimIntentId),
        error: 'Invalid group ID format',
      };
    }
    groupId = cleanGroupId;
  }

  return {
    isValid: true,
    rawUrl: trimmed,
    scheme,
    host: parsed.host,
    path: parsed.pathname,
    groupId,
    claimIntentId,
    isPaymentClaim: Boolean(claimIntentId),
  };
}

/**
 * Creates a duplicate link suppression guard with a sliding time window.
 * Protects against startup cold-start race conditions and double-emitted URL events.
 */
export function createDuplicateGuard(windowMs = 3000) {
  let lastUrl: string | null = null;
  let lastTimestamp = 0;

  return {
    isDuplicate(url: string): boolean {
      const now = Date.now();
      if (lastUrl === url && now - lastTimestamp < windowMs) {
        return true;
      }
      lastUrl = url;
      lastTimestamp = now;
      return false;
    },
    reset(): void {
      lastUrl = null;
      lastTimestamp = 0;
    },
  };
}

/**
 * In-memory pending deep link store for logged-out users.
 * Never persists payment intent data to disk or unencrypted storage.
 */
let pendingLinkInMemory: ParsedDeepLink | null = null;

export const pendingDeepLinkStore = {
  set(link: ParsedDeepLink): void {
    pendingLinkInMemory = link;
  },
  get(): ParsedDeepLink | null {
    return pendingLinkInMemory;
  },
  clear(): void {
    pendingLinkInMemory = null;
  },
};

export interface GroupSummaryRef {
  id: string;
  name?: string;
}

export interface IntentItemRef {
  intentId: string;
  groupId: string;
  status: string;
  amount?: number;
}

export interface ResolveGroupResult {
  groupId?: string;
  intent?: IntentItemRef;
  error?: string;
}

/**
 * Safely resolves the groupId for a payment claim when the URL omitted it.
 * Queries user's authorized groups and active intents without guessing or bypassing auth.
 */
export async function resolveGroupForIntent(
  claimIntentId: string,
  fetchUserGroups: () => Promise<GroupSummaryRef[]>,
  fetchActiveIntents: (groupId: string) => Promise<IntentItemRef[]>
): Promise<ResolveGroupResult> {
  if (!MONGO_ID_REGEX.test(claimIntentId)) {
    return { error: 'Invalid payment claim intent ID format' };
  }

  try {
    const groups = await fetchUserGroups();
    if (!groups || groups.length === 0) {
      return { error: 'No groups found for the current account.' };
    }

    // Check each group's active intents for the matching intentId
    for (const group of groups) {
      try {
        const intents = await fetchActiveIntents(group.id);
        const match = intents.find((i) => i.intentId === claimIntentId);
        if (match) {
          return {
            groupId: group.id,
            intent: match,
          };
        }
      } catch (_err) {
        // Individual group failure doesn't abort resolution across other groups
      }
    }

    return {
      error: 'Payment claim was not found in any of your active groups, or has already been resolved.',
    };
  } catch (err: any) {
    return {
      error: err?.message || 'Failed to check authorized groups for payment claim',
    };
  }
}
