/**
 * test_stage1_2_session_lifecycle.js
 *
 * LendLocal Stage 1.2: Session Lifecycle Race & Invalidation Test Suite
 *
 * Partitioned into:
 * 1. [Source Contract Invariants]
 *    Direct static analysis of mobile/src/context/AuthContext.tsx and mobile/src/app/index.tsx
 *
 * 2. [Real Production Runtime Execution (AuthContext.tsx)]
 *    Transpiles and mounts the ACTUAL production `AuthContext.tsx` via React 19 (`react` &
 *    `react-dom/client`) from mobile/node_modules without adding external test dependencies.
 *    Executes the real React hooks lifecycle (`useState`, `useRef`, `useCallback`, `useEffect`),
 *    provisions `AuthProvider`, and tests asynchronous session isolation using controlled deferred promises:
 *    - Test 2A: User A refresh followed by logout -> resolve old request
 *    - Test 2B: User A refresh followed by User B login -> resolve old request
 *    - Test 2C: Stale HTTP 401 from User A arriving after User B logs in
 *    - Test 2D: Promise deduplication within session vs isolation across session
 *    - Test 2E: Boot initialization overlapping a newer login
 *    - Test 2F: Stale finally block in refreshUser not clearing a newer session's refreshing state
 *    - Test 2G: Stale updateUpiId response arriving after account switching
 *    - Test 2H: Logout cleanup starts -> User B logs in and saves credentials -> old cleanup finishes
 *    - Test 2I: Stale 401 cleanup in-flight -> User B logs in -> 401 cleanup finishes
 *    - Test 2J: Old saveAuthToken finishes after a newer login starts
 *    - Test 2K: Old saveUserData finishes after a newer login starts
 *    - Test 2L: updateUpiId 401 and error failure after switching accounts
 *    - Test 2M: Initialization returns late after logout
 *
 * 3. [Real Production Dashboard Runtime Execution (HomeScreen in index.tsx)]
 *    Mounts the ACTUAL production `HomeScreen` dashboard component from mobile/src/app/index.tsx
 *    in React 19 with real hooks (`useRef`, `useState`, `useEffect`, `useCallback`, `useFocusEffect`).
 *    Executes the actual production `fetchUnreadNotifications()` logic under controlled asynchronous races.
 *
 * 4. [Isolated Unit Simulation of Request Sequence Gating]
 *    Clearly labeled standalone algorithmic simulation verifying edge cases in monotonic request sequence gating.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Ensure Node environment provides minimal DOM globals required by React 19's ReactDOMClient
global.window = global;
global.window.dispatchEvent = () => true;
global.HTMLIFrameElement = class {};
global.HTMLElement = class {};
global.Element = class {};

console.log('--- Running LendLocal Stage 1.2: Session Lifecycle Race Test Suite ---');

// ============================================================================
// 1. SOURCE CONTRACT INVARIANT TESTS
// ============================================================================
console.log('\n1. Testing Source Code Contract Invariants in AuthContext.tsx & index.tsx...');

const authContextSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/context/AuthContext.tsx'),
  'utf8'
);

const indexSource = fs.readFileSync(
  path.join(__dirname, 'mobile/src/app/index.tsx'),
  'utf8'
);

// 1A: Monotonic session generation ref in AuthContext
assert(
  authContextSource.includes('const sessionEpochRef = React.useRef<number>(1);') ||
  authContextSource.includes('const sessionEpochRef = React.useRef<number>(0);'),
  'AuthContext must instantiate sessionEpochRef using useRef'
);

// 1B: advanceSessionEpoch definition and clearing
assert(
  authContextSource.includes('const advanceSessionEpoch = React.useCallback(') &&
  authContextSource.includes('sessionEpochRef.current += 1;') &&
  authContextSource.includes('refreshingUserPromiseRef.current = null;') &&
  authContextSource.includes('setIsRefreshingUser(false);'),
  'advanceSessionEpoch must advance sessionEpochRef, clear refreshingUserPromiseRef, and reset isRefreshingUser'
);

// 1C: advanceSessionEpoch invoked at start of login, register, logout
assert(
  authContextSource.includes('const login = React.useCallback(async') &&
  authContextSource.includes('const opEpoch = advanceSessionEpoch();'),
  'login must advance session epoch at start of operation'
);
assert(
  authContextSource.includes('const register = React.useCallback(async') &&
  authContextSource.includes('const opEpoch = advanceSessionEpoch();'),
  'register must advance session epoch at start of operation'
);
assert(
  authContextSource.includes('const logout = React.useCallback(async') &&
  authContextSource.includes('const logoutEpoch = advanceSessionEpoch();'),
  'logout must advance session epoch at start of operation'
);

// 1D: refreshUser captures epoch and validates after every await
assert(
  authContextSource.includes('const callEpoch = sessionEpochRef.current;') &&
  authContextSource.includes('if (sessionEpochRef.current !== callEpoch || !currentToken) return;') &&
  authContextSource.includes('if (sessionEpochRef.current !== callEpoch) return;'),
  'refreshUser must guard against session transitions after every await'
);

// 1E: refreshUser protects finally block
assert(
  authContextSource.includes('if (sessionEpochRef.current === callEpoch)') &&
  authContextSource.includes('setIsRefreshingUser(false);') &&
  authContextSource.includes('refreshingUserPromiseRef.current = null;'),
  'refreshUser finally block must only clear state if the session is still active'
);

// 1F: initializeAuth guarded against session transitions
assert(
  authContextSource.includes('const initEpoch = sessionEpochRef.current;') &&
  authContextSource.includes('if (!isMounted || sessionEpochRef.current !== initEpoch) return;'),
  'initializeAuth must validate sessionEpochRef before restoring tokens and profiles'
);

// 1G: updateUpiId guarded against stale session updates
assert(
  authContextSource.includes('const callEpoch = sessionEpochRef.current;') &&
  authContextSource.includes('if (sessionEpochRef.current !== callEpoch)'),
  'updateUpiId must validate sessionEpochRef before updating state and storage'
);

// 1H: index.tsx notification count session & request isolation
assert(
  indexSource.includes('const notificationsRequestIdRef = useRef<number>(0);') &&
  indexSource.includes('const prevUserIdRef = useRef<string | null>(user?.id ?? null);') &&
  indexSource.includes('setUnreadNotificationsCount(0);') &&
  indexSource.includes('currentRequestId === notificationsRequestIdRef.current') &&
  indexSource.includes('userRef.current?.id === currentUserId'),
  'index.tsx must reset notification count on account switch and validate request sequence and user ID'
);

// 1I: Explanatory comment around two-stage logout epoch validation
assert(
  authContextSource.includes('Two-stage epoch validation:') &&
  authContextSource.includes('Guard storage wipe') &&
  authContextSource.includes('Guard state wipe'),
  'AuthContext logout must include concise explanatory comments for two-stage epoch validation'
);

console.log('✅ [Source Contract Invariants] All static source invariants verified.');

// ============================================================================
// 2. REAL PRODUCTION RUNTIME EXECUTION (mobile/src/context/AuthContext.tsx)
// ============================================================================
console.log('\n2. Testing Real Production AuthContext.tsx Runtime Execution...');

// Load existing React 19, ReactDOMClient 19, and TypeScript compiler from mobile/node_modules
const React = require('./mobile/node_modules/react');
const ReactDOMClient = require('./mobile/node_modules/react-dom/client');
const ts = require('./mobile/node_modules/typescript');

function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockContainer() {
  const doc = {
    defaultView: global,
    nodeType: 9,
    activeElement: null,
    createElement: (tag) => ({
      nodeType: 1,
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      style: {},
      setAttribute: () => {},
      removeAttribute: () => {},
      appendChild: () => {},
      removeChild: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      ownerDocument: doc,
    }),
    createTextNode: (text) => ({ nodeType: 3, nodeValue: text }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return {
    nodeType: 1,
    tagName: 'DIV',
    nodeName: 'DIV',
    ownerDocument: doc,
    addEventListener: () => {},
    removeEventListener: () => {},
    appendChild: () => {},
    removeChild: () => {},
    insertBefore: () => {},
  };
}

// Transpile the actual production TypeScript file mobile/src/context/AuthContext.tsx
const transpiledAuthContext = ts.transpileModule(authContextSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
  },
}).outputText;

/**
 * Instantiates the real AuthProvider and hooks it into React 19's runtime container.
 * Injects mock storage and API boundaries while executing the real production context logic.
 */
