/**
 * LendLocal Native Dashboard UPI Profile Loading & Hydration Test Suite
 *
 * Direct Production Tests:
 * - Real Express route handlers for POST /register, POST /login, and GET /me
 *   from backend/routes/auth.js, asserting response payload contract parity and upiId inclusion.
 *
 * Production Logic & Lifecycle Simulation Tests:
 * - AuthContext login profile hydration flow via GET /api/auth/me.
 * - Profile hydration failure fallback handling and safe retry paths.
 * - Registration profile hydration flow.
 * - updateUpiId reliable SecureStore persistence (awaited outside state updater) and storage error resilience.
 * - refreshUser concurrency deduplication, stale state protection, and 401 handling.
 * - Dashboard UPI row presentation logic distinguishing null (unconfigured) from undefined (unknown) and in-flight refresh.
 */

const assert = require('assert');

// Ensure JWT secret is set for tests
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_12345';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

console.log('--- Starting LendLocal Dashboard UPI Profile Loading Test Suite ---');

// ============================================================================
// 1. DIRECT PRODUCTION BACKEND ROUTE CONTRACT TESTS (backend/routes/auth.js)
// ============================================================================
console.log('\n1. Testing backend/routes/auth.js response contracts...');

const authRouter = require('./backend/routes/auth.js');
const User = require('./backend/models/User.js');

// Extract the actual Express handlers from the route stack
const registerLayer = authRouter.stack.find((l) => l.route && l.route.path === '/register');
const registerHandler = registerLayer.route.stack[registerLayer.route.stack.length - 1].handle;

const loginLayer = authRouter.stack.find((l) => l.route && l.route.path === '/login');
const loginHandler = loginLayer.route.stack[loginLayer.route.stack.length - 1].handle;

const meLayer = authRouter.stack.find((l) => l.route && l.route.path === '/me');
const meHandler = meLayer.route.stack[meLayer.route.stack.length - 1].handle;

async function runDirectBackendRouteTests() {
  // Save original User methods to restore after tests
  const origFindOne = User.findOne;
  const origCreate = User.create;

  try {
    // 1a. Test POST /login with user having saved UPI ID
    User.findOne = () => ({
      select: () => Promise.resolve({
        _id: 'user_123',
        name: 'Alice Cooper',
        email: 'alice@example.com',
        upiId: 'alice@okaxis',
        comparePassword: async () => true,
      }),
    });

    let loginResBody = null;
    let loginStatusCode = 200;
    const mockLoginRes = {
      status(code) { loginStatusCode = code; return this; },
      json(data) { loginResBody = data; return this; },
    };

    await loginHandler(
      { body: { email: 'alice@example.com', password: 'password123' } },
      mockLoginRes
    );

    assert.strictEqual(loginStatusCode, 200);
    assert(loginResBody.token, 'Token must be present in login response');
    assert.deepStrictEqual(loginResBody.user, {
      id: 'user_123',
      name: 'Alice Cooper',
      email: 'alice@example.com',
      upiId: 'alice@okaxis',
      phoneNumber: null,
      phoneVerified: false,
    }, 'POST /login MUST include upiId in user object');

    // 1b. Test POST /login with user having NULL upiId
    User.findOne = () => ({
      select: () => Promise.resolve({
        _id: 'user_456',
        name: 'Bob Marley',
        email: 'bob@example.com',
        upiId: null,
        comparePassword: async () => true,
      }),
    });

    await loginHandler(
      { body: { email: 'bob@example.com', password: 'password123' } },
      mockLoginRes
    );

    assert.strictEqual(loginResBody.user.upiId, null, 'POST /login must return upiId: null when unconfigured');

    // 1c. Test POST /register with newly created user
    User.findOne = () => Promise.resolve(null);
    User.create = async (data) => ({
      _id: 'user_new',
      name: data.name,
      email: data.email,
      upiId: null,
    });

    let regResBody = null;
    let regStatusCode = 200;
    const mockRegRes = {
      status(code) { regStatusCode = code; return this; },
      json(data) { regResBody = data; return this; },
    };

    await registerHandler(
      { body: { name: 'Charlie', email: 'charlie@example.com', password: 'password123' } },
      mockRegRes
    );

    assert.strictEqual(regStatusCode, 201);
    assert(regResBody.token, 'Token must be present in register response');
    assert.deepStrictEqual(regResBody.user, {
      id: 'user_new',
      name: 'Charlie',
      email: 'charlie@example.com',
      upiId: null,
      phoneNumber: null,
      phoneVerified: false,
    }, 'POST /register MUST include upiId: null in user object');

    // 1d. Test GET /me contract parity
    let meResBody = null;
    const mockMeRes = {
      json(data) { meResBody = data; return this; },
    };

    await meHandler(
      { user: { _id: 'user_123', name: 'Alice Cooper', email: 'alice@example.com', upiId: 'alice@okaxis' } },
      mockMeRes
    );

    assert.deepStrictEqual(meResBody.user, {
      id: 'user_123',
      name: 'Alice Cooper',
      email: 'alice@example.com',
      upiId: 'alice@okaxis',
      phoneNumber: null,
      phoneVerified: false,
      phoneVerifiedAt: null,
    }, 'GET /me must match POST /login contract structure');

    console.log('✅ Real backend route handlers (register, login, me) contract parity verified.');
  } finally {
    User.findOne = origFindOne;
    User.create = origCreate;
  }
}

