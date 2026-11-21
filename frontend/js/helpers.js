function parseReturnUrl(nextUrl, origin) {
  let destination = '/dashboard.html';
  if (nextUrl) {
    try {
      const parsed = new URL(nextUrl, origin);
      if (parsed.origin === origin) {
        const allowedPages = ['/dashboard.html', '/group.html'];
        if (allowedPages.includes(parsed.pathname)) {
          destination = parsed.pathname + parsed.search + parsed.hash;
        }
      }
    } catch (e) {
      // Ignore invalid URLs
    }
  }
  return destination;
}

function createLoaderQueue(runLoadFn) {
  let activeLoad = null;
  let queuedLoad = null;

  function loadFn(force = false) {
    if (!force && activeLoad) return queuedLoad || activeLoad;
    
    if (activeLoad) {
      if (!queuedLoad) {
        queuedLoad = activeLoad.catch(() => {}).then(() => {
          activeLoad = _runLoad();
          queuedLoad = null;
          return activeLoad;
        });
      }
      return queuedLoad;
    }

    activeLoad = _runLoad();
    return activeLoad;
  }

  async function _runLoad() {
    try {
      return await runLoadFn();
    } finally {
      if (!queuedLoad) {
        activeLoad = null;
      }
    }
  }

  return {
    load: loadFn,
    getActiveLoad: () => activeLoad,
    getQueuedLoad: () => queuedLoad
  };
}

function isValidHttpsUrl(urlString) {
  if (typeof urlString !== 'string') return false;
  const trimmed = urlString.trim();
  if (!trimmed) return false;

  // Reject any backslashes (prevents /\evil.com open-redirect / protocol-relative bypasses)
  if (trimmed.includes('\\')) return false;

  // Root-relative path validation
  if (trimmed.startsWith('/')) {
    // Reject protocol-relative URLs (//evil.com)
    if (trimmed.startsWith('//')) return false;
    try {
      const base = (typeof window !== 'undefined' && window.location && window.location.origin)
        ? window.location.origin
        : 'https://lendlocal.local';
      const parsed = new URL(trimmed, base);
      // Validate that root-relative URL resolves to the same origin without credentials
      if (parsed.origin !== base) return false;
      if (parsed.username || parsed.password) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // Absolute HTTPS URL validation
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    // Reject URLs with embedded credentials (e.g. https://user:pass@host)
    if (parsed.username || parsed.password) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function normalizeAppVersion(version) {
  if (version === null || version === undefined) return '';
  const s = String(version).trim();
  if (!s) return '';
  // Strip leading 'v' or 'V' (single or multiple)
  const stripped = s.replace(/^v+/i, '').trim();
  // Validate semver / numeric version pattern
  if (/^[0-9]+(\.[0-9]+)*([A-Za-z0-9_.-]+)?$/.test(stripped)) {
    return stripped;
  }
  return '';
}

async function fetchAppVersion(options = {}) {
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 3000;
  const endpoint = options.endpoint || '/api/app-version';
  let controller = null;
  let timeoutId = null;

  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const fetchFn = options.fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn) {
      throw new Error('fetch is not available');
    }

    const res = await fetchFn(endpoint, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller ? controller.signal : undefined,
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }

    const data = await res.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid manifest JSON');
    }

    // Verify apkUrl is a secure HTTPS or root-relative URL
    if (data.apkUrl && !isValidHttpsUrl(data.apkUrl)) {
      throw new Error('Insecure or invalid apkUrl rejected');
    }

    // Sanitize releasesPageUrl if insecure
    if (data.releasesPageUrl && !isValidHttpsUrl(data.releasesPageUrl)) {
      data.releasesPageUrl = null;
    }

    // Normalize latestVersion
    if (data.latestVersion) {
      data.normalizedVersion = normalizeAppVersion(data.latestVersion);
    } else {
      data.normalizedVersion = '';
    }

    return data;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

// Export for tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseReturnUrl, createLoaderQueue, isValidHttpsUrl, normalizeAppVersion, fetchAppVersion };
}
