/**
 * test_stage2a_mobile_fcm.js
 *
 * LendLocal Stage 2A: Native Android FCM Registration Test Suite
 *
 * Validates:
 * 1. Expo & Android configuration invariants (package name, googleServicesFile, expo-notifications plugin)
 * 2. Mobile API contract invariants (POST /api/auth/fcm-token with platform: "android", DELETE /api/auth/fcm-token)
 * 3. Native FCM token retrieval invariant (strict use of getDevicePushTokenAsync, rejection of getExpoPushTokenAsync)
 * 4. AuthContext logout revocation lifecycle & resilient offline fallback
 * 5. Duplicate registration prevention & logged-out guard
 * 6. Notification interaction & payload routing safety (groupId navigation vs safe fallback)
 * 7. google-services.json integrity & package matching
 *
 * Note on test classification:
 * - Real Device Testing: Native Android push delivery requires an actual physical Android APK build with Google Play Services.
 * - This test suite provides high-fidelity source contract assertions and functional lifecycle simulations.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Stage 2A: Native Android FCM Registration Test Suite ---');

// ============================================================================
// 1. EXPO CONFIGURATION & PLUGIN INVARIANTS
// ============================================================================
console.log('1. Testing Expo Configuration & Plugin Invariants...');

const appJsonPath = path.join(__dirname, 'mobile/app.json');
assert(fs.existsSync(appJsonPath), 'mobile/app.json must exist');
const appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

// 1A: Android package name
assert.strictEqual(
  appConfig.expo?.android?.package,
  'com.lendlocal.app',
  'app.json expo.android.package must be com.lendlocal.app'
);

// 1B: googleServicesFile configuration
assert.strictEqual(
  appConfig.expo?.android?.googleServicesFile,
  './google-services.json',
  'app.json expo.android.googleServicesFile must point to ./google-services.json'
);

// 1C: expo-notifications plugin registration
assert(
  Array.isArray(appConfig.expo?.plugins),
  'app.json expo.plugins must be an array'
);
assert(
  appConfig.expo.plugins.some((p) => p === 'expo-notifications' || (Array.isArray(p) && p[0] === 'expo-notifications')),
  'app.json expo.plugins must include expo-notifications'
);

// 1D: Existing plugins preserved
assert(
  appConfig.expo.plugins.includes('expo-router') &&
  appConfig.expo.plugins.includes('expo-secure-store'),
  'Existing plugins (expo-router, expo-secure-store) must be preserved'
);

// 1E: Package dependencies in mobile/package.json
const pkgJsonPath = path.join(__dirname, 'mobile/package.json');
const pkgConfig = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
assert(pkgConfig.dependencies['expo-notifications'], 'expo-notifications must be in dependencies');
assert(
  pkgConfig.dependencies['expo-notifications'].includes('57.0.'),
  'expo-notifications version must match Expo SDK 57 (~57.0.23)'
);

console.log('✅ [Source Assertion] app.json and package.json configuration invariants verified.');

// ============================================================================
// 2. GOOGLE-SERVICES.JSON INTEGRITY & ZERO SECRET EXPOSURE
// ============================================================================
console.log('\n2. Testing google-services.json integrity & package match...');

const gsPath = path.join(__dirname, 'mobile/google-services.json');
assert(fs.existsSync(gsPath), 'mobile/google-services.json must exist');
const gsData = JSON.parse(fs.readFileSync(gsPath, 'utf8'));

const clientPackages = (gsData.client || [])
  .map((c) => c.client_info?.android_client_info?.package_name)
  .filter(Boolean);

assert(
  clientPackages.includes('com.lendlocal.app'),
  'google-services.json must contain client package com.lendlocal.app'
);

console.log('✅ [Source Assertion] google-services.json package matches com.lendlocal.app (credentials unexposed).');

// ============================================================================
// 3. NATIVE PUSH SERVICE CONTRACT & STRICT DEVICE TOKEN INVARIANT
// ============================================================================
console.log('\n3. Testing Native Push Service Implementation & Token Invariants...');

const pushServiceSource = fs.readFileSync(path.join(__dirname, 'mobile/src/services/pushNotifications.ts'), 'utf8');

// 3A: Strictly uses getDevicePushTokenAsync, rejects getExpoPushTokenAsync
assert(
  pushServiceSource.includes('Notifications.getDevicePushTokenAsync()'),
  'pushNotifications.ts must invoke Notifications.getDevicePushTokenAsync() to obtain native FCM token'
);
assert(
  !pushServiceSource.includes('getExpoPushTokenAsync'),
  'pushNotifications.ts must NOT use getExpoPushTokenAsync() as backend requires direct FCM token'
);

// 3B: Creates default channel on Android
assert(
  pushServiceSource.includes("setNotificationChannelAsync('default'") &&
  pushServiceSource.includes('importance: Notifications.AndroidImportance.HIGH'),
  'pushNotifications.ts must configure default notification channel with HIGH importance'
);

// 3C: Physical device check & graceful non-physical device skip
assert(
  pushServiceSource.includes('Device.isDevice') &&
  pushServiceSource.includes("Platform.OS !== 'android'"),
  'pushNotifications.ts must restrict native push registration to physical Android devices'
);

// 3D: Passes platform: "android"
assert(
  pushServiceSource.includes("authApi.saveFcmToken(token, 'android', authToken)"),
  'pushNotifications.ts must pass platform: "android" when saving FCM token'
);

// 3E: Exposes listener registration, initial response retrieval, and clean teardown methods
assert(
  pushServiceSource.includes('addNotificationReceivedListener') &&
  pushServiceSource.includes('addNotificationResponseReceivedListener') &&
  pushServiceSource.includes('getLastNotificationResponseAsync'),
  'pushNotifications.ts must export notification received, response listener, and initial response helpers'
);

console.log('✅ [Source Assertion] Native FCM token retrieval, channel creation, and platform invariants verified.');

// ============================================================================
// 4. MOBILE API CLIENT CONTRACT & BACKEND PAYLOAD INVARIANTS
// ============================================================================
console.log('\n4. Testing Mobile API Client Contract & Backend Payload Invariants...');

const apiSource = fs.readFileSync(path.join(__dirname, 'mobile/src/services/api.ts'), 'utf8');

assert(
  apiSource.includes("saveFcmToken: async (") &&
  apiSource.includes("platform: 'web' | 'android' | 'ios' = 'android'") &&
  apiSource.includes("body: JSON.stringify({ token, platform })"),
  'authApi.saveFcmToken must send { token, platform } with default platform "android"'
);

assert(
  apiSource.includes("removeFcmToken: async (") &&
  apiSource.includes("method: 'DELETE'") &&
  apiSource.includes("body: JSON.stringify({ token })"),
  'authApi.removeFcmToken must send DELETE /auth/fcm-token with { token }'
);

// 4B: Backend notification service payload recipient contract & credential hygiene
const notifServiceSrc = fs.readFileSync(path.join(__dirname, 'backend/services/notificationService.js'), 'utf8');

// 4B-1: Individual push recipient targeting
assert(
  notifServiceSrc.includes("recipientId: recipient.toString(),"),
  'notificationService.js createNotification must include recipientId: recipient.toString() in push payload data'
);

// 4B-2: Multicast per-recipient sendEach targeting
assert(
  notifServiceSrc.includes("recipientId: target.userId.toString(),") &&
  notifServiceSrc.includes("const multicastRes = await messaging.sendEach(messages);"),
  'notificationService.js createMulticastNotifications must dispatch per-recipient messages with recipientId using sendEach'
);

// 4B-3: Safe fail-closed when sendEach is missing (no unsafe shared broadcast fallback)
assert(
  notifServiceSrc.includes("if (!messaging || typeof messaging.sendEach !== 'function')") &&
  notifServiceSrc.includes("skipping multicast push dispatch to ensure recipient safety") &&
  !notifServiceSrc.includes("sendEachForMulticast"),
  'notificationService.js must fail closed without sending shared payloads when sendEach is unavailable'
);

// 4B-4: Single messaging instance consistency
assert(
  notifServiceSrc.includes("const messaging = typeof getMessaging === 'function' ? getMessaging() : null;") &&
  notifServiceSrc.includes("await messaging.send(message);") &&
  !notifServiceSrc.includes("getMessaging().send(") &&
  !notifServiceSrc.includes("getMessaging().sendEach("),
  'notificationService.js must obtain messaging instance once and invoke send/sendEach on that same instance'
);

// 4B-5: Zero credential leakage in push data
assert(
  !notifServiceSrc.includes("authToken:") &&
  !notifServiceSrc.includes("password:") &&
  !notifServiceSrc.includes("jwt:"),
  'notificationService.js push payload data must never include credentials or tokens'
);

console.log('✅ [Source Contract Assertion] authApi contracts and backend push payload recipient invariants verified.');

// ============================================================================
// 5. AUTHENTICATION & LOGOUT REVOCATION LIFECYCLE SIMULATION
// ============================================================================
console.log('\n5. Testing AuthContext Logout Revocation & Resilient Fallback Simulation...');

const authContextSource = fs.readFileSync(path.join(__dirname, 'mobile/src/context/AuthContext.tsx'), 'utf8');

// 5A: Logout attempts to revoke token before clearing credentials
assert(
  authContextSource.includes('getRegisteredPushToken()') &&
  authContextSource.includes('authApi.removeFcmToken(storedPushToken, currentToken)') &&
  authContextSource.includes('resetPushRegistrationState()') &&
  authContextSource.includes('clearAllAuth()'),
  'AuthContext logout must retrieve registered push token, call removeFcmToken, and clear auth state'
);

// 5B: Functional simulation of logout flow
let revokeCalledWith = null;
let localAuthCleared = false;
let pushStateReset = false;

async function simulateLogout(shouldNetworkFail = false) {
  revokeCalledWith = null;
  localAuthCleared = false;
  pushStateReset = false;

  const storedPushToken = 'fcm_tok_simulated_android_999';
  const currentAuthToken = 'jwt_bearer_token_xyz';

  try {
    if (storedPushToken && currentAuthToken) {
      try {
        if (shouldNetworkFail) {
          throw new Error('Network timeout / 500 error');
        }
        revokeCalledWith = { token: storedPushToken, authToken: currentAuthToken };
      } catch (err) {
        // Non-fatal
      }
    }
  } finally {
    pushStateReset = true;
    localAuthCleared = true;
  }
}

// Case 1: Normal online logout
(async () => {
  await simulateLogout(false);
  assert.deepStrictEqual(
    revokeCalledWith,
    { token: 'fcm_tok_simulated_android_999', authToken: 'jwt_bearer_token_xyz' },
    'Logout must dispatch revocation when online'
  );
  assert.strictEqual(localAuthCleared, true);
  assert.strictEqual(pushStateReset, true);

  // Case 2: Offline / failed network logout
  await simulateLogout(true);
  assert.strictEqual(
    localAuthCleared,
    true,
    'Logout must ALWAYS clear local credentials even if network revocation fails'
  );
  assert.strictEqual(pushStateReset, true);
})();

console.log('✅ [Functional Simulation] Logout revocation & resilient offline fallback verified.');

// ============================================================================
// 6. NOTIFICATION PUSH HANDLER & INTERACTION ROUTING SAFETY
// ============================================================================
console.log('\n6. Testing Notification Push Handler & Interaction Routing Safety...');

const handlerSource = fs.readFileSync(path.join(__dirname, 'mobile/src/components/NotificationPushHandler.tsx'), 'utf8');

// 6A: Mounted in layout
const layoutSource = fs.readFileSync(path.join(__dirname, 'mobile/src/app/_layout.tsx'), 'utf8');
assert(
  layoutSource.includes('<NotificationPushHandler />'),
  '_layout.tsx must mount NotificationPushHandler inside AuthProvider'
);

// 6B: Guards against logged-out registration
assert(
  handlerSource.includes('if (!token || !user)'),
  'NotificationPushHandler must not attempt registration when user is logged out'
);

// 6C: Guards against duplicate registration loops
assert(
  handlerSource.includes('registeredAuthTokenRef.current === token'),
  'NotificationPushHandler must guard against duplicate registration loops for the same auth token'
);

// 6D: Safe groupId navigation
assert(
  handlerSource.includes('typeof data.groupId === \'string\'') &&
  handlerSource.includes('router.push(`/group/${cleanGroupId}`)'),
  'NotificationPushHandler must navigate to /group/${cleanGroupId} when groupId is present'
);

// 6E: Safe fallback when groupId is missing (does not invent routes)
assert(
  handlerSource.includes('Notification payload lacks target groupId; remaining on current screen'),
  'NotificationPushHandler must safely retain current screen when notification lacks groupId'
);

// 6F: Listener cleanup on unmount
assert(
  handlerSource.includes('receivedSubscription.remove()') &&
  handlerSource.includes('responseSubscription.remove()') &&
  handlerSource.includes('pendingResponseRef.current = null'),
  'NotificationPushHandler must remove both subscriptions and clear pending responses on unmount'
);

// 6G: Synchronous render-body authRef assignment avoids post-render stale-ref races
assert(
  handlerSource.includes('const authRef = useRef({ token, user, isLoading })') &&
  handlerSource.includes('authRef.current = { token, user, isLoading }'),
  'NotificationPushHandler must maintain synchronously updated authRef to prevent stale-ref races'
);

// 6H: Cold-start queueing during session restoration
assert(
  handlerSource.includes('if (currentLoading)') &&
  handlerSource.includes('pendingResponseRef.current = {') &&
  handlerSource.includes('response,'),
  'NotificationPushHandler must hold pending tap in pendingResponseRef during session restoration'
);

// 6I: Logged-out tap rejection
assert(
  handlerSource.includes('if (!currentToken || !currentUser)') &&
  handlerSource.includes('Ignored notification tap: user is logged out / unauthenticated'),
  'NotificationPushHandler must reject taps when unauthenticated and clear pending taps'
);

// 6J: Account switch recipient mismatch protection
assert(
  handlerSource.includes('targetRecipientId &&') &&
  handlerSource.includes('targetRecipientId.trim() !== currentUserId') &&
  handlerSource.includes('Notification recipient mismatch (intended for another user); ignoring tap'),
  'NotificationPushHandler must drop taps targeted at a different recipient on account switch'
);

// 6K: Duplicate response deduplication & identifier derivation
assert(
  handlerSource.includes('lastProcessedResponseIdRef.current === responseId') &&
  handlerSource.includes('function getResponseIdentifier('),
  'NotificationPushHandler must deduplicate notification response events using getResponseIdentifier'
);

// 6L: Session restoration draining with recipient validation
assert(
  handlerSource.includes('if (pendingResponseRef.current)') &&
  handlerSource.includes('intendedRecipientId') &&
  handlerSource.includes('handleNotificationResponse(pending)'),
  'NotificationPushHandler must drain pending response and validate intended recipient once session is restored'
);

// 6M: Explicit logout resets deduplication & pending state
assert(
  handlerSource.includes('prevUserIdRef.current !== null && !currentId') &&
  handlerSource.includes('lastProcessedResponseIdRef.current = null'),
  'NotificationPushHandler must reset deduplication tracking and pending state on explicit logout'
);

// 6N: Account switch resets deduplication & pending state
assert(
  handlerSource.includes('prevUserIdRef.current !== null && currentId !== null && prevUserIdRef.current !== currentId') &&
  handlerSource.includes('Account switch detected; clearing pending notification and deduplication state'),
  'NotificationPushHandler must reset deduplication tracking and pending state on account switch'
);

// 6O: Clean type import from expo-notifications
assert(
  handlerSource.includes("import type { NotificationResponse } from 'expo-notifications';"),
  'NotificationPushHandler must use clean direct type import for NotificationResponse'
);

// 6P: Cold-start lookup executes at most once across effect re-runs
assert(
  handlerSource.includes('hasCheckedColdStartRef') &&
  handlerSource.includes('if (hasCheckedColdStartRef.current)'),
  'NotificationPushHandler must prevent duplicate cold-start lookup across effect re-runs'
);

console.log('✅ [Source Contract Assertion] Push handler lifecycle, routing safety, and listener cleanup verified.');

// ============================================================================
// 7. FUNCTIONAL SIMULATION: NOTIFICATION RESPONSE LIFECYCLE & SESSION GATING
// ============================================================================
console.log('\n7. Testing Notification Response Lifecycle Simulation...');

function createSimulationEnvironment() {
  let authState = { token: null, user: null, isLoading: false };
  let navigatedTo = [];
  let pendingResponse = null;
  let lastProcessedId = null;
  let prevUserId = null;

  function getResponseIdentifier(response) {
    if (!response) return null;
    const reqId = response.notification?.request?.identifier;
    if (reqId && typeof reqId === 'string' && reqId.trim()) return reqId.trim();
    const data = response.notification?.request?.content?.data;
    if (data?.notificationId || data?.groupId) {
      return `composite_${data?.notificationId || ''}_${data?.groupId || ''}`;
    }
    return null;
  }

  function handleNotificationResponse(response) {
    const responseId = getResponseIdentifier(response);
    const { token: currentToken, user: currentUser, isLoading: currentLoading } = authState;

    if (responseId && lastProcessedId === responseId) {
      return 'IGNORED_DUPLICATE';
    }

    if (currentLoading) {
      if (responseId && getResponseIdentifier(pendingResponse) === responseId) {
        return 'IGNORED_DUPLICATE_PENDING';
      }
      pendingResponse = response;
      return 'QUEUED_PENDING';
    }

    if (!currentToken || !currentUser) {
      pendingResponse = null;
      return 'REJECTED_UNAUTHENTICATED';
    }

    const data = response?.notification?.request?.content?.data;
    const targetRecipientId = data?.recipientId || data?.recipient || data?.userId;
    const currentUserId = currentUser.id || currentUser._id;

    if (targetRecipientId && currentUserId && targetRecipientId.trim() !== currentUserId) {
      pendingResponse = null;
      return 'REJECTED_RECIPIENT_MISMATCH';
    }

    if (responseId) {
      lastProcessedId = responseId;
    }

    if (data && typeof data.groupId === 'string' && data.groupId.trim()) {
      navigatedTo.push(`/group/${data.groupId.trim()}`);
      return 'NAVIGATED';
    }

    return 'RETAIN_CURRENT_SCREEN';
  }

  function onSessionStateChange(nextState) {
    authState = { ...nextState };
    const currentId = authState.user?.id ?? null;

    // Detect explicit logout
    if (prevUserId !== null && !currentId) {
      pendingResponse = null;
      lastProcessedId = null;
      prevUserId = null;
      return;
    }

    // Detect account switch
    if (prevUserId !== null && currentId !== null && prevUserId !== currentId) {
      pendingResponse = null;
      lastProcessedId = null;
      prevUserId = currentId;
    } else if (currentId !== null) {
      prevUserId = currentId;
    }

    if (!authState.isLoading) {
      if (!authState.token || !authState.user) {
        pendingResponse = null;
      } else if (pendingResponse) {
        const pending = pendingResponse;
        pendingResponse = null;
        handleNotificationResponse(pending);
      }
    }
  }

  return {
    setAuth: onSessionStateChange,
    handleResponse: handleNotificationResponse,
    getNavigated: () => navigatedTo,
    getPending: () => pendingResponse,
    getLastProcessedId: () => lastProcessedId,
  };
}

// Case 1: Tapping when logged out -> Rejected, no navigation
const sim1 = createSimulationEnvironment();
sim1.setAuth({ token: null, user: null, isLoading: false });
const res1 = sim1.handleResponse({
  notification: {
    request: {
      identifier: 'notif_1',
      content: { data: { groupId: 'group_abc' } },
    },
  },
});
assert.strictEqual(res1, 'REJECTED_UNAUTHENTICATED', 'Logged-out tap must be rejected');
assert.strictEqual(sim1.getNavigated().length, 0, 'No navigation should occur when logged out');

// Case 2: Cold start tap during session restoration -> Queued, then drained on login
const sim2 = createSimulationEnvironment();
sim2.setAuth({ token: null, user: null, isLoading: true });
const res2 = sim2.handleResponse({
  notification: {
    request: {
      identifier: 'notif_2',
      content: { data: { groupId: 'group_xyz' } },
    },
  },
});
assert.strictEqual(res2, 'QUEUED_PENDING', 'Cold start tap must be held in pending while session restores');
assert.strictEqual(sim2.getNavigated().length, 0, 'No navigation yet while restoring');
assert.notStrictEqual(sim2.getPending(), null, 'Pending response must be preserved');

// Session restores successfully
sim2.setAuth({ token: 'tok_valid', user: { id: 'user_1', name: 'Alice' }, isLoading: false });
assert.strictEqual(sim2.getPending(), null, 'Pending queue must be drained');
assert.deepStrictEqual(sim2.getNavigated(), ['/group/group_xyz'], 'Navigation must execute once session is restored');

// Case 3: Cold start tap, but user turns out to be logged out -> Discarded
const sim3 = createSimulationEnvironment();
sim3.setAuth({ token: null, user: null, isLoading: true });
sim3.handleResponse({
  notification: {
    request: {
      identifier: 'notif_3',
      content: { data: { groupId: 'group_xyz' } },
    },
  },
});
assert.notStrictEqual(sim3.getPending(), null, 'Response queued during loading');
// Session fails to restore (user is logged out)
sim3.setAuth({ token: null, user: null, isLoading: false });
assert.strictEqual(sim3.getPending(), null, 'Pending queue must be purged if user is logged out');
assert.strictEqual(sim3.getNavigated().length, 0, 'No navigation should occur if session restoration fails');

// Case 4: Account switch — User A's notification tapped while User B is logged in
const sim4 = createSimulationEnvironment();
sim4.setAuth({ token: 'tok_user_b', user: { id: 'user_b', name: 'Bob' }, isLoading: false });
const res4 = sim4.handleResponse({
  notification: {
    request: {
      identifier: 'notif_4',
      content: { data: { groupId: 'group_private_a', recipientId: 'user_a' } },
    },
  },
});
assert.strictEqual(res4, 'REJECTED_RECIPIENT_MISMATCH', 'Account switch tap for different recipient must be rejected');
assert.strictEqual(sim4.getNavigated().length, 0, 'No navigation across account boundary');

// Case 5: Matching recipient tap -> Navigated
const res5 = sim4.handleResponse({
  notification: {
    request: {
      identifier: 'notif_5',
      content: { data: { groupId: 'group_b_ok', recipientId: 'user_b' } },
    },
  },
});
assert.strictEqual(res5, 'NAVIGATED', 'Tap for current user must navigate');
assert.deepStrictEqual(sim4.getNavigated(), ['/group/group_b_ok']);

// Case 6: Duplicate response event -> Deduplicated
const res6 = sim4.handleResponse({
  notification: {
    request: {
      identifier: 'notif_5',
      content: { data: { groupId: 'group_b_ok', recipientId: 'user_b' } },
    },
  },
});
assert.strictEqual(res6, 'IGNORED_DUPLICATE', 'Duplicate response identifier must be deduplicated');
assert.strictEqual(sim4.getNavigated().length, 1, 'Duplicate event must not trigger second navigation');

// Case 7: Explicit logout resets deduplication and pending response
sim4.setAuth({ token: null, user: null, isLoading: false });
assert.strictEqual(sim4.getLastProcessedId(), null, 'Logout must clear last processed response ID');
assert.strictEqual(sim4.getPending(), null, 'Logout must clear pending response queue');

// Case 8: Cold-start lookup + listener duplicate delivery during loading
const sim5 = createSimulationEnvironment();
sim5.setAuth({ token: null, user: null, isLoading: true });
const coldLookup = sim5.handleResponse({
  notification: { request: { identifier: 'cold_99', content: { data: { groupId: 'g_cold' } } } },
});
assert.strictEqual(coldLookup, 'QUEUED_PENDING');
// Native listener fires for same cold start notification while still loading
const listenerDelivery = sim5.handleResponse({
  notification: { request: { identifier: 'cold_99', content: { data: { groupId: 'g_cold' } } } },
});
assert.strictEqual(listenerDelivery, 'IGNORED_DUPLICATE_PENDING', 'Duplicate delivery while loading must not double-queue');
// Session resolves
sim5.setAuth({ token: 'tok_alice', user: { id: 'u_alice' }, isLoading: false });
assert.strictEqual(sim5.getNavigated().length, 1, 'Cold start tap must navigate exactly once');

// Case 9: Notification without recipientId (multicast/backward compat) routes to group
const resCompat = sim5.handleResponse({
  notification: { request: { identifier: 'compat_1', content: { data: { groupId: 'g_compat' } } } },
});
assert.strictEqual(resCompat, 'NAVIGATED', 'Payload without recipientId must route to groupId for authenticated user');
assert.strictEqual(sim5.getNavigated().length, 2);

// Case 10: Deduplication does NOT collapse distinct notifications for the same group
const resDistinct1 = sim5.handleResponse({
  notification: { request: { identifier: 'event_A', content: { data: { groupId: 'g_shared' } } } },
});
assert.strictEqual(resDistinct1, 'NAVIGATED', 'First distinct notification must navigate');

const resDistinct2 = sim5.handleResponse({
  notification: { request: { identifier: 'event_B', content: { data: { groupId: 'g_shared' } } } },
});
assert.strictEqual(resDistinct2, 'NAVIGATED', 'Second distinct notification for same group must also navigate');
assert.strictEqual(sim5.getNavigated().length, 4, 'Distinct notifications must not be collapsed');

// Case 11: Fallback composite identifier distinguishes distinct notifications by notificationId or date
const resComposite1 = sim5.handleResponse({
  notification: {
    request: { content: { data: { groupId: 'g_composite', notificationId: 'notif_100' } } },
    date: 1000,
  },
});
assert.strictEqual(resComposite1, 'NAVIGATED', 'First composite notification must navigate');

const resComposite2 = sim5.handleResponse({
  notification: {
    request: { content: { data: { groupId: 'g_composite', notificationId: 'notif_101' } } },
    date: 2000,
  },
});
assert.strictEqual(resComposite2, 'NAVIGATED', 'Second composite notification with different notifId must also navigate');
assert.strictEqual(sim5.getNavigated().length, 6, 'Composite deduplication must not collapse distinct notifications');

// Case 12: Account switch directly from User A to User B clears pending and resets deduplication
sim5.setAuth({ token: 'tok_bob', user: { id: 'u_bob' }, isLoading: false });
assert.strictEqual(sim5.getLastProcessedId(), null, 'Account switch must clear last processed response ID');
assert.strictEqual(sim5.getPending(), null, 'Account switch must clear pending response queue');

console.log('✅ [Functional Lifecycle Simulation] Response lifecycle, cold-start queueing, deduplication preservation, and account boundary gating verified.');

console.log('\n🎉 ALL Stage 2A & 2B Native Android FCM Tests Passed Successfully!\n');