// ============================================================================
// 2. AUTHENTICATION PROFILE HYDRATION & RECOVERY TESTS (AuthContext logic)
// ============================================================================
console.log('\n2. Testing AuthContext profile hydration & recovery behavior...');

class MockAuthStore {
  constructor() {
    this.token = null;
    this.userData = null;
    this.storageFailures = false;
  }

  async saveAuthToken(t) {
    if (this.storageFailures) throw new Error('SecureStore write failed');
    this.token = t;
  }
  async getAuthToken() { return this.token; }
  async deleteAuthToken() { this.token = null; }

  async saveUserData(u) {
    if (this.storageFailures) throw new Error('SecureStore write failed');
    this.userData = JSON.parse(JSON.stringify(u));
  }
  async getUserData() { return this.userData ? JSON.parse(JSON.stringify(this.userData)) : null; }
  async deleteUserData() { this.userData = null; }

  async clearAllAuth() {
    await this.deleteAuthToken();
    await this.deleteUserData();
  }
}

function createAuthContextHarness(store, api) {
  let user = null;
  let token = null;
  let isLoading = true;
  let isRefreshingUser = false;
  const userRef = { current: null };
  const refreshingUserPromiseRef = { current: null };

  const setUser = (updater) => {
    if (typeof updater === 'function') {
      user = updater(user);
    } else {
      user = updater;
    }
    userRef.current = user;
  };

  const setToken = (t) => { token = t; };

  const initializeAuth = async () => {
    try {
      const storedToken = await store.getAuthToken();
      const cachedUser = await store.getUserData();

      if (storedToken) {
        setToken(storedToken);
        if (cachedUser) {
          setUser(cachedUser);
        }

        try {
          const { user: freshUser } = await api.getMe(storedToken);
          if (freshUser) {
            setUser(freshUser);
            await store.saveUserData(freshUser);
          }
        } catch (err) {
          if (err?.status === 401) {
            await store.clearAllAuth();
            setToken(null);
            setUser(null);
          } else {
            // Keep cached profile on non-401 error
          }
        }
      }
    } finally {
      isLoading = false;
    }
  };

  const login = async (email, password) => {
    const res = await api.login({ email, password });
    await store.saveAuthToken(res.token);
    setToken(res.token);

    let profile = res.user;
    try {
      const { user: freshUser } = await api.getMe(res.token);
      if (freshUser) {
        profile = freshUser;
      }
    } catch (hydrateErr) {
      // Post-login profile hydration fallback
    }

    await store.saveUserData(profile);
    setUser(profile);
  };

  const register = async (name, email, password) => {
    const res = await api.register({ name, email, password });
    await store.saveAuthToken(res.token);
    setToken(res.token);

    let profile = res.user;
    try {
      const { user: freshUser } = await api.getMe(res.token);
      if (freshUser) {
        profile = freshUser;
      }
    } catch (hydrateErr) {
      // Post-registration profile hydration fallback
    }

    await store.saveUserData(profile);
    setUser(profile);
  };

  const refreshUser = () => {
    if (refreshingUserPromiseRef.current) {
      return refreshingUserPromiseRef.current;
    }

    const promise = (async () => {
      try {
        const currentToken = await store.getAuthToken();
        if (!currentToken) return;

        isRefreshingUser = true;
        const { user: freshUser } = await api.getMe(currentToken);
        if (freshUser) {
          setUser(freshUser);
          await store.saveUserData(freshUser);
        }
      } catch (err) {
        if (err?.status === 401) {
          await store.clearAllAuth();
          setToken(null);
          setUser(null);
        }
      } finally {
        isRefreshingUser = false;
        refreshingUserPromiseRef.current = null;
      }
    })();

    refreshingUserPromiseRef.current = promise;
    return promise;
  };

  const updateUpiId = async (upiId) => {
    try {
      const res = await api.updateUpiId({ upiId });

      let updatedProfile = userRef.current
        ? { ...userRef.current, upiId: res.upiId }
        : null;

      setUser((prev) => {
        if (!prev) return null;
        const next = { ...prev, upiId: res.upiId };
        if (!updatedProfile) updatedProfile = next;
        return next;
      });

      if (updatedProfile) {
        userRef.current = updatedProfile;
        try {
          await store.saveUserData(updatedProfile);
        } catch (storageErr) {
          // Non-fatal, do not corrupt user session
        }
      }

      return res;
    } catch (err) {
      if (err?.status === 401) {
        await store.clearAllAuth();
        setToken(null);
        setUser(null);
      }
      throw err;
    }
  };

  return {
    getState: () => ({ user, token, isLoading, isRefreshingUser }),
    initializeAuth,
    login,
    register,
    refreshUser,
    updateUpiId,
  };
}

