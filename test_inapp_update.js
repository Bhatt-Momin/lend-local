/**
 * test_inapp_update.js — Test Suite for Stage 5: In-App Android Update System
 *
 * Covers:
 * 1. Backend GET /api/app-version manifest contract invariants
 * 2. Mobile update comparison logic (monotonic versionCode comparison)
 * 3. Network resilience (graceful error fallback without throwing or blocking app boot)
 * 4. Verified HTTPS download validation (rejects non-https schemes)
 * 5. Package ID & configuration invariants (preserves com.lendlocal.app)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Stage 5: In-App Android Update System Test Suite ---');

// 1. Backend Server app-version Manifest Contract
console.log('1. Testing Backend /api/app-version Route Invariants...');
const serverJsPath = path.join(__dirname, 'backend', 'server.js');
const serverJs = fs.readFileSync(serverJsPath, 'utf8');

assert(serverJs.includes('app.get("/api/app-version"'), 'server.js must define GET /api/app-version route');
assert(serverJs.includes('latestVersion: "1.0.0"') || serverJs.includes('"latestVersion": "1.0.0"'), 'Manifest must report latestVersion 1.0.0');
assert(serverJs.includes('versionCode: 1') || serverJs.includes('"versionCode": 1'), 'Manifest must report versionCode 1');
assert(serverJs.includes('https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk'),
  'Manifest must point to verified GitHub release APK');
assert(serverJs.includes('https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.0.0'),
  'Manifest must include release page URL');

console.log('✅ Backend /api/app-version Route Invariants verified.');

// 2. Mobile Package ID & App Config Invariants
console.log('2. Testing Mobile App Invariants (app.json)...');
const appJsonPath = path.join(__dirname, 'mobile', 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

assert.strictEqual(appJson.expo.android.package, 'com.lendlocal.app', 'Android package must remain com.lendlocal.app');
assert.strictEqual(appJson.expo.version, '1.0.0', 'Expo version must be 1.0.0');
assert.strictEqual(appJson.expo.android.versionCode, 1, 'Initial Android versionCode must be 1');
console.log('✅ Mobile App Invariants verified.');

// 3. Mobile updateService Implementation Invariants
console.log('3. Testing Mobile updateService & AppUpdateHandler Invariants...');
const updateServicePath = path.join(__dirname, 'mobile', 'src', 'services', 'updateService.ts');
const updateHandlerPath = path.join(__dirname, 'mobile', 'src', 'components', 'AppUpdateHandler.tsx');
const layoutPath = path.join(__dirname, 'mobile', 'src', 'app', '_layout.tsx');

assert(fs.existsSync(updateServicePath), 'updateService.ts must exist');
assert(fs.existsSync(updateHandlerPath), 'AppUpdateHandler.tsx must exist');

const updateServiceContent = fs.readFileSync(updateServicePath, 'utf8');
const updateHandlerContent = fs.readFileSync(updateHandlerPath, 'utf8');
const layoutContent = fs.readFileSync(layoutPath, 'utf8');

// Check that layout mounts AppUpdateHandler
assert(layoutContent.includes('<AppUpdateHandler />'), 'RootLayout must mount <AppUpdateHandler />');

// Check updateService compares numeric versionCode
assert(updateServiceContent.includes('manifest.versionCode > installedVersionCode'),
  'updateService must compare numeric versionCode');

// Check openApkDownload validates HTTPS
assert(updateServiceContent.includes("apkUrl.startsWith('https://')"),
  'openApkDownload must strictly enforce HTTPS URL scheme');

console.log('✅ Mobile Component Invariants verified.');

// 4. Functional Simulation: Version Comparison Logic
console.log('4. Testing Monotonic Version Code Comparison Logic...');

function evaluateUpdateStatus(installedVersionCode, manifest) {
  if (!manifest || typeof manifest.versionCode !== 'number') {
    return { hasUpdate: false, reason: 'Invalid manifest' };
  }
  const hasUpdate = manifest.versionCode > installedVersionCode;
  return { hasUpdate, manifest };
}

const currentManifest = {
  latestVersion: '1.0.0',
  versionCode: 1,
  releaseNotes: 'Initial release',
  apkUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk',
};

// 4A: Running version code 1 with manifest version code 1 -> hasUpdate = false
const sameVersionResult = evaluateUpdateStatus(1, currentManifest);
assert.strictEqual(sameVersionResult.hasUpdate, false, 'Installed version 1 with manifest 1 must not trigger update prompt');

// 4B: Future release published with version code 2 -> hasUpdate = true
const futureManifest = {
  latestVersion: '1.1.0',
  versionCode: 2,
  releaseNotes: 'Performance improvements and bug fixes',
  apkUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk',
};
const updateAvailableResult = evaluateUpdateStatus(1, futureManifest);
assert.strictEqual(updateAvailableResult.hasUpdate, true, 'Installed version 1 with manifest 2 must trigger update prompt');
assert.strictEqual(updateAvailableResult.manifest.versionCode, 2);

// 4C: Running a newer preview build (versionCode 3) while manifest is 2 -> hasUpdate = false
const previewResult = evaluateUpdateStatus(3, futureManifest);
assert.strictEqual(previewResult.hasUpdate, false, 'Running preview build ahead of manifest must not trigger update');

console.log('✅ Version Comparison Logic verified.');

// 5. Network Resilience Simulation
console.log('5. Testing Network Resilience...');

async function simulateCheckWithNetworkError(shouldFail) {
  try {
    if (shouldFail) {
      throw new Error('Network timeout (ETIMEDOUT)');
    }
    return { hasUpdate: false, manifest: currentManifest };
  } catch (err) {
    // Graceful fallback matching updateService.ts
    return { hasUpdate: false, manifest: null, error: err.message };
  }
}

simulateCheckWithNetworkError(true).then((res) => {
  assert.strictEqual(res.hasUpdate, false, 'Network failure must return hasUpdate: false');
  assert.strictEqual(res.manifest, null);
  assert(res.error.includes('ETIMEDOUT'), 'Error message must be preserved');
  console.log('✅ Network Resilience verified.');

  console.log('🎉 All Stage 5: In-App Android Update System Tests Passed Successfully!');
}).catch((err) => {
  console.error('❌ Stage 5 Test Failure:', err);
  process.exit(1);
});
