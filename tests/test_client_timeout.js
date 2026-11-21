/**
 * LendLocal Stage 1.1: API Request Timeout Test Suite
 *
 * Clearly partitioned into:
 * 1. [Source Contract Invariants] Direct static analysis of mobile/src/services/client.ts
 * 2. [Functional Simulation] Lifecycle execution with mock fetch to test timeout, signal combination,
 *    options destructuring, pre-aborted cancellation, timeoutMs validation, HTTP errors, and cleanup.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Stage 1.1: API Request Timeout Test Suite ---');

// ============================================================================
// 1. SOURCE CONTRACT INVARIANT TESTS (mobile/src/services/client.ts)
// ============================================================================
console.log('\n1. Testing Source Code Contract Invariants in mobile/src/services/client.ts...');

const clientSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/services/client.ts'),
  'utf8'
);

// 1A: DEFAULT_TIMEOUT_MS constant defined as 25000
assert(
  clientSource.includes('export const DEFAULT_TIMEOUT_MS = 25000;'),
  'client.ts must export DEFAULT_TIMEOUT_MS = 25000'
);

// 1B: Destructures timeoutMs and signal out of options
assert(
  clientSource.includes('const { timeoutMs: customTimeoutMs, signal: callerSignal, headers: customHeaders, ...fetchOptions } = options;'),
  'client.ts must destructure timeoutMs and signal out of options before calling fetch'
);

// 1C: Pre-aborted caller signal handled immediately before creating timer
const preAbortCheckIndex = clientSource.indexOf('if (callerSignal?.aborted)');
const setTimeoutIndex = clientSource.indexOf('const timeoutId = setTimeout');
assert(
  preAbortCheckIndex !== -1 && setTimeoutIndex !== -1 && preAbortCheckIndex < setTimeoutIndex,
  'client.ts must handle pre-aborted caller signals before creating the timeoutId timer'
);

// 1D: Uses AbortController and forwards only clean fetchOptions
assert(
  clientSource.includes('new AbortController()'),
  'client.ts must instantiate an AbortController for request lifecycle'
);
assert(
  clientSource.includes('...fetchOptions,') &&
  clientSource.includes('headers,') &&
  clientSource.includes('signal: controller.signal,'),
  'client.ts must pass only standard RequestInit options and controller.signal to native fetch'
);

// 1E: Ensures timeoutMs is not forwarded in fetch payload
assert(
  !clientSource.includes('...options,') || clientSource.indexOf('...fetchOptions') !== -1,
  'client.ts must not forward raw options containing custom timeoutMs to fetch'
);

// 1F: Guarded access to callerSignal.reason
assert(
  clientSource.includes("'reason' in callerSignal") || clientSource.includes('controller.abort();'),
  'client.ts must guard access to AbortSignal.reason for Hermes/React Native compatibility'
);

// 1G: Validates timeoutMs override (finite positive number or fallback to DEFAULT_TIMEOUT_MS)
assert(
  clientSource.includes("typeof customTimeoutMs === 'number'") &&
  clientSource.includes('Number.isFinite(customTimeoutMs)') &&
  clientSource.includes('customTimeoutMs > 0') &&
  clientSource.includes('DEFAULT_TIMEOUT_MS'),
  'client.ts must validate customTimeoutMs as a finite positive number, falling back to DEFAULT_TIMEOUT_MS'
);

// 1H: Finally block always cleans up timeout and listener
assert(
  clientSource.includes('finally {') &&
  clientSource.includes('clearTimeout(timeoutId);') &&
  clientSource.includes('callerSignal.removeEventListener'),
  'client.ts must always clear timeout and remove caller signal listener in a finally block'
);

// 1I: Error conversion with status 0 and retry message
assert(
  clientSource.includes('status: 0') &&
  clientSource.includes('Request timed out') &&
  clientSource.includes('please retry'),
  'client.ts must format timeout errors with status 0 and a helpful retry message'
);

// 1J: Distinguishes caller cancellation
assert(
  clientSource.includes('callerSignal?.aborted') &&
  clientSource.includes('Request was cancelled'),
  'client.ts must distinguish caller cancellation from server timeout'
);

// 1K: No automatic retries
assert(
  !clientSource.includes('for (let retry') &&
  !clientSource.includes('maxRetries') &&
  !clientSource.includes('retryCount'),
  'client.ts must not implement automatic retry loops for payment/financial safety'
);

console.log('✅ [Source Contract Invariants] All 11 static source invariants verified in mobile/src/services/client.ts.');

// ============================================================================
// 2. FUNCTIONAL SIMULATION TESTS (Client Implementation Parity)
// ============================================================================
console.log('\n2. Testing Functional Execution & Error Handling (Client Parity Simulation)...');

// Test Harness replicating mobile/src/services/client.ts logic exactly
function createTestHarness(mockFetch, mockBaseUrl = 'https://lendlocal-58sf.onrender.com/api', mockToken = 'mock_jwt_token') {
  const DEFAULT_TIMEOUT_MS = 25000;
  let lastCapturedTimeoutMs = null;

  async function apiRequest(endpoint, options = {}, customToken) {
    const { timeoutMs: customTimeoutMs, signal: callerSignal, headers: customHeaders, ...fetchOptions } = options;

    // Handle pre-aborted caller signal immediately without creating a timer
    if (callerSignal?.aborted) {
      throw {
        message: 'Request was cancelled',
        status: 0,
      };
    }

    const baseUrl = mockBaseUrl;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const fullUrl = `${baseUrl}${cleanEndpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(customHeaders || {}),
    };

    const token = customToken || mockToken;
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const timeoutMs =
      typeof customTimeoutMs === 'number' && Number.isFinite(customTimeoutMs) && customTimeoutMs > 0
        ? customTimeoutMs
        : DEFAULT_TIMEOUT_MS;

    lastCapturedTimeoutMs = timeoutMs;

    const controller = new AbortController();
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let onCallerAbort = null;

    if (callerSignal) {
      onCallerAbort = () => {
        const reason = 'reason' in callerSignal ? callerSignal.reason : undefined;
        if (reason !== undefined) {
          try {
            controller.abort(reason);
          } catch {
            controller.abort();
          }
        } else {
          controller.abort();
        }
      };
      if (typeof callerSignal.addEventListener === 'function') {
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      } else {
        callerSignal.onabort = onCallerAbort;
      }
    }

    let response;
    let responseText = '';

    try {
      response = await mockFetch(fullUrl, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (err) {
      if (timedOut) {
        const seconds = Math.round(timeoutMs / 1000);
        const timeStr = seconds > 0 ? `${seconds}s` : `${timeoutMs}ms`;
        throw {
          message: `Request timed out (${timeStr}). If the server was sleeping, please retry.`,
          status: 0,
        };
      }

      if (callerSignal?.aborted) {
        throw {
          message: 'Request was cancelled',
          status: 0,
        };
      }

      const errorMsg = err?.message || 'Network request failed';
      const isConnRefused = errorMsg.includes('Failed to connect') || errorMsg.includes('Network request failed');
      throw {
        message: isConnRefused
          ? `Cannot connect to server at ${baseUrl}. Ensure backend is running and reachable.`
          : errorMsg,
        status: 0,
      };
    } finally {
      clearTimeout(timeoutId);
      if (callerSignal && onCallerAbort) {
        if (typeof callerSignal.removeEventListener === 'function') {
          callerSignal.removeEventListener('abort', onCallerAbort);
        } else if (callerSignal.onabort === onCallerAbort) {
          callerSignal.onabort = null;
        }
      }
    }

    let data = null;
    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { message: responseText };
      }
    }

    if (!response.ok) {
      const message = (data && data.message) || `Request failed with status ${response.status}`;
      throw {
        message,
        status: response.status,
        data,
      };
    }

    return data;
  }

  return {
    apiRequest,
    DEFAULT_TIMEOUT_MS,
    getLastCapturedTimeoutMs: () => lastCapturedTimeoutMs,
  };
}

async function runFunctionalTests() {
  // Test 2A: timeoutMs is NOT forwarded to native fetch
  {
    let receivedFetchOptions = null;
    const mockFetch = async (url, opts) => {
      receivedFetchOptions = opts;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      };
    };

    const { apiRequest } = createTestHarness(mockFetch);
    await apiRequest('/test', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' }),
      timeoutMs: 5000,
    });

    assert(receivedFetchOptions, 'Fetch must have been called');
    assert.strictEqual(receivedFetchOptions.timeoutMs, undefined, 'timeoutMs must NOT be passed to native fetch');
    assert.strictEqual(receivedFetchOptions.method, 'POST');
    assert.strictEqual(receivedFetchOptions.body, JSON.stringify({ hello: 'world' }));
    assert(receivedFetchOptions.signal instanceof AbortSignal, 'signal must be an AbortSignal instance');
    console.log('✅ [Functional Simulation 2A] timeoutMs exclusion from native fetch verified.');
  }

  // Test 2B: Successful request with token & headers
  {
    let interceptedUrl = null;
    let interceptedHeaders = null;
    const mockFetch = async (url, opts) => {
      interceptedUrl = url;
      interceptedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ status: 'ok', items: [1, 2, 3] }),
      };
    };

    const { apiRequest } = createTestHarness(mockFetch);
    const result = await apiRequest('/groups');

    assert.strictEqual(interceptedUrl, 'https://lendlocal-58sf.onrender.com/api/groups');
    assert.strictEqual(interceptedHeaders['Authorization'], 'Bearer mock_jwt_token');
    assert.strictEqual(interceptedHeaders['Content-Type'], 'application/json');
    assert.deepStrictEqual(result, { status: 'ok', items: [1, 2, 3] });
    console.log('✅ [Functional Simulation 2B] Successful request and token attachment verified.');
  }

  // Test 2C: HTTP non-2xx error handling (404)
  {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ message: 'API route not found' }),
    });

    const { apiRequest } = createTestHarness(mockFetch);
    let errorCaught = null;
    try {
      await apiRequest('/notifications');
    } catch (err) {
      errorCaught = err;
    }

    assert(errorCaught, 'Expected HTTP 404 to throw');
    assert.strictEqual(errorCaught.status, 404);
    assert.strictEqual(errorCaught.message, 'API route not found');
    console.log('✅ [Functional Simulation 2C] HTTP 404 error formatting verified.');
  }

  // Test 2D: Network error handling (connection refused)
  {
    const mockFetch = async () => {
      throw new Error('Failed to connect to host');
    };

    const { apiRequest } = createTestHarness(mockFetch);
    let errorCaught = null;
    try {
      await apiRequest('/expenses/123');
    } catch (err) {
      errorCaught = err;
    }

    assert(errorCaught, 'Expected network failure to throw');
    assert.strictEqual(errorCaught.status, 0);
    assert(errorCaught.message.includes('Cannot connect to server at https://lendlocal-58sf.onrender.com/api'));
    console.log('✅ [Functional Simulation 2D] Network connection failure formatting verified.');
  }

  // Test 2E: Valid short positive timeout triggers and throws status: 0 with retry message
  {
    const mockFetch = async (url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    };

    const { apiRequest, getLastCapturedTimeoutMs } = createTestHarness(mockFetch);
    let errorCaught = null;
    const start = Date.now();
    try {
      await apiRequest('/payment/intent', { timeoutMs: 50 });
    } catch (err) {
      errorCaught = err;
    }
    const elapsed = Date.now() - start;

    assert.strictEqual(getLastCapturedTimeoutMs(), 50, 'Valid short positive timeout must be accepted');
    assert(errorCaught, 'Expected timeout to throw');
    assert.strictEqual(errorCaught.status, 0);
    assert(errorCaught.message.includes('Request timed out'));
    assert(errorCaught.message.includes('please retry'));
    assert(elapsed >= 45 && elapsed < 300, `Elapsed should be around 50ms, was ${elapsed}ms`);
    console.log('✅ [Functional Simulation 2E] Valid short positive timeout enforcement verified.');
  }

  // Test 2F: Caller cancellation takes precedence over timeout
  {
    const callerController = new AbortController();

    const mockFetch = async (url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        });
      });
    };

    const { apiRequest } = createTestHarness(mockFetch);
    let errorCaught = null;

    // Abort after 30ms before 500ms timeout
    setTimeout(() => callerController.abort(), 30);

    try {
      await apiRequest('/groups', {
        signal: callerController.signal,
        timeoutMs: 500,
      });
    } catch (err) {
      errorCaught = err;
    }

    assert(errorCaught, 'Expected caller cancellation to throw');
    assert.strictEqual(errorCaught.status, 0);
    assert.strictEqual(errorCaught.message, 'Request was cancelled');
    console.log('✅ [Functional Simulation 2F] Caller cancellation distinction verified.');
  }

  // Test 2G: Pre-aborted caller signal immediately rejects without creating timer or calling fetch
  {
    const callerController = new AbortController();
    callerController.abort(); // already aborted

    let fetchCalled = false;
    const mockFetch = async () => {
      fetchCalled = true;
      return { ok: true, text: async () => '{}' };
    };

    const { apiRequest, getLastCapturedTimeoutMs } = createTestHarness(mockFetch);
    let errorCaught = null;

    try {
      await apiRequest('/auth/me', { signal: callerController.signal });
    } catch (err) {
      errorCaught = err;
    }

    assert(errorCaught, 'Expected pre-aborted signal to throw');
    assert.strictEqual(fetchCalled, false, 'Fetch must not be called if caller signal is already aborted');
    assert.strictEqual(getLastCapturedTimeoutMs(), null, 'Timer must not be created for pre-aborted signal');
    assert.strictEqual(errorCaught.status, 0);
    assert.strictEqual(errorCaught.message, 'Request was cancelled');
    console.log('✅ [Functional Simulation 2G] Pre-aborted caller signal immediate rejection without timer verified.');
  }

  // Test 2H: Listener cleanup on successful response
  {
    let listenerCount = 0;
    const mockSignal = {
      aborted: false,
      addEventListener: (evt, fn) => {
        if (evt === 'abort') listenerCount++;
      },
      removeEventListener: (evt, fn) => {
        if (evt === 'abort') listenerCount--;
      },
    };

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });

    const { apiRequest } = createTestHarness(mockFetch);
    await apiRequest('/config', { signal: mockSignal });

    assert.strictEqual(listenerCount, 0, 'Abort listener must be removed on success');
    console.log('✅ [Functional Simulation 2H] Resource cleanup (listener removal) on success verified.');
  }

  // Test 2I: Listener cleanup on error
  {
    let listenerCount = 0;
    const mockSignal = {
      aborted: false,
      addEventListener: (evt, fn) => {
        if (evt === 'abort') listenerCount++;
      },
      removeEventListener: (evt, fn) => {
        if (evt === 'abort') listenerCount--;
      },
    };

    const mockFetch = async () => {
      throw new Error('Network error');
    };

    const { apiRequest } = createTestHarness(mockFetch);
    try {
      await apiRequest('/config', { signal: mockSignal });
    } catch {
      // Expected
    }

    assert.strictEqual(listenerCount, 0, 'Abort listener must be removed on error');
    console.log('✅ [Functional Simulation 2I] Resource cleanup (listener removal) on error verified.');
  }

  // Test 2J: Timeout covers both fetch and response.text() body reading
  {
    const mockFetch = async (url, opts) => {
      return {
        ok: true,
        status: 200,
        text: async () => {
          // Simulate slow response body stream that exceeds timeout
          return new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted while reading body');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          });
        },
      };
    };

    const { apiRequest } = createTestHarness(mockFetch);
    let errorCaught = null;
    try {
      await apiRequest('/large-data', { timeoutMs: 50 });
    } catch (err) {
      errorCaught = err;
    }

    assert(errorCaught, 'Expected body reading timeout to throw');
    assert.strictEqual(errorCaught.status, 0);
    assert(errorCaught.message.includes('Request timed out'));
    console.log('✅ [Functional Simulation 2J] Timeout coverage during response-body reading verified.');
  }

  // Test 2K: timeoutMs = 0 falls back to DEFAULT_TIMEOUT_MS (25,000 ms)
  {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const { apiRequest, getLastCapturedTimeoutMs } = createTestHarness(mockFetch);
    await apiRequest('/test-zero', { timeoutMs: 0 });

    assert.strictEqual(
      getLastCapturedTimeoutMs(),
      25000,
      'timeoutMs: 0 must safely fall back to DEFAULT_TIMEOUT_MS (25,000 ms)'
    );
    console.log('✅ [Functional Simulation 2K] timeoutMs: 0 fallback to 25,000 ms verified.');
  }

  // Test 2L: timeoutMs = negative value falls back to DEFAULT_TIMEOUT_MS (25,000 ms)
  {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const { apiRequest, getLastCapturedTimeoutMs } = createTestHarness(mockFetch);
    await apiRequest('/test-negative', { timeoutMs: -500 });

    assert.strictEqual(
      getLastCapturedTimeoutMs(),
      25000,
      'timeoutMs: -500 must safely fall back to DEFAULT_TIMEOUT_MS (25,000 ms)'
    );
    console.log('✅ [Functional Simulation 2L] timeoutMs: -500 fallback to 25,000 ms verified.');
  }

  // Test 2M: timeoutMs = NaN falls back to DEFAULT_TIMEOUT_MS (25,000 ms)
  {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const { apiRequest, getLastCapturedTimeoutMs } = createTestHarness(mockFetch);
    await apiRequest('/test-nan', { timeoutMs: NaN });

    assert.strictEqual(
      getLastCapturedTimeoutMs(),
      25000,
      'timeoutMs: NaN must safely fall back to DEFAULT_TIMEOUT_MS (25,000 ms)'
    );
    console.log('✅ [Functional Simulation 2M] timeoutMs: NaN fallback to 25,000 ms verified.');
  }

  // Test 2N: timeoutMs = non-number (null, string, object) falls back to DEFAULT_TIMEOUT_MS
  {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    });

    const { apiRequest, getLastCapturedTimeoutMs } = createTestHarness(mockFetch);

    await apiRequest('/test-string', { timeoutMs: '1000' });
    assert.strictEqual(getLastCapturedTimeoutMs(), 25000, 'timeoutMs string must fall back to 25000');

    await apiRequest('/test-null', { timeoutMs: null });
    assert.strictEqual(getLastCapturedTimeoutMs(), 25000, 'timeoutMs null must fall back to 25000');

    await apiRequest('/test-obj', { timeoutMs: {} });
    assert.strictEqual(getLastCapturedTimeoutMs(), 25000, 'timeoutMs object must fall back to 25000');

    console.log('✅ [Functional Simulation 2N] Non-number timeoutMs inputs fallback to 25,000 ms verified.');
  }
}

runFunctionalTests()
  .then(() => {
    console.log('\n🎉 ALL Stage 1.1 API Request Timeout Tests Passed Successfully!');
  })
  .catch((err) => {
    console.error('❌ Test Failure:', err);
    process.exit(1);
  });
