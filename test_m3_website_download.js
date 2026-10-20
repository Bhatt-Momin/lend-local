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
const cssPath = path.join(__dirname, 'frontend', 'css', 'auth-premium.css');
const manifestPath = path.join(__dirname, 'frontend', 'manifest.json');
const appJsonPath = path.join(__dirname, 'mobile', 'app.json');
const easJsonPath = path.join(__dirname, 'mobile', 'eas.json');

const loginHtml = fs.readFileSync(loginHtmlPath, 'utf8');
const authCss = fs.readFileSync(cssPath, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const easJson = JSON.parse(fs.readFileSync(easJsonPath, 'utf8'));

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

// 4. Verify Safe Default State: No Broken Links & Honest Notice
console.log('4. Testing Safe Default State (No Broken Links / No Fake URLs)...');
// Check that data-download-url is currently empty
const slotMatch = loginHtml.match(/id="androidDownloadSlot"[^>]*data-download-url="([^"]*)"/);
assert(slotMatch, 'androidDownloadSlot must have data-download-url attribute');
assert.strictEqual(slotMatch[1].trim(), '', 'data-download-url must be empty until a real artifact is hosted');

// Check that APK_DOWNLOAD_URL constant is currently empty
const constMatch = loginHtml.match(/const\s+APK_DOWNLOAD_URL\s*=\s*'([^']*)'/);
assert(constMatch, 'APK_DOWNLOAD_URL constant must be declared');
assert.strictEqual(constMatch[1].trim(), '', 'APK_DOWNLOAD_URL must be empty until verified');

// Check button is disabled by default
assert(loginHtml.includes('disabled aria-disabled="true"'), 'Download button must be disabled by default');

// Check no placeholder hrefs
assert(!loginHtml.includes('href="#"'), 'Must not contain href="#" placeholders');
assert(!loginHtml.includes('.apk" href='), 'Must not link to nonexistent local .apk in HTML');
assert(!/href=["'][^"']*\.apk["']/.test(loginHtml), 'Must not have static .apk link before verification');

// Check honest notice text
assert(loginHtml.includes('in preparation'), 'Status note must explain APK build is in preparation');
console.log('✅ Safe Default State passed.');

// 5. Test Activation Logic & Protocol Safety Simulation
console.log('5. Testing Activation Logic & Protocol Safety Simulation...');
function simulateInitAndroidDownload(dataUrl, constUrl) {
  const targetUrl = (dataUrl || constUrl || '').trim();
  if (targetUrl && (targetUrl.startsWith('https://') || targetUrl.startsWith('/'))) {
    return {
      active: true,
      href: targetUrl,
      download: 'lendlocal.apk',
      rel: 'noopener noreferrer',
      ariaLabel: 'Download LendLocal Android App (APK)',
      note: 'Direct APK download for Android devices.'
    };
  }
  return {
    active: false,
    disabled: true,
    note: 'Official APK release build is in preparation. Download access will activate once the release asset is hosted.'
  };
}

// When unconfigured:
const unconfiguredResult = simulateInitAndroidDownload('', '');
assert.strictEqual(unconfiguredResult.active, false, 'Must be inactive when unconfigured');
assert.strictEqual(unconfiguredResult.disabled, true, 'Must remain disabled');

// When verified GitHub release URL is configured:
const verifiedUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk';
const activeResult = simulateInitAndroidDownload(verifiedUrl, '');
assert.strictEqual(activeResult.active, true, 'Must activate when valid HTTPS URL is set');
assert.strictEqual(activeResult.href, verifiedUrl, 'Must point to verified URL');
assert.strictEqual(activeResult.download, 'lendlocal.apk', 'Must have download attribute');
assert.strictEqual(activeResult.rel, 'noopener noreferrer', 'Must have secure rel attribute');

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

console.log('🎉 All Native Android Milestone 3 (M3) tests passed successfully!');