function mountRealAuthProvider({ initialStore = {}, mockApi = {}, mockStorageHooks = {} }) {
  const store = {
    token: initialStore.token ?? null,
    user: initialStore.user ? JSON.parse(JSON.stringify(initialStore.user)) : null,
    pushToken: 'fcm_tok_real_test',
  };

  const mockSecureStore = {
    getAuthToken: async () => store.token,
    getUserData: async () => (store.user ? JSON.parse(JSON.stringify(store.user)) : null),
    saveAuthToken: async (t) => {
      if (mockStorageHooks.onSaveAuthToken) await mockStorageHooks.onSaveAuthToken(t);
      store.token = t;
    },
    saveUserData: async (u) => {
      if (mockStorageHooks.onSaveUserData) await mockStorageHooks.onSaveUserData(u);
      store.user = JSON.parse(JSON.stringify(u));
    },
    deleteAuthToken: async () => { store.token = null; },
    deleteUserData: async () => { store.user = null; },
    getRegisteredPushToken: async () => store.pushToken,
    clearAllAuth: async () => {
      if (mockStorageHooks.onClearAllAuth) await mockStorageHooks.onClearAllAuth();
      store.token = null;
      store.user = null;
    },
  };

  const customRequire = (id) => {
    if (id === 'react') return React;
    if (id === 'expo-splash-screen') return { hideAsync: async () => {} };
    if (id === '../services/api') return { authApi: mockApi };
    if (id === '../services/config') return { getActiveApiBaseUrl: async () => 'https://lendlocal.test/api' };
    if (id === '../services/secureStore') return mockSecureStore;
    if (id === '../services/pushNotifications') return { resetPushRegistrationState: () => {} };
    return require(id);
  };

  const mod = { exports: {} };
  const factory = new Function('require', 'module', 'exports', 'React', transpiledAuthContext);
  factory(customRequire, mod, mod.exports, React);

  const { AuthProvider, useAuth } = mod.exports;

  let latestContext = null;
  function TestConsumer() {
    latestContext = useAuth();
    return null;
  }

  const container = createMockContainer();
  global.document = container.ownerDocument;
  const root = ReactDOMClient.createRoot(container);

  root.render(React.createElement(AuthProvider, null, React.createElement(TestConsumer)));

  return {
    getContext: () => latestContext,
    getStore: () => store,
    unmount: () => root.unmount(),
    flush: () => new Promise((resolve) => setTimeout(resolve, 50)),
  };
}