async function runAuthContextHydrationTests() {
  const store = new MockAuthStore();

  // 2a. Successful login hydrates complete profile with upiId
  const mockApiSuccess = {
    login: async () => ({
      token: 'jwt_token_123',
      user: { id: 'u1', name: 'Alice', email: 'alice@test.com', upiId: 'alice@okaxis' },
    }),
    getMe: async () => ({
      user: { id: 'u1', name: 'Alice', email: 'alice@test.com', upiId: 'alice@okaxis' },
    }),
  };

  const harness = createAuthContextHarness(store, mockApiSuccess);
  await harness.login('alice@test.com', 'pass');

  assert.strictEqual(harness.getState().user.upiId, 'alice@okaxis', 'Login must hydrate user with saved upiId');
  assert.strictEqual(store.userData.upiId, 'alice@okaxis', 'SecureStore must persist user with upiId');

  // 2b. Successful login when getMe temporarily fails falls back to login payload
  const mockApiGetMeFails = {
    login: async () => ({
      token: 'jwt_token_456',
      user: { id: 'u2', name: 'Bob', email: 'bob@test.com', upiId: 'bob@okhdfc' },
    }),
    getMe: async () => {
      const err = new Error('Network timeout on /auth/me');
      err.status = 504;
      throw err;
    },
  };

  const harness2 = createAuthContextHarness(new MockAuthStore(), mockApiGetMeFails);
  await harness2.login('bob@test.com', 'pass');

  assert.strictEqual(harness2.getState().user.upiId, 'bob@okhdfc', 'Fallback to login payload preserves upiId');

  // 2c. Successful registration hydrates complete profile
  const mockApiReg = {
    register: async () => ({
      token: 'jwt_token_789',
      user: { id: 'u3', name: 'Charlie', email: 'charlie@test.com', upiId: null },
    }),
    getMe: async () => ({
      user: { id: 'u3', name: 'Charlie', email: 'charlie@test.com', upiId: null },
    }),
  };

  const harness3 = createAuthContextHarness(new MockAuthStore(), mockApiReg);
  await harness3.register('Charlie', 'charlie@test.com', 'pass');

  assert.strictEqual(harness3.getState().user.upiId, null, 'Registration must store upiId: null');

  console.log('✅ AuthContext login & register profile hydration verified.');
}

// ============================================================================
// 3. RELIABLE UPI PERSISTENCE TESTS (AuthContext.updateUpiId)
// ============================================================================
console.log('\n3. Testing AuthContext updateUpiId persistence...');

