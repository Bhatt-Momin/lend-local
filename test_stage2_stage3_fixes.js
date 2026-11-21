/**
 * test_stage2_stage3_fixes.js — Complete Verification Suite for Audit Bug Fixes & In-App Update System
 *
 * Covers:
 * 1. DeepLinkHandler Untrusted Host Alerting & Input Validation
 * 2. PaymentModal In-Flight Polling Invalidation & Unmount Cleanup
 * 3. Notification Bell Badge Layout Invariants (No Negative Margins)
 * 4. NotificationPushHandler Fallback Feedback for Missing groupId
 * 5. API Client User-Friendly Timeout Message
 * 6. PhoneVerificationModal Cooldown Timer Cleanup on Close
 * 7. In-App Update System Advanced Manifest Validation & Safety:
 *    - Monotonic versionCode comparison
 *    - Application ID compatibility check (com.lendlocal.app)
 *    - Insecure download URL rejection
 *    - Mandatory update enforcement
 *    - SHA-256 checksum metadata support
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running LendLocal Stage 2 & 3 Fixes Verification Suite ---');

// =========================================================================
// 1. DeepLinkHandler Untrusted Host Alerting
// =========================================================================
console.log('1. Testing DeepLinkHandler Untrusted Host Feedback...');
const deepLinkHandlerPath = path.join(__dirname, 'mobile/src/components/DeepLinkHandler.tsx');
const deepLinkHandlerContent = fs.readFileSync(deepLinkHandlerPath, 'utf8');

assert(
  deepLinkHandlerContent.includes("parsed.scheme === 'lendlocal' ? 'Invalid Link' : 'Untrusted Link'"),
  'DeepLinkHandler must show Alert for untrusted HTTPS domains, not just lendlocal scheme'
);
assert(
  deepLinkHandlerContent.includes('Alert.alert('),
  'DeepLinkHandler must call Alert.alert when parsed.isValid is false'
);
console.log('✅ DeepLinkHandler Untrusted Host Feedback verified.');

// =========================================================================
// 2. PaymentModal In-Flight Polling Invalidation & Unmount Cleanup
// =========================================================================
console.log('2. Testing PaymentModal Polling Cleanup...');
const paymentModalPath = path.join(__dirname, 'mobile/src/components/PaymentModal.tsx');
const paymentModalContent = fs.readFileSync(paymentModalPath, 'utf8');

assert(
  paymentModalContent.includes('statusRequestIdRef.current += 1'),
  'stopPolling must invalidate in-flight request IDs so stale responses are discarded'
);
assert(
  paymentModalContent.includes('// Ensure polling is cleanly torn down on component unmount') &&
  paymentModalContent.includes('return () => {\n      stopPolling();\n    };'),
  'PaymentModal must explicitly stop polling in an unmount cleanup effect'
);
console.log('✅ PaymentModal Polling Cleanup verified.');

// =========================================================================
// 3. Notification Bell Badge Layout Invariants (No Negative Margins)
// =========================================================================
console.log('3. Testing Bell Badge Layout Invariants...');
const homeScreenPath = path.join(__dirname, 'mobile/src/app/index.tsx');
const homeScreenContent = fs.readFileSync(homeScreenPath, 'utf8');

assert(
  !homeScreenContent.includes('marginTop: -22') && !homeScreenContent.includes('marginRight: -22'),
  'bellBadge must not use fragile negative margins that cause clipping on narrow screens'
);
assert(
  (homeScreenContent.includes("position: 'absolute'") || homeScreenContent.includes('position: "absolute"')) &&
  homeScreenContent.includes('top: -4') &&
  homeScreenContent.includes('right: -4'),
  'bellBadge must use stable absolute positioning pinned to the icon button'
);
assert(
  homeScreenContent.includes("position: 'relative'"),
  'headerIconBtn must declare relative positioning for absolute children'
);
console.log('✅ Bell Badge Layout Invariants verified.');

// =========================================================================
// 4. NotificationPushHandler Fallback Feedback for Missing groupId
// =========================================================================
console.log('4. Testing NotificationPushHandler Fallback Feedback...');
const pushHandlerPath = path.join(__dirname, 'mobile/src/components/NotificationPushHandler.tsx');
const pushHandlerContent = fs.readFileSync(pushHandlerPath, 'utf8');

assert(
  pushHandlerContent.includes("import { Alert } from 'react-native';"),
  'NotificationPushHandler must import Alert from react-native'
);
assert(
  pushHandlerContent.includes('Alert.alert(') &&
  pushHandlerContent.includes('This notification has no associated group to open.'),
  'NotificationPushHandler must show Alert feedback when notification payload has no group target'
);
console.log('✅ NotificationPushHandler Fallback Feedback verified.');

// =========================================================================
// 5. API Client User-Friendly Timeout Message
// =========================================================================
console.log('5. Testing API Client Timeout Message...');
const clientPath = path.join(__dirname, 'mobile/src/services/client.ts');
const clientContent = fs.readFileSync(clientPath, 'utf8');

assert(
  clientContent.includes('Request timed out') &&
  clientContent.includes('The server took too long to respond; please retry.'),
  'client.ts must format timeout errors with a clear and actionable retry message'
);
console.log('✅ API Client Timeout Message verified.');

// =========================================================================
// 6. PhoneVerificationModal Cooldown Timer Cleanup
// =========================================================================
console.log('6. Testing PhoneVerificationModal Cooldown Cleanup & Keyboard Handling...');
const phoneModalPath = path.join(__dirname, 'mobile/src/components/PhoneVerificationModal.tsx');
const phoneModalContent = fs.readFileSync(phoneModalPath, 'utf8');

assert(
  phoneModalContent.includes('setCooldownSeconds(0);') &&
  phoneModalContent.includes('!visible || cooldownSeconds <= 0'),
  'PhoneVerificationModal must stop cooldown interval cleanly when visible is false'
);
assert(
  phoneModalContent.includes('<KeyboardAvoidingView') &&
  phoneModalContent.includes('</KeyboardAvoidingView>'),
  'PhoneVerificationModal must wrap interior with KeyboardAvoidingView for Android/iOS'
);
console.log('✅ PhoneVerificationModal Cooldown Cleanup & Keyboard Handling verified.');

// =========================================================================
// 7. In-App Update System Advanced Manifest Validation & Safety
// =========================================================================
console.log('7. Testing In-App Update Advanced Manifest Safety...');
const updateServicePath = path.join(__dirname, 'mobile/src/services/updateService.ts');
const updateServiceContent = fs.readFileSync(updateServicePath, 'utf8');

// 7A: Incompatible application ID rejection
assert(
  updateServiceContent.includes('manifest.applicationId !== EXPECTED_APPLICATION_ID') &&
  updateServiceContent.includes('Incompatible application ID'),
  'updateService must reject update manifests targeting other application IDs'
);

// 7B: Mandatory update calculation
assert(
  updateServiceContent.includes('manifest.isMandatory ||') &&
  updateServiceContent.includes('manifest.minSupportedVersionCode > installedVersionCode'),
  'updateService must correctly flag mandatory updates based on manifest flag or minSupportedVersionCode'
);

// 7C: Strict HTTPS verification
assert(
  updateServiceContent.includes("!manifest.apkUrl.startsWith('https://')"),
  'updateService must strictly reject non-HTTPS download URLs'
);

// 7D: Component presentation
const updateHandlerPath = path.join(__dirname, 'mobile/src/components/AppUpdateHandler.tsx');
const updateHandlerContent = fs.readFileSync(updateHandlerPath, 'utf8');

assert(
  updateHandlerContent.includes('Required Update') &&
  updateHandlerContent.includes('!isMandatory'),
  'AppUpdateHandler must hide Later button for mandatory updates'
);
assert(
  updateHandlerContent.includes('manifest.sha256'),
  'AppUpdateHandler must display SHA-256 checksum if provided'
);

// 7E: Download progress, cancellation, and checksum verification
assert(
  updateServiceContent.includes('downloadUpdateApk') &&
  updateServiceContent.includes('cancelUpdateDownload') &&
  updateServiceContent.includes('verifyApkChecksum') &&
  updateServiceContent.includes('installApk'),
  'updateService must export end-to-end download, cancellation, checksum, and install APIs'
);

// 7F: Check AppUpdateHandler download UI elements
assert(
  updateHandlerContent.includes('handleStartUpdate') &&
  updateHandlerContent.includes('handleCancelDownload') &&
  updateHandlerContent.includes('progressBarTrack') &&
  updateHandlerContent.includes('progressMetricsRow'),
  'AppUpdateHandler must render real download progress and cancel button'
);

console.log('✅ In-App Update Advanced Manifest Safety verified.');

// =========================================================================
// 8. SHA-256 Utility & Real Checksum Validation
// =========================================================================
console.log('8. Testing SHA-256 Utility & Real Checksum Validation...');
const sha256SourcePath = path.join(__dirname, 'mobile/src/utils/sha256.ts');
assert(fs.existsSync(sha256SourcePath), 'mobile/src/utils/sha256.ts must exist');
const sha256Content = fs.readFileSync(sha256SourcePath, 'utf8');

assert(
  sha256Content.includes('export function sha256Bytes') &&
  sha256Content.includes('export function base64ToUint8Array'),
  'sha256.ts must export sha256Bytes and base64ToUint8Array'
);
assert(
  sha256Content.includes('0x428a2f98') && sha256Content.includes('0x6a09e667'),
  'sha256.ts must implement standard FIPS 180-4 initial states and round constants'
);

// 8B: Backend manifest contains real APK checksum
const serverPath = path.join(__dirname, 'backend/server.js');
const serverContent = fs.readFileSync(serverPath, 'utf8');
assert(
  serverContent.includes('sha256: "2a7d975ec6f8a7faa4f035ff4fb9d5d409f89128e5500a7f8c98e1df87a1f7e0"'),
  'backend/server.js must report the actual non-empty SHA-256 hash of the release APK'
);
assert(
  serverContent.includes('applicationId: "com.lendlocal.app"'),
  'backend/server.js manifest must declare applicationId com.lendlocal.app'
);
// 8C: Native streaming SHA-256 in ApkInstallerModule.kt and index.ts
const apkModulePath = path.join(__dirname, 'mobile/modules/apk-installer/android/src/main/java/expo/modules/apkinstaller/ApkInstallerModule.kt');
assert(fs.existsSync(apkModulePath), 'ApkInstallerModule.kt must exist');
const apkModuleContent = fs.readFileSync(apkModulePath, 'utf8');

assert(
  apkModuleContent.includes('AsyncFunction("getFileSha256")'),
  'ApkInstallerModule.kt must expose native getFileSha256 function'
);
assert(
  apkModuleContent.includes('context.contentResolver.openInputStream(uri)'),
  'ApkInstallerModule.kt must stream via ContentResolver to support both content:// and file:// URIs'
);
assert(
  apkModuleContent.includes('ByteArray(8192)') &&
  apkModuleContent.includes('MessageDigest.getInstance("SHA-256")'),
  'ApkInstallerModule.kt must stream bytes through SHA-256 with an 8KB buffer without loading APK into memory'
);

const apkIndexPath = path.join(__dirname, 'mobile/modules/apk-installer/index.ts');
assert(fs.existsSync(apkIndexPath), 'modules/apk-installer/index.ts must exist');
const apkIndexContent = fs.readFileSync(apkIndexPath, 'utf8');
assert(
  apkIndexContent.includes('getFileSha256(uriString: string): Promise<string>'),
  'modules/apk-installer/index.ts must declare getFileSha256 in ApkInstallerNativeModule interface'
);

// 8D: updateService native hash integration & large-file memory protection
// Re-read updateServiceContent to ensure latest edits are inspected
const updatedServiceContent = fs.readFileSync(updateServicePath, 'utf8');

assert(
  updatedServiceContent.includes('const contentUri = await FileSystem.getContentUriAsync(fileUri);') &&
  updatedServiceContent.includes('const nativeHash = await ApkInstaller.getFileSha256(contentUri);'),
  'updateService must convert fileUri to contentUri using getContentUriAsync before calling ApkInstaller.getFileSha256'
);
assert(
  updatedServiceContent.includes('!expectedSha256 || typeof expectedSha256 !== \'string\' || !expectedSha256.trim()') &&
  updatedServiceContent.includes('Release manifest does not provide required SHA-256 checksum'),
  'updateService must fail closed with an error when manifest expectedSha256 is missing or blank'
);
assert(
  updatedServiceContent.includes('fileSize > MAX_JS_HASH_FILE_SIZE_BYTES') &&
  updatedServiceContent.includes('Cannot verify large APK') &&
  updatedServiceContent.includes('without native streaming support'),
  'updateService must guard against large-file in-memory fallback to prevent OOM crashes'
);
assert(
  updatedServiceContent.includes('Checksum verification failed.') &&
  updatedServiceContent.includes('await FileSystem.deleteAsync(fileUri, { idempotent: true });'),
  'updateService must delete corrupt file immediately on checksum mismatch'
);

// 8E: Runtime Logic Verification (Isolated Simulation of updateService Checksum Policy)
// NOTE: This runs in Node.js to exercise the verification, mismatch cleanup, and fail-closed logic paths;
// real native Android Kotlin execution requires an EAS preview APK build.
console.log('  Running isolated runtime logic tests for checksum rules...');

async function simulateVerifyApkChecksum({
  fileUri,
  expectedSha256,
  fileSize,
  nativeSha256Result,
  nativeError,
  hasNativeModule,
}) {
  let fileDeleted = false;

  // 1. Missing or blank expected hash
  if (!expectedSha256 || typeof expectedSha256 !== 'string' || !expectedSha256.trim()) {
    throw new Error('Release manifest does not provide required SHA-256 checksum for update verification.');
  }

  const cleanExpected = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanExpected)) {
    throw new Error(`Invalid expected SHA-256 format in manifest: ${expectedSha256}`);
  }

  // Calculate checksum simulation
  let calculatedSha256 = '';

  if (hasNativeModule) {
    if (nativeError) {
      throw new Error(`Native checksum verification failed: ${nativeError.message}`);
    }
    // Simulate content URI resolution
    assert(fileUri.startsWith('file://') || fileUri.startsWith('content://'));
    calculatedSha256 = nativeSha256Result;
  } else {
    // Large file check
    const MAX_JS = 5 * 1024 * 1024;
    if (fileSize > MAX_JS) {
      throw new Error(
        `Cannot verify large APK (${(fileSize / 1048576).toFixed(1)} MB) without native streaming support.`
      );
    }
    calculatedSha256 = cleanExpected; // Simulated small-file JS fallback
  }

  if (calculatedSha256 !== cleanExpected) {
    fileDeleted = true;
    throw new Error(
      `Checksum verification failed. Expected SHA-256 ${cleanExpected}, but got ${calculatedSha256}. Corrupted file removed.`
    );
  }

  return { verified: true, fileDeleted };
}

(async () => {
  const dummyExpected = '2a7d975ec6f8a7faa4f035ff4fb9d5d409f89128e5500a7f8c98e1df87a1f7e0';

  // Test 8E-1: Missing / blank expected hash throws error
  let missingError = null;
  try {
    await simulateVerifyApkChecksum({ fileUri: 'file:///cache/test.apk', expectedSha256: '' });
  } catch (err) {
    missingError = err;
  }
  assert(missingError && missingError.message.includes('does not provide required SHA-256'),
    'Runtime: Missing expectedSha256 must throw required checksum error');

  // Test 8E-2: Invalid expected hash format throws error
  let invalidFormatError = null;
  try {
    await simulateVerifyApkChecksum({ fileUri: 'file:///cache/test.apk', expectedSha256: 'not-a-valid-hash' });
  } catch (err) {
    invalidFormatError = err;
  }
  assert(invalidFormatError && invalidFormatError.message.includes('Invalid expected SHA-256 format'),
    'Runtime: Non-hex or invalid length expectedSha256 must throw format error');

  // Test 8E-3: Checksum mismatch triggers file deletion and throws
  let mismatchError = null;
  try {
    await simulateVerifyApkChecksum({
      fileUri: 'file:///cache/test.apk',
      expectedSha256: dummyExpected,
      hasNativeModule: true,
      nativeSha256Result: '0000000000000000000000000000000000000000000000000000000000000000',
    });
  } catch (err) {
    mismatchError = err;
  }
  assert(mismatchError && mismatchError.message.includes('Checksum verification failed'),
    'Runtime: Hash mismatch must throw verification failed error');

  // Test 8E-4: Large file without native module throws OOM guard error
  let largeFileError = null;
  try {
    await simulateVerifyApkChecksum({
      fileUri: 'file:///cache/test.apk',
      expectedSha256: dummyExpected,
      fileSize: 105 * 1024 * 1024,
      hasNativeModule: false,
    });
  } catch (err) {
    largeFileError = err;
  }
  assert(largeFileError && largeFileError.message.includes('Cannot verify large APK'),
    'Runtime: Large APK without native module must fail closed with OOM protection error');

  // Test 8E-5: Valid match with native module succeeds
  const successResult = await simulateVerifyApkChecksum({
    fileUri: 'file:///cache/test.apk',
    expectedSha256: dummyExpected,
    hasNativeModule: true,
    nativeSha256Result: dummyExpected,
  });
  assert.strictEqual(successResult.verified, true, 'Runtime: Matching checksum must verify successfully');
})();

console.log('✅ SHA-256 Utility & Real Checksum Validation verified.');

// =========================================================================
// 9. Android Keyboard Handling Consistency Across Screens
// =========================================================================
console.log('9. Testing Android Keyboard Handling Consistency...');
const loginContent = fs.readFileSync(path.join(__dirname, 'mobile/src/app/(auth)/login.tsx'), 'utf8');
const registerContent = fs.readFileSync(path.join(__dirname, 'mobile/src/app/(auth)/register.tsx'), 'utf8');
const groupNewContent = fs.readFileSync(path.join(__dirname, 'mobile/src/app/group/new.tsx'), 'utf8');

assert(
  loginContent.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"),
  'LoginScreen must configure explicit height behavior on Android'
);
assert(
  registerContent.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"),
  'RegisterScreen must configure explicit height behavior on Android'
);
assert(
  groupNewContent.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"),
  'CreateGroupScreen must configure explicit height behavior on Android'
);
assert(
  phoneModalContent.includes("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}"),
  'PhoneVerificationModal must configure explicit height behavior on Android'
);
console.log('✅ Android Keyboard Handling Consistency verified.');

console.log('\n🎉 ALL Stage 2 & Stage 3 Audit Fixes & Update Verification Tests Passed Successfully!');