(async () => {
  // --------------------------------------------------------------------------
  // Test 2A: User A refresh followed by logout -> resolve old request
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2A: User A refresh -> logout -> resolve old request (Real AuthContext.tsx)...');
  const dRefresh2A = createDeferred();
  const api2A = {
    getMe: async (tok) => {
      if (tok === 'token_a') return dRefresh2A.promise;
      return { user: { id: 'generic' } };
    },
    removeFcmToken: async () => ({ message: 'revoked' }),
  };

  const harness2A = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com' },
    },
    mockApi: api2A,
  });

  await harness2A.flush();
  assert.strictEqual(harness2A.getContext().user?.id, 'user_a', 'Initial user must be User A');

  // 1. User A starts refreshUser() -> in-flight
  const pRefresh2A = harness2A.getContext().refreshUser();
  await harness2A.flush();
  assert.strictEqual(harness2A.getContext().isRefreshingUser, true, 'isRefreshingUser must be true');

  // 2. User A logs out before request resolves
  await harness2A.getContext().logout();
  await harness2A.flush();

  assert.strictEqual(harness2A.getContext().user, null, 'User must be null after logout');
  assert.strictEqual(harness2A.getContext().token, null, 'Token must be null after logout');
  assert.strictEqual(harness2A.getStore().user, null, 'SecureStore user must be null after logout');

  // 3. Late refresh resolves with User A's profile
  dRefresh2A.resolve({ user: { id: 'user_a', name: 'User A Stale Name', email: 'a@test.com' } });
  await pRefresh2A;
  await harness2A.flush();

  // 4. Observable assert: User A was NOT restored in React state or SecureStore
  assert.strictEqual(harness2A.getContext().user, null, 'Stale refresh must NOT restore user state in real AuthContext');
  assert.strictEqual(harness2A.getStore().user, null, 'Stale refresh must NOT write user data to SecureStore');
  assert.strictEqual(harness2A.getContext().isRefreshingUser, false, 'isRefreshingUser must be false');
  harness2A.unmount();
  console.log('✅ [Test 2A Passed] Real AuthContext: User A refresh -> logout -> resolve does not re-pollute state.');

  // --------------------------------------------------------------------------
  // Test 2B: User A refresh followed by User B login -> resolve old request
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2B: User A refresh -> User B login -> resolve old request (Real AuthContext.tsx)...');
  const dRefresh2B = createDeferred();
  const api2B = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B', email: 'b@test.com' } }),
    getMe: async (tok) => {
      if (tok === 'token_a') return dRefresh2B.promise;
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com' } };
      return { user: { id: 'generic' } };
    },
    removeFcmToken: async () => ({ message: 'ok' }),
  };

  const harness2B = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com' },
    },
    mockApi: api2B,
  });

  await harness2B.flush();
  assert.strictEqual(harness2B.getContext().user?.id, 'user_a');

  // 1. User A starts refresh
  const pRefresh2B = harness2B.getContext().refreshUser();

  // 2. User B logs in before User A refresh completes
  await harness2B.getContext().login('b@test.com', 'password');
  await harness2B.flush();

  assert.strictEqual(harness2B.getContext().user?.id, 'user_b', 'User B must be active in real AuthContext');
  assert.strictEqual(harness2B.getContext().token, 'token_b', 'User B token must be active in real AuthContext');
  assert.strictEqual(harness2B.getStore().user?.id, 'user_b', 'User B must be stored in SecureStore');

  // 3. User A stale refresh completes
  dRefresh2B.resolve({ user: { id: 'user_a', name: 'User A Stale Name', email: 'a@test.com' } });
  await pRefresh2B;
  await harness2B.flush();

  // 4. Observable assert: User B remains active and untouched
  assert.strictEqual(harness2B.getContext().user?.id, 'user_b', 'User A late response must NOT overwrite User B in real AuthContext');
  assert.strictEqual(harness2B.getContext().user?.name, 'User B', 'User B profile details must be preserved');
  assert.strictEqual(harness2B.getStore().user?.id, 'user_b', 'User B must NOT be overwritten in SecureStore');
  assert.strictEqual(harness2B.getStore().token, 'token_b', 'User B token must remain in SecureStore');
  harness2B.unmount();
  console.log('✅ [Test 2B Passed] Real AuthContext: User A refresh -> User B login keeps User B session intact.');

  // --------------------------------------------------------------------------
  // Test 2C: Stale HTTP 401 from User A arriving after User B logs in
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2C: Late 401 from User A arriving after User B logs in (Real AuthContext.tsx)...');
  const dRefresh2C = createDeferred();
  const api2C = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B', email: 'b@test.com' } }),
    getMe: async (tok) => {
      if (tok === 'token_a') return dRefresh2C.promise;
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com' } };
      return { user: { id: 'generic' } };
    },
    removeFcmToken: async () => ({ message: 'ok' }),
  };

  const harness2C = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A' },
    },
    mockApi: api2C,
  });

  await harness2C.flush();

  // 1. User A starts refresh
  const pRefresh2C = harness2C.getContext().refreshUser();

  // 2. User B logs in
  await harness2C.getContext().login('b@test.com', 'pwd');
  await harness2C.flush();
  assert.strictEqual(harness2C.getContext().token, 'token_b');

  // 3. User A stale refresh rejects with HTTP 401
  dRefresh2C.reject({ status: 401, message: 'Unauthorized session' });
  await pRefresh2C;
  await harness2C.flush();

  // 4. Observable assert: User B was NOT logged out
  assert.strictEqual(harness2C.getContext().user?.id, 'user_b', 'User B must NOT be logged out by User A stale 401 in real AuthContext');
  assert.strictEqual(harness2C.getContext().token, 'token_b', 'User B token must remain active in real AuthContext');
  assert.strictEqual(harness2C.getStore().token, 'token_b', 'User B token must remain in SecureStore');
  assert.strictEqual(harness2C.getStore().user?.id, 'user_b', 'User B profile must remain in SecureStore');
  harness2C.unmount();
  console.log('✅ [Test 2C Passed] Real AuthContext: Stale 401 from previous session does not log out active user.');

  // --------------------------------------------------------------------------
  // Test 2D: Overlapping refresh calls within same session vs across session transition
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2D: Promise deduplication within session vs isolation across session (Real AuthContext.tsx)...');
  const dRefresh2D_A = createDeferred();
  const dRefresh2D_B = createDeferred();

  let isLoggingIn2D = false;
  const api2D = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B' } }),
    getMe: async (tok) => {
      if (isLoggingIn2D) return { user: { id: 'user_b', name: 'User B' } };
      if (tok === 'token_a') return dRefresh2D_A.promise;
      if (tok === 'token_b') return dRefresh2D_B.promise;
      return { user: { id: 'generic' } };
    },
    removeFcmToken: async () => ({ message: 'ok' }),
  };

  const harness2D = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A' },
    },
    mockApi: api2D,
  });

  await harness2D.flush();

  // User A calls refreshUser twice concurrently in the same session
  const pA1 = harness2D.getContext().refreshUser();
  const pA2 = harness2D.getContext().refreshUser();
  assert.strictEqual(pA1, pA2, 'Concurrent refreshUser calls in same session must return identical deduplicated promise');

  // User B logs in
  isLoggingIn2D = true;
  await harness2D.getContext().login('b@test.com', 'pwd');
  isLoggingIn2D = false;
  await harness2D.flush();

  // User B calls refreshUser
  const pB1 = harness2D.getContext().refreshUser();
  assert.notStrictEqual(pA1, pB1, 'New session must NOT receive pending promise from previous session');

  // Resolve A, then B
  dRefresh2D_A.resolve({ user: { id: 'user_a', name: 'User A Stale' } });
  dRefresh2D_B.resolve({ user: { id: 'user_b', name: 'User B Refreshed' } });
  await Promise.all([pA1, pB1]);
  await harness2D.flush();

  assert.strictEqual(harness2D.getContext().user?.name, 'User B Refreshed', 'User B refreshed profile must be authoritative');
  harness2D.unmount();
  console.log('✅ [Test 2D Passed] Real AuthContext: Promise deduplication correctly isolates distinct sessions.');

  // --------------------------------------------------------------------------
  // Test 2E: Boot initialization overlapping a newer login
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2E: Boot initialization overlapping a newer login (Real AuthContext.tsx)...');
  const dInit2E = createDeferred();
  const api2E = {
    getMe: async (tok) => {
      if (tok === 'stored_token_a') return dInit2E.promise;
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B' } };
      return { user: { id: 'generic' } };
    },
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B' } }),
  };

  const harness2E = mountRealAuthProvider({
    initialStore: {
      token: 'stored_token_a',
      user: { id: 'user_a', name: 'User A Cached' },
    },
    mockApi: api2E,
  });

  // App boots: initialization is in-flight on dInit2E
  await new Promise((r) => setTimeout(r, 20));

  // User immediately logs in as User B before initializeAuth's getMe completes
  await harness2E.getContext().login('b@test.com', 'pwd');
  await harness2E.flush();
  assert.strictEqual(harness2E.getContext().user?.id, 'user_b');

  // Now initializeAuth's getMe resolves with User A
  dInit2E.resolve({ user: { id: 'user_a', name: 'User A Late Boot' } });
  await harness2E.flush();

  assert.strictEqual(harness2E.getContext().user?.id, 'user_b', 'User B must NOT be overwritten by superseded initializeAuth');
  assert.strictEqual(harness2E.getStore().user?.id, 'user_b', 'SecureStore must retain User B profile');
  harness2E.unmount();
  console.log('✅ [Test 2E Passed] Real AuthContext: Boot initialization does not overwrite newer login.');

  // --------------------------------------------------------------------------
  // Test 2F: Stale finally block in refreshUser not clearing a newer request's state
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2F: Stale finally block not clearing newer refreshing indicator (Real AuthContext.tsx)...');
  const dRefresh2F_A = createDeferred();
  const dRefresh2F_B = createDeferred();

  let isLoggingIn2F = false;
  const api2F = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b' } }),
    getMe: async (tok) => {
      if (isLoggingIn2F) return { user: { id: 'user_b' } };
      if (tok === 'token_a') return dRefresh2F_A.promise;
      if (tok === 'token_b') return dRefresh2F_B.promise;
      return { user: { id: 'generic' } };
    },
  };

  const harness2F = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a' },
    },
    mockApi: api2F,
  });

  await harness2F.flush();

  // User A starts refresh -> isRefreshingUser becomes true
  const pRefresh2F_A = harness2F.getContext().refreshUser();
  await harness2F.flush();
  assert.strictEqual(harness2F.getContext().isRefreshingUser, true);

  // User B logs in
  isLoggingIn2F = true;
  await harness2F.getContext().login('b@test.com', 'pwd');
  isLoggingIn2F = false;
  await harness2F.flush();

  // User B starts refresh -> isRefreshingUser is true for session 2
  const pRefresh2F_B = harness2F.getContext().refreshUser();
  await harness2F.flush();
  assert.strictEqual(harness2F.getContext().isRefreshingUser, true);

  // User A's stale request now completes -> User A's finally block runs!
  dRefresh2F_A.resolve({ user: { id: 'user_a' } });
  await pRefresh2F_A;
  await harness2F.flush();

  // CRITICAL: User A's finally block must NOT have set isRefreshingUser to false for User B!
  assert.strictEqual(
    harness2F.getContext().isRefreshingUser,
    true,
    'Stale finally block from User A must NOT reset isRefreshingUser for active User B'
  );

  // User B's request completes -> User B's finally block runs
  dRefresh2F_B.resolve({ user: { id: 'user_b' } });
  await pRefresh2F_B;
  await harness2F.flush();

  assert.strictEqual(
    harness2F.getContext().isRefreshingUser,
    false,
    'User B finally block resets isRefreshingUser once legitimate refresh completes'
  );
  harness2F.unmount();
  console.log('✅ [Test 2F Passed] Real AuthContext: Stale finally blocks do not clear newer session indicators.');

  // --------------------------------------------------------------------------
  // Test 2G: Stale updateUpiId response arriving after account switching (Task 1)
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2G: Stale updateUpiId response arriving after account switching (Real AuthContext.tsx)...');
  const dUpi2G = createDeferred();
  const api2G = {
    login: async () => ({
      token: 'token_b',
      user: { id: 'user_b', name: 'User B', email: 'b@test.com', upiId: 'userb@activebank' },
    }),
    getMe: async (tok) => {
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com', upiId: 'userb@activebank' } };
      return { user: { id: 'user_a', name: 'User A', email: 'a@test.com', upiId: 'usera@oldbank' } };
    },
    updateUpiId: async () => dUpi2G.promise,
  };

  const harness2G = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com', upiId: 'usera@oldbank' },
    },
    mockApi: api2G,
  });

  await harness2G.flush();
  assert.strictEqual(harness2G.getContext().user?.upiId, 'usera@oldbank', 'Initial UPI ID must be User A');

  // 1. User A starts updateUpiId request (held by deferred promise)
  const pUpi2G = harness2G.getContext().updateUpiId('usera@newbank');

  // 2. Switch active session to User B
  await harness2G.getContext().login('b@test.com', 'pwd');
  await harness2G.flush();
  assert.strictEqual(harness2G.getContext().user?.id, 'user_b');
  assert.strictEqual(harness2G.getContext().user?.upiId, 'userb@activebank');
  assert.strictEqual(harness2G.getStore().user?.upiId, 'userb@activebank');

  // 3. User A pending UPI update resolves
  dUpi2G.resolve({ message: 'UPI ID updated successfully', upiId: 'usera@newbank' });
  await pUpi2G;
  await harness2G.flush();

  // 4. Assert User B context profile and persisted profile remain unchanged
  assert.strictEqual(
    harness2G.getContext().user?.id,
    'user_b',
    'User B must remain active in real AuthContext'
  );
  assert.strictEqual(
    harness2G.getContext().user?.upiId,
    'userb@activebank',
    'User B UPI ID must NOT be overwritten by User A late update in real AuthContext'
  );
  assert.strictEqual(
    harness2G.getStore().user?.upiId,
    'userb@activebank',
    'SecureStore must NOT be overwritten with User A late UPI update'
  );
  harness2G.unmount();
  console.log('✅ [Test 2G Passed] Real AuthContext: Stale updateUpiId response does not overwrite active account.');

  // --------------------------------------------------------------------------
  // Test 2H: Logout cleanup starts -> User B logs in and saves credentials -> old cleanup finishes
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2H: Logout cleanup starts -> User B logs in -> old cleanup finishes (Real AuthContext.tsx)...');
  const dClear2H = createDeferred();
  let clearCount2H = 0;

  const api2H = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B', email: 'b@test.com' } }),
    getMe: async (tok) => {
      if (tok === 'token_a') return { user: { id: 'user_a', name: 'User A', email: 'a@test.com' } };
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com' } };
      return { user: { id: 'generic' } };
    },
    removeFcmToken: async () => ({ message: 'ok' }),
  };

  const harness2H = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com' },
    },
    mockApi: api2H,
    mockStorageHooks: {
      onClearAllAuth: async () => {
        clearCount2H += 1;
        await dClear2H.promise;
      },
    },
  });

  await harness2H.flush();
  assert.strictEqual(harness2H.getContext().user?.id, 'user_a');

  // 1. User A starts logout; clearAllAuth is held in-flight by dClear2H
  const pLogout2H = harness2H.getContext().logout();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(clearCount2H, 1, 'clearAllAuth must be in-flight');

  // 2. User B logs in while logout cleanup is in progress
  const pLogin2H = harness2H.getContext().login('b@test.com', 'pwd');
  await new Promise((r) => setTimeout(r, 20));

  // 3. Old logout cleanup finishes
  dClear2H.resolve();
  await pLogout2H;
  await pLogin2H;
  await harness2H.flush();

  // 4. Assert: User B credentials are saved in storage and active in React state
  assert.strictEqual(harness2H.getContext().user?.id, 'user_b', 'User B must be active in React state');
  assert.strictEqual(harness2H.getContext().token, 'token_b', 'User B token must be active in React state');
  assert.strictEqual(harness2H.getStore().user?.id, 'user_b', 'User B profile must be saved in SecureStore');
  assert.strictEqual(harness2H.getStore().token, 'token_b', 'User B token must be saved in SecureStore');
  harness2H.unmount();
  console.log('✅ [Test 2H Passed] Real AuthContext: Old logout cleanup does not destroy User B credentials or state.');

  // --------------------------------------------------------------------------
  // Test 2I: User A receives 401 -> User B logs in before old cleanup finishes
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2I: Stale 401 cleanup in-flight -> User B logs in -> 401 cleanup finishes (Real AuthContext.tsx)...');
  const dClear2I = createDeferred();
  let clearCount2I = 0;
  let should401_2I = false;

  const api2I = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B', email: 'b@test.com' } }),
    getMe: async (tok) => {
      if (tok === 'token_a') {
        if (should401_2I) throw { status: 401, message: 'Expired' };
        return { user: { id: 'user_a', name: 'User A', email: 'a@test.com' } };
      }
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com' } };
      return { user: { id: 'generic' } };
    },
  };

  const harness2I = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com' },
    },
    mockApi: api2I,
    mockStorageHooks: {
      onClearAllAuth: async () => {
        clearCount2I += 1;
        await dClear2I.promise;
      },
    },
  });

  await harness2I.flush();
  assert.strictEqual(harness2I.getContext().user?.id, 'user_a');

  // 1. User A starts refreshUser which throws 401, entering 401 clearAllAuth
  should401_2I = true;
  const pRefresh2I = harness2I.getContext().refreshUser();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(clearCount2I, 1, 'clearAllAuth must be in-flight due to 401');

  // 2. User B logs in while 401 cleanup is in progress
  const pLogin2I = harness2I.getContext().login('b@test.com', 'pwd');
  await new Promise((r) => setTimeout(r, 20));

  // 3. 401 cleanup finishes
  dClear2I.resolve();
  await pRefresh2I;
  await pLogin2I;
  await harness2I.flush();

  // 4. Assert: User B remains active and storage is intact
  assert.strictEqual(harness2I.getContext().user?.id, 'user_b', 'User B must remain active in React state');
  assert.strictEqual(harness2I.getContext().token, 'token_b', 'User B token must remain active in React state');
  assert.strictEqual(harness2I.getStore().user?.id, 'user_b', 'User B must be stored in SecureStore');
  assert.strictEqual(harness2I.getStore().token, 'token_b', 'User B token must be stored in SecureStore');
  harness2I.unmount();
  console.log('✅ [Test 2I Passed] Real AuthContext: 401 cleanup does not wipe newer login session.');

  // --------------------------------------------------------------------------
  // Test 2J: Old saveAuthToken finishes after a newer login starts
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2J: Old saveAuthToken finishes after newer login starts (Real AuthContext.tsx)...');
  const dSaveTokenA = createDeferred();
  let saveTokenACalled = false;

  const api2J = {
    login: async ({ email }) => {
      if (email === 'a@test.com') return { token: 'token_a', user: { id: 'user_a', name: 'User A' } };
      if (email === 'b@test.com') return { token: 'token_b', user: { id: 'user_b', name: 'User B' } };
      return { token: 'generic', user: { id: 'generic' } };
    },
    getMe: async (tok) => {
      if (tok === 'token_a') return { user: { id: 'user_a', name: 'User A' } };
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B' } };
      return { user: { id: 'generic' } };
    },
  };

  const harness2J = mountRealAuthProvider({
    initialStore: {},
    mockApi: api2J,
    mockStorageHooks: {
      onSaveAuthToken: async (t) => {
        if (t === 'token_a') {
          saveTokenACalled = true;
          await dSaveTokenA.promise;
        }
      },
    },
  });

  await harness2J.flush();

  // 1. User A starts login; saveAuthToken is held in-flight
  const pLoginA = harness2J.getContext().login('a@test.com', 'pwd');
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(saveTokenACalled, true, 'User A saveAuthToken must be in-flight');

  // 2. User B logs in while User A saveAuthToken is pending
  const pLoginB = harness2J.getContext().login('b@test.com', 'pwd');
  await new Promise((r) => setTimeout(r, 20));

  // 3. User A saveAuthToken finishes
  dSaveTokenA.resolve();
  await pLoginA;
  await pLoginB;
  await harness2J.flush();

  // 4. Assert: User B is active in React state and SecureStore; token is token_b
  assert.strictEqual(harness2J.getContext().user?.id, 'user_b', 'User B must be active in React state');
  assert.strictEqual(harness2J.getContext().token, 'token_b', 'User B token must be active in React state');
  assert.strictEqual(harness2J.getStore().token, 'token_b', 'SecureStore token must be token_b');
  assert.strictEqual(harness2J.getStore().user?.id, 'user_b', 'SecureStore user must be user_b');
  harness2J.unmount();
  console.log('✅ [Test 2J Passed] Real AuthContext: Old saveAuthToken does not overwrite newer login.');

  // --------------------------------------------------------------------------
  // Test 2K: Old saveUserData finishes after a newer login starts
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2K: Old saveUserData finishes after newer login starts (Real AuthContext.tsx)...');
  const dSaveUserA = createDeferred();
  let saveUserACalled = false;
  let interceptSaveUserData2K = false;

  const api2K = {
    login: async () => ({ token: 'token_b', user: { id: 'user_b', name: 'User B', email: 'b@test.com' } }),
    getMe: async (tok) => {
      if (tok === 'token_a') return { user: { id: 'user_a', name: 'User A Refreshed', email: 'a@test.com' } };
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com' } };
      return { user: { id: 'generic' } };
    },
  };

  const harness2K = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com' },
    },
    mockApi: api2K,
    mockStorageHooks: {
      onSaveUserData: async (u) => {
        if (interceptSaveUserData2K && u.id === 'user_a') {
          saveUserACalled = true;
          await dSaveUserA.promise;
        }
      },
    },
  });

  await harness2K.flush();
  assert.strictEqual(harness2K.getContext().user?.id, 'user_a');

  // 1. User A starts refreshUser; profile arrives and saveUserData is held in-flight
  interceptSaveUserData2K = true;
  const pRefreshK = harness2K.getContext().refreshUser();
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(saveUserACalled, true, 'User A saveUserData must be in-flight');

  // 2. User B logs in while User A saveUserData is pending
  const pLoginK = harness2K.getContext().login('b@test.com', 'pwd');
  await new Promise((r) => setTimeout(r, 20));

  // 3. User A saveUserData finishes
  dSaveUserA.resolve();
  await pRefreshK;
  await pLoginK;
  await harness2K.flush();

  // 4. Assert: User B profile remains in React state and SecureStore
  assert.strictEqual(harness2K.getContext().user?.id, 'user_b', 'User B must be active in React state');
  assert.strictEqual(harness2K.getContext().user?.name, 'User B', 'User B name must be preserved');
  assert.strictEqual(harness2K.getStore().user?.id, 'user_b', 'SecureStore must retain User B profile');
  assert.strictEqual(harness2K.getStore().token, 'token_b', 'SecureStore must retain User B token');
  harness2K.unmount();
  console.log('✅ [Test 2K Passed] Real AuthContext: Old saveUserData does not overwrite newer login profile.');

  // --------------------------------------------------------------------------
  // Test 2L: updateUpiId fails after switching accounts
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2L: updateUpiId 401 and error failure after switching accounts (Real AuthContext.tsx)...');
  const dUpi401 = createDeferred();

  const api2L = {
    login: async () => ({
      token: 'token_b',
      user: { id: 'user_b', name: 'User B', email: 'b@test.com', upiId: 'userb@bank' },
    }),
    getMe: async (tok) => {
      if (tok === 'token_b') return { user: { id: 'user_b', name: 'User B', email: 'b@test.com', upiId: 'userb@bank' } };
      return { user: { id: 'user_a', name: 'User A', email: 'a@test.com', upiId: 'usera@bank' } };
    },
    updateUpiId: async () => dUpi401.promise,
  };

  const harness2L = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A', email: 'a@test.com', upiId: 'usera@bank' },
    },
    mockApi: api2L,
  });

  await harness2L.flush();
  assert.strictEqual(harness2L.getContext().user?.id, 'user_a');

  // 1. User A starts updateUpiId; held on dUpi401
  let updateErr = null;
  const pUpiL = harness2L.getContext().updateUpiId('usera@newbank').catch((e) => { updateErr = e; });

  // 2. User B logs in
  await harness2L.getContext().login('b@test.com', 'pwd');
  await harness2L.flush();
  assert.strictEqual(harness2L.getContext().user?.id, 'user_b');

  // 3. User A updateUpiId rejects with 401
  dUpi401.reject({ status: 401, message: 'Unauthorized session' });
  await pUpiL;
  await harness2L.flush();

  // 4. Assert: User B is NOT logged out; credentials and profile are preserved
  assert.strictEqual(updateErr?.status, 401, 'updateUpiId error must be caught');
  assert.strictEqual(harness2L.getContext().user?.id, 'user_b', 'User B must NOT be logged out by User A 401');
  assert.strictEqual(harness2L.getContext().token, 'token_b', 'User B token must remain active');
  assert.strictEqual(harness2L.getStore().user?.id, 'user_b', 'SecureStore user must remain User B');
  assert.strictEqual(harness2L.getStore().token, 'token_b', 'SecureStore token must remain User B');
  harness2L.unmount();
  console.log('✅ [Test 2L Passed] Real AuthContext: updateUpiId 401 after account switch does not log out active user.');

  // --------------------------------------------------------------------------
  // Test 2M: Initialization returns late after logout
  // --------------------------------------------------------------------------
  console.log('\nTesting Test 2M: Initialization returns late after logout (Real AuthContext.tsx)...');
  const dInitMe2M = createDeferred();

  const api2M = {
    getMe: async (tok) => {
      if (tok === 'token_a') return dInitMe2M.promise;
      return { user: { id: 'generic' } };
    },
    removeFcmToken: async () => ({ message: 'ok' }),
  };

  const harness2M = mountRealAuthProvider({
    initialStore: {
      token: 'token_a',
      user: { id: 'user_a', name: 'User A Cached' },
    },
    mockApi: api2M,
  });

  // App boots; stored credentials restored to state while getMe is in flight
  await new Promise((r) => setTimeout(r, 20));

  // User logs out before getMe resolves
  await harness2M.getContext().logout();
  await harness2M.flush();
  assert.strictEqual(harness2M.getContext().user, null, 'User must be null after logout');
  assert.strictEqual(harness2M.getStore().token, null, 'Store token must be null after logout');

  // Now boot getMe resolves
  dInitMe2M.resolve({ user: { id: 'user_a', name: 'User A Late Boot Profile' } });
  await harness2M.flush();

  // Assert: User remains logged out; credentials not resurrected
  assert.strictEqual(harness2M.getContext().user, null, 'Late initialization must NOT restore user state');
  assert.strictEqual(harness2M.getContext().token, null, 'Late initialization must NOT restore token state');
  assert.strictEqual(harness2M.getStore().user, null, 'SecureStore must NOT restore user data');
  assert.strictEqual(harness2M.getStore().token, null, 'SecureStore must NOT restore token');
  harness2M.unmount();
  console.log('✅ [Test 2M Passed] Real AuthContext: Late initialization does not resurrect logged out session.');

  // ============================================================================
  // 3. REAL PRODUCTION DASHBOARD RUNTIME EXECUTION (HomeScreen in index.tsx)
  // ============================================================================
  console.log('\n3. Testing Real Production Dashboard Runtime Execution (HomeScreen in index.tsx)...');

  const transpiledIndex = ts.transpileModule(indexSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;

  let activeDashboardAuth = {
    user: { id: 'user_a', name: 'User A', email: 'a@test.com' },
    isLoading: false,
    isRefreshingUser: false,
    logout: async () => {},
    refreshUser: async () => {},
  };

  let renderedBellBadgeCount = null;
  const ThemedTextStub = ({ style, children }) => {
    // styles.bellBadgeText uses fontSize: 10
    if (style && style.fontSize === 10) {
      renderedBellBadgeCount = children;
    }
    return React.createElement('span', null, children);
  };

  const dummyStub = ({ children }) => React.createElement('div', null, children);

  const dDashboardNotifA = createDeferred();
  const dDashboardNotifB = createDeferred();

  const mockDashboardNotifApi = {
    list: async () => {
      if (activeDashboardAuth.user?.id === 'user_a') {
        return dDashboardNotifA.promise;
      }
      if (activeDashboardAuth.user?.id === 'user_b') {
        return dDashboardNotifB.promise;
      }
      return { notifications: [], unreadCount: 0 };
    },
  };

  let triggerDashboardFocusEffect = null;
  const customIndexRequire = (id) => {
    if (id === 'react') return React;
    if (id.endsWith('.png')) return 'mock-icon.png';
    if (id === 'expo-router') return {
      useRouter: () => ({ push: () => {}, replace: () => {} }),
      useFocusEffect: (cb) => {
        triggerDashboardFocusEffect = cb;
        React.useEffect(cb, []);
      },
    };
    if (id === 'react-native') return {
      View: dummyStub,
      TouchableOpacity: dummyStub,
      ScrollView: dummyStub,
      Image: dummyStub,
      ActivityIndicator: dummyStub,
      RefreshControl: dummyStub,
      StyleSheet: { create: (s) => s },
      Alert: { alert: () => {} },
    };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: dummyStub };
    if (id === '../components/GroupCard') return { GroupCard: dummyStub };
    if (id === '../components/NotificationInboxModal') return { NotificationInboxModal: dummyStub };
    if (id === '../components/ServerConfigModal') return { ServerConfigModal: dummyStub };
    if (id === '../components/SettingsModal') return { SettingsModal: dummyStub };
    if (id === '../components/UpiConfigModal') return { UpiConfigModal: dummyStub };
    if (id === '../components/themed-text') return { ThemedText: ThemedTextStub };
    if (id === '../components/themed-view') return { ThemedView: dummyStub };
    if (id === '../constants/theme') return {
      BottomTabInset: 0,
      Brand: { primary: '#fff', negative: '#f00' },
      MaxContentWidth: 600,
      Spacing: {},
      Surfaces: {},
    };
    if (id === '../context/AuthContext') return { useAuth: () => activeDashboardAuth };
    if (id === '../hooks/useGroups') return {
      useGroups: () => ({
        groups: [],
        isLoading: false,
        isRefreshing: false,
        error: null,
        refresh: async () => {},
        refreshOnFocus: async () => {},
      }),
    };
    if (id === '../services/notificationsApi') return { notificationsApi: mockDashboardNotifApi };
    if (id === '../utils/format') return { formatINR: (n) => '₹' + n };
    return require(id);
  };

  const indexMod = { exports: {} };
  new Function('require', 'module', 'exports', 'React', transpiledIndex)(customIndexRequire, indexMod, indexMod.exports, React);
  const HomeScreen = indexMod.exports.default;

  const dashboardContainer = createMockContainer();
  const dashboardRoot = ReactDOMClient.createRoot(dashboardContainer);

  let setDashboardAuthState = null;
  function DashboardHarness() {
    const [auth, setAuth] = React.useState(activeDashboardAuth);
    setDashboardAuthState = setAuth;
    activeDashboardAuth = auth;
    return React.createElement(HomeScreen);
  }

  dashboardRoot.render(React.createElement(DashboardHarness));
  await new Promise((r) => setTimeout(r, 60));

  // 1. Initial render with User A (in-flight notification fetch on dDashboardNotifA)
  assert.strictEqual(renderedBellBadgeCount, null, 'Initial bell badge count must be null/0');

  // 2. Switch active auth session to User B
  renderedBellBadgeCount = null;
  setDashboardAuthState({
    user: { id: 'user_b', name: 'User B', email: 'b@test.com' },
    isLoading: false,
    isRefreshingUser: false,
    logout: async () => {},
    refreshUser: async () => {},
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(renderedBellBadgeCount, null, 'Badge count must remain reset to 0/null upon switching to User B');

  // 3. User A stale notification request resolves with 15 unread notifications
  dDashboardNotifA.resolve({ notifications: [], unreadCount: 15 });
  await new Promise((r) => setTimeout(r, 60));

  // 4. Assert that the production HomeScreen did NOT display 15 for User B
  assert.strictEqual(
    renderedBellBadgeCount,
    null,
    'Stale 15 notifications from User A must NOT be displayed on User B dashboard'
  );

  // 5. User B fetches their notifications (resolving to 4)
  triggerDashboardFocusEffect();
  dDashboardNotifB.resolve({ notifications: [], unreadCount: 4 });
  await new Promise((r) => setTimeout(r, 60));

  assert.strictEqual(renderedBellBadgeCount, 4, 'User B must display their authoritative 4 unread count');

  // 6. Test sequence gating within same session: Request 1 held, Request 2 dispatches and resolves first
  const dSeq1 = createDeferred();
  const dSeq2 = createDeferred();
  let seqCallIndex = 0;
  mockDashboardNotifApi.list = async () => {
    seqCallIndex += 1;
    if (seqCallIndex === 1) return dSeq1.promise;
    if (seqCallIndex === 2) return dSeq2.promise;
    return { notifications: [], unreadCount: 0 };
  };

  // Trigger Request 1
  triggerDashboardFocusEffect();
  await new Promise((r) => setTimeout(r, 30));

  // Trigger Request 2 (supersedes Request 1)
  triggerDashboardFocusEffect();
  await new Promise((r) => setTimeout(r, 30));

  // Resolve Request 2 with 7 unread
  dSeq2.resolve({ notifications: [], unreadCount: 7 });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(renderedBellBadgeCount, 7, 'Request 2 count 7 must be rendered');

  // Resolve Request 1 late with 99 unread
  dSeq1.resolve({ notifications: [], unreadCount: 99 });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(renderedBellBadgeCount, 7, 'HomeScreen must NOT regress to stale Request 1 count 99');

  dashboardRoot.unmount();
  console.log('✅ [Section 3 Passed] Real production HomeScreen: Stale notification count is discarded across account transitions and request races.');

  // ============================================================================
  // 4. ISOLATED UNIT SIMULATION OF REQUEST SEQUENCE GATING
  // ============================================================================
  console.log('\n4. Testing Isolated Unit Simulation of Request Sequence Gating...');

  function createNotificationCountHarness() {
    let unreadNotificationsCount = 0;
    let currentUser = null;
    const notificationsRequestIdRef = { current: 0 };
    const prevUserIdRef = { current: null };
    const userRef = { current: null };

    const onUserChanged = (newUser) => {
      currentUser = newUser;
      userRef.current = newUser;
      const currentUserId = newUser ? newUser.id : null;
      if (prevUserIdRef.current !== currentUserId) {
        notificationsRequestIdRef.current += 1;
        unreadNotificationsCount = 0;
        prevUserIdRef.current = currentUserId;
      }
    };

    const fetchUnreadNotifications = async (api) => {
      const currentUserId = currentUser ? currentUser.id : null;
      if (!currentUserId) return;

      const currentRequestId = ++notificationsRequestIdRef.current;
      try {
        const res = await api.list({ limit: 1 });
        if (
          currentRequestId === notificationsRequestIdRef.current &&
          userRef.current &&
          userRef.current.id === currentUserId
        ) {
          unreadNotificationsCount = res.unreadCount || 0;
        }
      } catch (e) {}
    };

    return {
      getCount: () => unreadNotificationsCount,
      onUserChanged,
      fetchUnreadNotifications,
    };
  }

  const notifHarness = createNotificationCountHarness();
  const dSimNotif1 = createDeferred();
  const dSimNotif2 = createDeferred();

  notifHarness.onUserChanged({ id: 'user_a' });
  const notifP1 = notifHarness.fetchUnreadNotifications({ list: () => dSimNotif1.promise });

  notifHarness.onUserChanged(null);
  assert.strictEqual(notifHarness.getCount(), 0, 'Notification count must be reset to 0 immediately on logout');

  notifHarness.onUserChanged({ id: 'user_b' });
  assert.strictEqual(notifHarness.getCount(), 0, 'Notification count must remain 0 for new user');

  dSimNotif1.resolve({ unreadCount: 15 });
  await notifP1;

  assert.strictEqual(notifHarness.getCount(), 0, 'Stale 15 notifications from User A must NOT overwrite User B');

  const notifP2 = notifHarness.fetchUnreadNotifications({ list: () => dSimNotif2.promise });
  dSimNotif2.resolve({ unreadCount: 3 });
  await notifP2;

  assert.strictEqual(notifHarness.getCount(), 3, 'User B notification count must be 3');
  console.log('✅ [Section 4 Passed] Isolated simulation verifies request sequence gating.');

  console.log('\n🎉 ALL Stage 1.2 Session Lifecycle Real Runtime Tests Passed Successfully!');
})();