async function runUpiPersistenceTests() {
  const store = new MockAuthStore();
  let persistenceAwaited = false;

  const mockApi = {
    updateUpiId: async ({ upiId }) => ({
      message: 'UPI ID saved successfully',
      upiId,
    }),
  };

  const harness = createAuthContextHarness(store, mockApi);

  // Set initial user in state
  await store.saveAuthToken('token_test');
  await store.saveUserData({ id: 'u1', name: 'Alice', email: 'a@b.com', upiId: null });
  await harness.initializeAuth();

  // Test updating UPI ID
  const res = await harness.updateUpiId('newalice@bank');

  assert.strictEqual(res.upiId, 'newalice@bank');
  assert.strictEqual(harness.getState().user.upiId, 'newalice@bank', 'In-memory state must update immediately');
  assert.strictEqual(store.userData.upiId, 'newalice@bank', 'SecureStore must be updated with new UPI ID');

  // Test clearing UPI ID
  const clearRes = await harness.updateUpiId(null);
  assert.strictEqual(clearRes.upiId, null);
  assert.strictEqual(harness.getState().user.upiId, null);
  assert.strictEqual(store.userData.upiId, null, 'SecureStore must be updated with null when cleared');

  // Test storage failure does not corrupt in-memory session or reject updateUpiId
  store.storageFailures = true;
  const resilientRes = await harness.updateUpiId('resilient@bank');
  assert.strictEqual(resilientRes.upiId, 'resilient@bank');
  assert.strictEqual(harness.getState().user.upiId, 'resilient@bank', 'In-memory state preserved despite storage error');
  assert(harness.getState().token, 'Session token must not be wiped out by storage error');

  console.log('✅ Reliable updateUpiId persistence and error resilience verified.');
}

// ============================================================================
// 4. DASHBOARD FOCUS REFRESH & CONCURRENCY DEDUPLICATION TESTS
// ============================================================================
console.log('\n4. Testing dashboard focus refresh & concurrency deduplication...');

async function runFocusRefreshTests() {
  const store = new MockAuthStore();
  await store.saveAuthToken('token_focus');
  await store.saveUserData({ id: 'u1', name: 'Alice', email: 'a@b.com', upiId: 'initial@bank' });

  let meCallCount = 0;
  let meResolver = null;

  const mockApi = {
    getMe: async () => {
      meCallCount++;
      return new Promise((resolve) => {
        meResolver = () => resolve({
          user: { id: 'u1', name: 'Alice', email: 'a@b.com', upiId: 'refreshed@bank' },
        });
      });
    },
  };

  const harness = createAuthContextHarness(store, mockApi);

  // 4a. Trigger refreshUser multiple times concurrently (focus effect + manual pull-to-refresh)
  const p1 = harness.refreshUser();
  const p2 = harness.refreshUser();
  const p3 = harness.refreshUser();

  assert.strictEqual(p1, p2, 'Concurrent calls to refreshUser must return the identical in-flight promise');
  assert.strictEqual(p2, p3, 'Concurrent calls to refreshUser must return the identical in-flight promise');

  // Yield to event loop so getAuthToken finishes and getMe is invoked
  await new Promise((resolve) => setImmediate(resolve));

  assert.strictEqual(meCallCount, 1, 'Only one HTTP request must be made for concurrent refreshUser calls');
  assert.strictEqual(harness.getState().isRefreshingUser, true, 'isRefreshingUser must be true while in-flight');

  // Resolve the in-flight request
  meResolver();
  await Promise.all([p1, p2, p3]);

  assert.strictEqual(harness.getState().isRefreshingUser, false, 'isRefreshingUser must be false after completion');
  assert.strictEqual(harness.getState().user.upiId, 'refreshed@bank', 'User state must be updated to refreshed value');
  assert.strictEqual(store.userData.upiId, 'refreshed@bank', 'SecureStore must be updated to refreshed value');

  // 4b. 401 unauthorized handling
  const mockApi401 = {
    getMe: async () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      throw err;
    },
  };

  const harness401 = createAuthContextHarness(store, mockApi401);
  await harness401.refreshUser();

  assert.strictEqual(harness401.getState().token, null, '401 on refreshUser must clear token');
  assert.strictEqual(harness401.getState().user, null, '401 on refreshUser must clear user');
  assert.strictEqual(store.token, null, '401 on refreshUser must clear SecureStore token');

  console.log('✅ Dashboard focus refresh request deduplication and 401 handling verified.');
}

