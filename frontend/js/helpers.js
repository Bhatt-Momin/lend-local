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

// Export for tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseReturnUrl, createLoaderQueue };
}
