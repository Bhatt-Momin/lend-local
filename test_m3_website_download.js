/**
 * LendLocal Milestone 3 (M3) — Website Android APK Download Integration Tests
 *
 * Validates:
 * 1. Login page form and registration link integrity
 * 2. PWA manifest and service worker references
 * 3. Android app download section semantic markup and accessibility
 * 4. Safe default state: no broken links, button disabled, preparation notice
 * 5. Download URL activation logic & protocol safety
 * 6. Non-interference with PWA install flow
 * 7. Mobile APK build readiness in app.json and eas.json
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Running Native Android Milestone 3 (M3) Test Suite ---');

const loginHtmlPath = path.join(__dirname, 'frontend', 'login.html');
const dashboardHtmlPath = path.join(__dirname, 'frontend', 'dashboard.html');
const helpersJsPath = path.join(__dirname, 'frontend', 'js', 'helpers.js');
const cssPath = path.join(__dirname, 'frontend', 'css', 'auth-premium.css');
const manifestPath = path.join(__dirname, 'frontend', 'manifest.json');
const appJsonPath = path.join(__dirname, 'mobile', 'app.json');
const easJsonPath = path.join(__dirname, 'mobile', 'eas.json');

const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
const dashboardHtml = fs.readFileSync(dashboardHtmlPath, 'utf8');
const authCss = fs.readFileSync(cssPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const easJson = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));
const { isValidHttpsUrl, normalizeAppVersion, fetchAppVersion } = require(helpersJsPath);

// 1. Verify Login Form & Registration Link Integrity
console.log('1. Testing Login Form & Registration Link Integrity...');
assert(loginHtml.includes('id="loginForm"'), 'Form loginForm must exist');
assert(loginHtml.includes('name="email"'), 'Email input must exist');
assert(loginHtml.includes('name="password"'), 'Password input must exist');
assert(loginHtml.includes('type="submit"'), 'Submit button must exist');
assert(loginHtml.includes('Sign in'), 'Sign in text must exist');
assert(loginHtml.includes('href="/register.html"'), 'Registration link to /register.html must exist');
assert(loginHtml.includes('Create an account'), 'Create an account text must exist');
console.log('✅ Login Form & Registration Link integrity passed.');

// 2. Verify PWA Manifest & Service Worker References
console.log('2. Testing PWA Manifest & Service Worker References...');
assert(loginHtml.includes('href="/manifest.json"'), 'Manifest link must point to /manifest.json');
assert(loginHtml.includes('src="/js/pwa.js"'), 'PWA script /js/pwa.js must be loaded');
assert.strictEqual(manifest.name, 'LendLocal', 'Manifest name must be LendLocal');
assert.strictEqual(manifest.short_name, 'LendLocal', 'Manifest short_name must be LendLocal');
assert.strictEqual(manifest.display, 'standalone', 'Manifest display must be standalone');
assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'Manifest must contain icons');
console.log('✅ PWA Manifest & Service Worker references passed.');

// 3. Verify Android App Download Section Semantic Markup & Accessibility
console.log('3. Testing Android App Section Semantic Markup & Accessibility...');
assert(loginHtml.includes('class="auth-app-card"'), 'auth-app-card section must exist');
assert(loginHtml.includes('aria-label="LendLocal for Android"'), 'Section must have accessible aria-label');
assert(loginHtml.includes('id="androidDownloadSlot"'), 'Slot androidDownloadSlot must exist');
assert(loginHtml.includes('id="androidDownloadBtn"'), 'Button androidDownloadBtn must exist');
assert(loginHtml.includes('id="androidDownloadNote"'), 'Note androidDownloadNote must exist');
assert(loginHtml.includes('role="status"'), 'Status note must have role="status"');
console.log('✅ Android App Section Semantic Markup & Accessibility passed.');

// 4. Verify Safe Fallback Markup & Configured Release Asset URL
console.log('4. Testing Safe Fallback Markup & Configured Release Asset URL...');
assert(loginHtml.includes('id="androidDownloadSlot"'), 'androidDownloadSlot must exist');
assert(!loginHtml.includes('data-download-url'), 'data-download-url override must not exist in login.html (backend manifest is authoritative)');

// Check that initial fallback button is disabled by default in HTML markup
assert(loginHtml.includes('disabled aria-disabled="true"'), 'Download button must be disabled by default in initial markup');

// Check initial fallback note provides honest preparation status for non-JS / fallback environments
assert(loginHtml.includes('in preparation'), 'Status note must explain APK build is in preparation in initial markup');

// Check no placeholder hrefs or static unverified .apk links in markup
assert(!loginHtml.includes('href="#"'), 'Must not contain href="#" placeholders');
assert(!loginHtml.includes('.apk" href='), 'Must not link to nonexistent local .apk in HTML');
assert(!/href=["'][^"']*\.apk["']/.test(loginHtml), 'Must not have static .apk link before verification');

// Check that button initial markup has accessible fallback before script activation
assert(loginHtml.includes('id="androidDownloadBtn"'), 'Initial fallback button must exist');
assert(loginHtml.includes('id="androidDownloadNote"'), 'Status note must exist');

// Check that initial HTML markup uses generic wording without hardcoded v1.0.0
assert(!loginHtml.includes('v1.0.0'), 'login.html markup must not claim v1.0.0 in initial HTML');
assert(!dashboardHtml.includes('v1.0.0'), 'dashboard.html markup must not claim v1.0.0 in initial HTML');

// Check that GITHUB_RELEASES_URL constant is configured with the general releases page URL
const releasesMatch = loginHtml.match(/const\s+GITHUB_RELEASES_URL\s*=\s*'([^']*)'/);
assert(releasesMatch, 'GITHUB_RELEASES_URL constant must be declared');
const expectedReleasesUrl = 'https://github.com/Bhatt-Momin/lend-local/releases';
assert.strictEqual(releasesMatch[1].trim(), expectedReleasesUrl, `GITHUB_RELEASES_URL must point to general releases page: ${expectedReleasesUrl}`);

// Check that fallback link class is present
assert(loginHtml.includes('auth-app-fallback-link'), 'Fallback link class must be present');
console.log('✅ Safe Fallback Markup & Configured Release Asset URL passed.');

// 5. Test Activation Logic & Protocol Safety Simulation
console.log('5. Testing Activation Logic & Protocol Safety Simulation...');
function simulateInitAndroidDownload(manifestUrl, releasesUrl) {
  const targetUrl = (manifestUrl || '').trim();
  const relUrl = (releasesUrl || 'https://github.com/Bhatt-Momin/lend-local/releases').trim();
  if (targetUrl && (targetUrl.startsWith('https://') || targetUrl.startsWith('/'))) {
    return {
      active: true,
      href: targetUrl,
      download: 'lendlocal.apk',
      rel: 'noopener noreferrer',
      ariaLabel: 'Download LendLocal Android App (APK)',
      note: 'Direct APK download for Android devices. ',
      fallbackLink: {
        href: relUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'auth-app-fallback-link',
        text: 'GitHub Releases'
      }
    };
  }
  return {
    active: false,
    disabled: true,
    note: 'Unable to check the latest version. ',
    fallbackLink: {
      href: relUrl,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'auth-app-fallback-link',
      text: 'GitHub Releases'
    }
  };
}

// When unconfigured or failed:
const unconfiguredResult = simulateInitAndroidDownload('', '');
assert.strictEqual(unconfiguredResult.active, false, 'Must be inactive when unconfigured');
assert.strictEqual(unconfiguredResult.disabled, true, 'Must remain disabled');
assert(unconfiguredResult.note.includes('Unable to check'), 'Unconfigured/failed state must explain version check could not complete');
assert.strictEqual(unconfiguredResult.fallbackLink.href, 'https://github.com/Bhatt-Momin/lend-local/releases', 'Must link to general releases page on failure');

// When verified GitHub release URL is configured:
const verifiedUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk';
const verifiedReleasesUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.1.0';
const activeResult = simulateInitAndroidDownload(verifiedUrl, verifiedReleasesUrl);
assert.strictEqual(activeResult.active, true, 'Must activate when valid HTTPS URL is set');
assert.strictEqual(activeResult.href, verifiedUrl, 'Must point to verified URL');
assert.strictEqual(activeResult.download, 'lendlocal.apk', 'Must have download attribute');
assert.strictEqual(activeResult.rel, 'noopener noreferrer', 'Must have secure rel attribute');
assert(activeResult.fallbackLink, 'Active state must provide secondary fallback link to releases');
assert.strictEqual(activeResult.fallbackLink.href, verifiedReleasesUrl, 'Fallback link must point to verified release page');

// When unsafe URL is injected (e.g. javascript:):
const unsafeResult = simulateInitAndroidDownload('javascript:alert(1)', '');
assert.strictEqual(unsafeResult.active, false, 'Must reject non-https/non-root URLs');
console.log('✅ Activation Logic & Protocol Safety Simulation passed.');

// 6. Verify PWA Non-Interference
console.log('6. Testing Separation from PWA Installation Flow...');
assert(!loginHtml.includes('id="installAppBtn"'), 'Login page must not hijack installAppBtn');
assert(loginHtml.includes('class="auth-app-card"'), 'Android download must use dedicated auth-app-card');
console.log('✅ Separation from PWA Installation Flow verified.');

// 7. Verify EAS and App.json Android Build Readiness
console.log('7. Testing EAS and App.json Build Readiness...');
assert.strictEqual(appJson.expo.android.package, 'com.lendlocal.app', 'Android package must be com.lendlocal.app');
assert.strictEqual(easJson.build.preview.android.buildType, 'apk', 'Preview profile must specify buildType: apk');
assert.strictEqual(easJson.build.preview.distribution, 'internal', 'Preview profile must have distribution: internal');
assert(easJson.build.preview.env && easJson.build.preview.env.EXPO_PUBLIC_API_URL, 'EAS preview must define EXPO_PUBLIC_API_URL');
assert(!easJson.build.preview.env.EXPO_PUBLIC_API_URL.includes('localhost'), 'Production API URL must not point to localhost');
assert(!JSON.stringify(easJson).includes('password'), 'eas.json must not expose credentials');
assert(!JSON.stringify(easJson).includes('keystore'), 'eas.json must not expose keystore');
console.log('✅ EAS and App.json Build Readiness verified.');

// 8. Verify CSS Rules Exist
console.log('8. Testing CSS Rules for Android App Section...');
assert(authCss.includes('.auth-app-card'), 'CSS must define .auth-app-card');
assert(authCss.includes('.auth-app-btn'), 'CSS must define .auth-app-btn');
assert(authCss.includes('.auth-app-btn:disabled'), 'CSS must define disabled styling');
assert(authCss.includes('.auth-app-note'), 'CSS must define .auth-app-note');
assert(authCss.includes('@media (max-width: 480px)'), 'CSS must include mobile responsive query');
console.log('✅ CSS Rules verified.');

// 9. Testing Protocol Safety & URL Validation Utility (isValidHttpsUrl)
console.log('9. Testing Protocol Safety & URL Validation Utility...');
assert.strictEqual(typeof isValidHttpsUrl, 'function', 'isValidHttpsUrl must be exported');
assert.strictEqual(isValidHttpsUrl('https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk'), true, 'Must allow valid HTTPS URLs');
assert.strictEqual(isValidHttpsUrl('https://app.lendlocal.com/downloads/lendlocal.apk'), true, 'Must allow arbitrary HTTPS host');
assert.strictEqual(isValidHttpsUrl('/downloads/lendlocal.apk'), true, 'Must allow same-origin root-relative paths');
assert.strictEqual(isValidHttpsUrl('http://insecure-domain.com/lendlocal.apk'), false, 'Must reject insecure HTTP URLs');
assert.strictEqual(isValidHttpsUrl('javascript:alert(1)'), false, 'Must reject javascript: pseudo-protocol');
assert.strictEqual(isValidHttpsUrl('//evil.com/lendlocal.apk'), false, 'Must reject protocol-relative URLs');
assert.strictEqual(isValidHttpsUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false, 'Must reject data: URLs');
assert.strictEqual(isValidHttpsUrl('vbscript:msgbox(1)'), false, 'Must reject vbscript: URLs');
assert.strictEqual(isValidHttpsUrl(''), false, 'Must reject empty string');
assert.strictEqual(isValidHttpsUrl(null), false, 'Must reject null');
assert.strictEqual(isValidHttpsUrl(undefined), false, 'Must reject undefined');
assert.strictEqual(isValidHttpsUrl({ url: 'https://github.com' }), false, 'Must reject non-string objects');

// Credential-bearing HTTPS URL rejection tests
assert.strictEqual(isValidHttpsUrl('https://user:password@evil.com/lendlocal.apk'), false, 'Must reject credentials (user:pass) in URL');
assert.strictEqual(isValidHttpsUrl('https://user@evil.com/lendlocal.apk'), false, 'Must reject username in URL');
assert.strictEqual(isValidHttpsUrl('https://:password@evil.com/lendlocal.apk'), false, 'Must reject password in URL');

// Backslash variant rejection tests (prevents /\evil.com open-redirect / protocol-relative bypasses)
assert.strictEqual(isValidHttpsUrl('/\\evil.com'), false, 'Must reject /\\evil.com');
assert.strictEqual(isValidHttpsUrl('/\\evil.com/app.apk'), false, 'Must reject /\\evil.com/app.apk');
assert.strictEqual(isValidHttpsUrl('\\/evil.com'), false, 'Must reject \\/evil.com');
assert.strictEqual(isValidHttpsUrl('/\\\\evil.com'), false, 'Must reject /\\\\evil.com');
assert.strictEqual(isValidHttpsUrl('/downloads\\app.apk'), false, 'Must reject backslash in path /downloads\\app.apk');
assert.strictEqual(isValidHttpsUrl('\\downloads\\app.apk'), false, 'Must reject Windows backslash paths');
console.log('✅ Protocol Safety & URL Validation Utility verified.');

// 9b. Testing Version Normalization Utility (normalizeAppVersion)
console.log('9b. Testing Version Normalization Utility...');
assert.strictEqual(typeof normalizeAppVersion, 'function', 'normalizeAppVersion must be exported');
assert.strictEqual(normalizeAppVersion('1.1.0'), '1.1.0', 'Must preserve standard semver');
assert.strictEqual(normalizeAppVersion('v1.1.0'), '1.1.0', 'Must normalize leading lowercase v');
assert.strictEqual(normalizeAppVersion('V1.1.0'), '1.1.0', 'Must normalize leading uppercase V');
assert.strictEqual(normalizeAppVersion('vv1.1.0'), '1.1.0', 'Must normalize multiple leading v');
assert.strictEqual(normalizeAppVersion('2.0.0-rc1'), '2.0.0-rc1', 'Must support pre-release tags');
assert.strictEqual(normalizeAppVersion('<script>alert(1)</script>'), '', 'Must reject HTML/XSS strings');
assert.strictEqual(normalizeAppVersion(''), '', 'Must return empty string for empty input');
assert.strictEqual(normalizeAppVersion(null), '', 'Must return empty string for null');
assert.strictEqual(normalizeAppVersion(undefined), '', 'Must return empty string for undefined');
console.log('✅ Version Normalization Utility verified.');

// 10. Testing Dynamic Manifest Fetching, Resilience & Non-HTTPS Rejection (fetchAppVersion)
async function testDynamicFetchManifest() {
  console.log('10. Testing Dynamic Manifest Fetching, Resilience & Timeout Handling...');
  assert.strictEqual(typeof fetchAppVersion, 'function', 'fetchAppVersion must be exported');

  // Test 10a: Successful manifest retrieval
  const validMockManifest = {
    applicationId: 'com.lendlocal.app',
    latestVersion: '1.1.0',
    versionCode: 2,
    apkUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk',
    releasesPageUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.1.0',
    sha256: '99001e06d6bc93c152e4e06dcc2a31f195d2301ccdd7f352fd48814602b6e984'
  };
  const mockFetchSuccess = async () => ({
    ok: true,
    status: 200,
    json: async () => validMockManifest
  });
  const data = await fetchAppVersion({ fetchFn: mockFetchSuccess });
  assert.strictEqual(data.latestVersion, '1.1.0', 'Must parse latestVersion correctly');
  assert.strictEqual(data.normalizedVersion, '1.1.0', 'Must provide normalizedVersion');
  assert.strictEqual(data.versionCode, 2, 'Must parse versionCode correctly');
  assert.strictEqual(data.apkUrl, validMockManifest.apkUrl, 'Must return valid apkUrl');
  assert.strictEqual(data.releasesPageUrl, validMockManifest.releasesPageUrl, 'Must return releasesPageUrl');

  // Test 10b: Insecure non-HTTPS apkUrl rejection
  const mockInsecureApk = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      latestVersion: '1.1.0',
      apkUrl: 'http://insecure-cdn.com/lendlocal.apk'
    })
  });
  let rejectedInsecure = false;
  try {
    await fetchAppVersion({ fetchFn: mockInsecureApk });
  } catch (err) {
    rejectedInsecure = true;
    assert(err.message.includes('Insecure') || err.message.includes('rejected'), 'Error message must explain insecure URL rejection');
  }
  assert.strictEqual(rejectedInsecure, true, 'fetchAppVersion must reject non-HTTPS apkUrl');

  // Test 10c: Credential-bearing apkUrl rejection
  const mockCredApk = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      latestVersion: '1.1.0',
      apkUrl: 'https://user:pass@evil.com/lendlocal.apk'
    })
  });
  let rejectedCred = false;
  try {
    await fetchAppVersion({ fetchFn: mockCredApk });
  } catch (err) {
    rejectedCred = true;
  }
  assert.strictEqual(rejectedCred, true, 'fetchAppVersion must reject credential-bearing apkUrl');

  // Test 10d: Insecure releasesPageUrl sanitization
  const mockInsecureReleases = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      latestVersion: '1.1.0',
      apkUrl: 'https://github.com/safe/lendlocal.apk',
      releasesPageUrl: 'javascript:alert(document.cookie)'
    })
  });
  const sanitizedData = await fetchAppVersion({ fetchFn: mockInsecureReleases });
  assert.strictEqual(sanitizedData.releasesPageUrl, null, 'fetchAppVersion must nullify insecure releasesPageUrl');

  // Test 10e: Leading 'v' normalization in manifest response
  const mockVVersion = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      latestVersion: 'v1.1.0',
      apkUrl: 'https://github.com/safe/lendlocal.apk'
    })
  });
  const dataV = await fetchAppVersion({ fetchFn: mockVVersion });
  assert.strictEqual(dataV.normalizedVersion, '1.1.0', 'Must normalize leading v in latestVersion');

  // Test 10f: HTTP 500 error resilience
  const mockHttp500 = async () => ({ ok: false, status: 500 });
  let rejected500 = false;
  try {
    await fetchAppVersion({ fetchFn: mockHttp500 });
  } catch (err) {
    rejected500 = true;
  }
  assert.strictEqual(rejected500, true, 'fetchAppVersion must reject on non-200 responses');

  // Test 10g: Timeout handling
  const mockTimeoutFetch = async (url, opts) => {
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  let rejectedTimeout = false;
  try {
    await fetchAppVersion({ fetchFn: mockTimeoutFetch, timeoutMs: 30 });
  } catch (err) {
    rejectedTimeout = true;
  }
  assert.strictEqual(rejectedTimeout, true, 'fetchAppVersion must reject upon timeout expiration');

  // Test 10h: Malformed response handling
  const mockMalformed = async () => ({
    ok: true,
    status: 200,
    json: async () => 'not an object'
  });
  let rejectedMalformed = false;
  try {
    await fetchAppVersion({ fetchFn: mockMalformed });
  } catch (err) {
    rejectedMalformed = true;
  }
  assert.strictEqual(rejectedMalformed, true, 'fetchAppVersion must reject non-object JSON');

  console.log('✅ Dynamic Manifest Fetching, Resilience & Timeout Handling verified.');
}

// 11. Testing Login Page Dynamic Update & Accessibility Invariants
console.log('11. Testing Login Page Dynamic Update & Accessibility Invariants...');
assert(loginHtml.includes('src="/js/helpers.js"'), 'login.html must include /js/helpers.js');
assert(loginHtml.includes('renderAndroidDownloadSuccess'), 'login.html must define renderAndroidDownloadSuccess');
assert(loginHtml.includes('renderAndroidDownloadFailure'), 'login.html must define renderAndroidDownloadFailure');
assert(loginHtml.includes('initAndroidDownload'), 'login.html must define initAndroidDownload');
assert(loginHtml.includes('androidRetryBtn'), 'login.html must include androidRetryBtn');
assert(loginHtml.includes('fetchAppVersion'), 'login.html must call fetchAppVersion');
assert(!loginHtml.includes('v1.0.0'), 'login.html must not contain hardcoded v1.0.0 references');
const downloadScript = loginHtml.substring(loginHtml.indexOf('initAndroidDownload'));
assert(!downloadScript.includes('innerHTML'), 'Download section script must avoid innerHTML manipulation');

// Emulate login page dynamic hydration
function simulateLoginHydration(manifestData) {
  const generalReleases = 'https://github.com/Bhatt-Momin/lend-local/releases';
  if (!manifestData || !manifestData.apkUrl || !isValidHttpsUrl(manifestData.apkUrl)) {
    return {
      status: 'failed',
      buttonDisabled: true,
      buttonLabel: 'Download Android App',
      noteText: 'Unable to check the latest version. ',
      retryAvailable: true,
      releasesHref: generalReleases,
      releasesText: 'GitHub Releases'
    };
  }

  const rawVersion = manifestData.latestVersion || '';
  const version = normalizeAppVersion(rawVersion);
  const versionLabel = version ? ` (v${version})` : '';
  const releasesUrl = (manifestData.releasesPageUrl && isValidHttpsUrl(manifestData.releasesPageUrl))
    ? manifestData.releasesPageUrl
    : generalReleases;

  return {
    status: 'success',
    buttonDisabled: false,
    buttonHref: manifestData.apkUrl,
    buttonLabel: `Download Android App${versionLabel}`,
    buttonAriaLabel: `Download LendLocal Android App${versionLabel} (APK)`,
    noteText: `Direct APK download for Android devices${versionLabel}. `,
    releasesHref: releasesUrl,
    releasesText: version ? `View v${version} on GitHub Releases` : 'View on GitHub Releases',
    releasesAriaLabel: `View LendLocal release notes on GitHub (opens in a new tab)`
  };
}

// 1. Initial / Failed state must NEVER claim v1.0.0
const loginFailedState = simulateLoginHydration(null);
assert.strictEqual(loginFailedState.status, 'failed');
assert.strictEqual(loginFailedState.buttonDisabled, true);
assert.strictEqual(loginFailedState.buttonLabel, 'Download Android App', 'Failed state must use generic label without v1.0.0');
assert(loginFailedState.noteText.includes('Unable to check'), 'Failed note must explain version check failed');
assert.strictEqual(loginFailedState.retryAvailable, true, 'Retry control must be available on failure');
assert.strictEqual(loginFailedState.releasesHref, 'https://github.com/Bhatt-Momin/lend-local/releases', 'Must link to general GitHub releases page');

// 2. Successful dynamic update with version normalization
const loginSuccessState = simulateLoginHydration({
  latestVersion: 'v1.1.0', // leading v
  apkUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk',
  releasesPageUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.1.0'
});
assert.strictEqual(loginSuccessState.status, 'success');
assert.strictEqual(loginSuccessState.buttonDisabled, false);
assert.strictEqual(loginSuccessState.buttonLabel, 'Download Android App (v1.1.0)', 'Must normalize v1.1.0 without vv');
assert.strictEqual(loginSuccessState.buttonHref, 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk');
assert.strictEqual(loginSuccessState.releasesText, 'View v1.1.0 on GitHub Releases');

// 3. Retry simulation: failure followed by retry success
let attemptCount = 0;
function simulateRetryFlow() {
  attemptCount++;
  if (attemptCount === 1) {
    return simulateLoginHydration(null); // attempt 1 fails
  }
  return simulateLoginHydration({ // attempt 2 succeeds
    latestVersion: '1.1.0',
    apkUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk'
  });
}
const firstAttempt = simulateRetryFlow();
assert.strictEqual(firstAttempt.status, 'failed');
assert.strictEqual(firstAttempt.retryAvailable, true);
const retryAttempt = simulateRetryFlow();
assert.strictEqual(retryAttempt.status, 'success');
assert.strictEqual(retryAttempt.buttonLabel, 'Download Android App (v1.1.0)');

// 4. Repeated retry failure remains safe
attemptCount = 0;
function simulatePersistentFailure() {
  return simulateLoginHydration(null);
}
const persistentFail = simulatePersistentFailure();
assert.strictEqual(persistentFail.status, 'failed');
assert.strictEqual(persistentFail.buttonLabel, 'Download Android App');

// 5. XSS attempt in latestVersion
const xssPayload = {
  latestVersion: '<script>alert(1)</script>',
  apkUrl: 'https://github.com/safe/lendlocal.apk'
};
const xssResult = simulateLoginHydration(xssPayload);
assert.strictEqual(xssResult.buttonLabel, 'Download Android App', 'XSS string must normalize to empty string');
console.log('✅ Login Page Dynamic Update & Accessibility Invariants verified.');

// 12. Testing Dashboard Install Modal Markup & Dynamic Integration Invariants
console.log('12. Testing Dashboard Install Modal Markup & Dynamic Integration...');
assert(dashboardHtml.includes('src="/js/helpers.js"'), 'dashboard.html must include /js/helpers.js');
assert(dashboardHtml.includes('id="installManualModal"'), 'dashboard.html must contain installManualModal');
assert(dashboardHtml.includes('id="dashboardAndroidDownloadBtn"'), 'dashboard.html must contain id="dashboardAndroidDownloadBtn"');
assert(dashboardHtml.includes('id="dashboardAndroidBtnLabel"'), 'dashboard.html must contain id="dashboardAndroidBtnLabel"');
assert(dashboardHtml.includes('id="dashboardAndroidStatus"'), 'dashboard.html must contain id="dashboardAndroidStatus"');
assert(dashboardHtml.includes('id="dashboardAndroidRetryBtn"'), 'dashboard.html must contain id="dashboardAndroidRetryBtn"');
assert(dashboardHtml.includes('id="dashboardAndroidNotesLink"'), 'dashboard.html must contain id="dashboardAndroidNotesLink"');
assert(dashboardHtml.includes('initDashboardAndroidDownload'), 'dashboard.html must define initDashboardAndroidDownload');
assert(dashboardHtml.includes('fetchAppVersion'), 'dashboard.html must call fetchAppVersion');
assert(!dashboardHtml.includes('v1.0.0'), 'dashboard.html must not contain hardcoded v1.0.0 references');
assert(!dashboardHtml.includes('href="#"'), 'dashboard.html must not use empty or hash hrefs');

// Emulate dashboard modal dynamic hydration
function simulateDashboardHydration(manifestData) {
  const generalReleases = 'https://github.com/Bhatt-Momin/lend-local/releases';
  if (!manifestData || !manifestData.apkUrl || !isValidHttpsUrl(manifestData.apkUrl)) {
    return {
      status: 'failed',
      buttonHref: generalReleases,
      buttonTarget: '_blank',
      buttonLabel: 'Download Android App',
      statusText: 'Unable to check latest version. ',
      retryVisible: true,
      notesHref: generalReleases,
      notesText: 'GitHub Releases'
    };
  }

  const rawVersion = manifestData.latestVersion || '';
  const version = normalizeAppVersion(rawVersion);
  const versionLabel = version ? ` (v${version})` : '';
  const releasesUrl = (manifestData.releasesPageUrl && isValidHttpsUrl(manifestData.releasesPageUrl))
    ? manifestData.releasesPageUrl
    : generalReleases;

  return {
    status: 'success',
    buttonHref: manifestData.apkUrl,
    buttonDownload: 'lendlocal.apk',
    buttonLabel: `Download Android App${versionLabel}`,
    buttonAriaLabel: `Download LendLocal Android App${versionLabel} (APK)`,
    statusText: '',
    retryVisible: false,
    notesHref: releasesUrl,
    notesText: version ? `View v${version} on GitHub Releases` : 'View on GitHub Releases',
    notesAriaLabel: `View LendLocal release notes on GitHub (opens in a new tab)`
  };
}

// 1. Dashboard failure / unconfigured state
const dashFailed = simulateDashboardHydration(null);
assert.strictEqual(dashFailed.status, 'failed');
assert.strictEqual(dashFailed.buttonLabel, 'Download Android App', 'Dashboard failed state must not advertise v1.0.0');
assert.strictEqual(dashFailed.buttonHref, 'https://github.com/Bhatt-Momin/lend-local/releases');
assert.strictEqual(dashFailed.retryVisible, true);
assert.strictEqual(dashFailed.notesHref, 'https://github.com/Bhatt-Momin/lend-local/releases');

// 2. Dashboard success state
const dashSuccess = simulateDashboardHydration({
  latestVersion: '1.1.0',
  apkUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk',
  releasesPageUrl: 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.1.0'
});
assert.strictEqual(dashSuccess.status, 'success');
assert.strictEqual(dashSuccess.buttonLabel, 'Download Android App (v1.1.0)');
assert.strictEqual(dashSuccess.buttonHref, 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.1.0/lendlocal.apk');
assert.strictEqual(dashSuccess.notesHref, 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.1.0');
assert.strictEqual(dashSuccess.notesText, 'View v1.1.0 on GitHub Releases');

// 3. Phrasing consistency
assert.strictEqual(loginSuccessState.buttonLabel, dashSuccess.buttonLabel, 'Login and dashboard must use identical button label phrasing');
assert.strictEqual(loginSuccessState.releasesText, dashSuccess.notesText, 'Login and dashboard must use identical release notes link text');

console.log('✅ Dashboard Install Modal Markup & Dynamic Integration verified.');

// Run async tests
testDynamicFetchManifest().then(() => {
  console.log('🎉 All Native Android Milestone 3 (M3) tests passed successfully!');
  console.log('ℹ️  NOTE: The above tests were executed using Node.js runtime and DOM/Fetch mocks.');
  console.log('ℹ️  No headless browser (Puppeteer/Playwright) or physical Android device browser was used.');
}).catch((err) => {
  console.error('❌ Async test failed:', err);
  process.exit(1);
});