// ============================================================================
// 5. DASHBOARD UI PRESENTATION LOGIC TESTS (HomeScreen & UpiConfigModal)
// ============================================================================
console.log('\n5. Testing Dashboard UPI presentation logic...');

function computeDashboardUpiPresentation(user, isRefreshingUser) {
  const upiId = user?.upiId;

  const displayValue = upiId
    ? upiId
    : upiId === null
    ? 'Not configured (tap to set)'
    : isRefreshingUser
    ? 'Checking status...'
    : 'Status unknown (tap to retry)';

  const buttonLabel = upiId
    ? 'Edit'
    : upiId === null
    ? '+ Set'
    : isRefreshingUser
    ? '...'
    : 'Retry';

  const accessibilityLabel = upiId
    ? `UPI ID: ${upiId}. Tap to edit.`
    : upiId === null
    ? 'UPI ID not set. Tap to configure.'
    : isRefreshingUser
    ? 'Checking UPI ID status.'
    : 'UPI ID status unknown. Tap to retry loading.';

  return { displayValue, buttonLabel, accessibilityLabel };
}

function computeModalStatusPresentation(user) {
  const upiId = user?.upiId;
  return upiId ? upiId : upiId === null ? 'Not configured' : 'Status unknown';
}

function runPresentationTests() {
  // Case A: User has verified saved UPI ID
  const userConfigured = { id: 'u1', name: 'Alice', upiId: 'alice@okaxis' };
  const presA = computeDashboardUpiPresentation(userConfigured, false);
  assert.strictEqual(presA.displayValue, 'alice@okaxis');
  assert.strictEqual(presA.buttonLabel, 'Edit');
  assert.strictEqual(computeModalStatusPresentation(userConfigured), 'alice@okaxis');

  // Case B: User has verified NO UPI ID (explicitly null)
  const userUnset = { id: 'u1', name: 'Alice', upiId: null };
  const presB = computeDashboardUpiPresentation(userUnset, false);
  assert.strictEqual(presB.displayValue, 'Not configured (tap to set)');
  assert.strictEqual(presB.buttonLabel, '+ Set');
  assert.strictEqual(computeModalStatusPresentation(userUnset), 'Not configured');

  // Case C: User has unknown UPI status (undefined, e.g. hydration failed) while idle
  const userUnknownIdle = { id: 'u1', name: 'Alice', upiId: undefined };
  const presC = computeDashboardUpiPresentation(userUnknownIdle, false);
  assert.strictEqual(presC.displayValue, 'Status unknown (tap to retry)');
  assert.strictEqual(presC.buttonLabel, 'Retry');
  assert.strictEqual(computeModalStatusPresentation(userUnknownIdle), 'Status unknown');

  // Case D: User has unknown UPI status while refresh is in-flight
  const presD = computeDashboardUpiPresentation(userUnknownIdle, true);
  assert.strictEqual(presD.displayValue, 'Checking status...');
  assert.strictEqual(presD.buttonLabel, '...');
  assert.strictEqual(presD.accessibilityLabel, 'Checking UPI ID status.');

  // Case E: User has verified UPI ID while background refresh is in-flight
  // Existing verified UPI ID must NOT be blanked out or replaced with "Checking"
  const presE = computeDashboardUpiPresentation(userConfigured, true);
  assert.strictEqual(presE.displayValue, 'alice@okaxis', 'Existing valid UPI ID must remain displayed while refreshing');
  assert.strictEqual(presE.buttonLabel, 'Edit');

  console.log('✅ Dashboard and modal UPI presentation rules verified across all states.');
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================
async function main() {
  await runDirectBackendRouteTests();
  await runAuthContextHydrationTests();
  await runUpiPersistenceTests();
  await runFocusRefreshTests();
  runPresentationTests();

  console.log('\n🎉 ALL Dashboard UPI Profile Loading & Hydration Tests Passed Successfully!');
}

main().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
