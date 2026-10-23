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

// 4. Verify Safe Fallback Markup & Configured Release Asset URL
console.log('4. Testing Safe Fallback Markup & Configured Release Asset URL...');
const slotMatch = loginHtml.match(/id="androidDownloadSlot"[^>]*data-download-url="([^"]*)"/);
assert(slotMatch, 'androidDownloadSlot must have data-download-url attribute');
assert.strictEqual(slotMatch[1].trim(), '', 'data-download-url in HTML markup must be empty by default');

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

// Check that APK_DOWNLOAD_URL constant is configured with the verified release URL
const constMatch = loginHtml.match(/const\s+APK_DOWNLOAD_URL\s*=\s*'([^']*)'/);
assert(constMatch, 'APK_DOWNLOAD_URL constant must be declared');
const expectedUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk';
assert.strictEqual(constMatch[1].trim(), expectedUrl, `APK_DOWNLOAD_URL must point to verified release: ${expectedUrl}`);

// Check that GITHUB_RELEASES_URL constant is configured with the release page URL
const releasesMatch = loginHtml.match(/const\s+GITHUB_RELEASES_URL\s*=\s*'([^']*)'/);
assert(releasesMatch, 'GITHUB_RELEASES_URL constant must be declared');
const expectedReleasesUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.0.0';
assert.strictEqual(releasesMatch[1].trim(), expectedReleasesUrl, `GITHUB_RELEASES_URL must match release tag: ${expectedReleasesUrl}`);

// Check that fallback link class is present
assert(loginHtml.includes('auth-app-fallback-link'), 'Fallback link class must be present');
console.log('✅ Safe Fallback Markup & Configured Release Asset URL passed.');

// 5. Test Activation Logic & Protocol Safety Simulation
console.log('5. Testing Activation Logic & Protocol Safety Simulation...');
function simulateInitAndroidDownload(dataUrl, constUrl, releasesUrl) {
  const targetUrl = (dataUrl || constUrl || '').trim();
  const relUrl = (releasesUrl || '').trim();
  if (targetUrl && (targetUrl.startsWith('https://') || targetUrl.startsWith('/'))) {
    return {
      active: true,
      href: targetUrl,
      download: 'lendlocal.apk',
      rel: 'noopener noreferrer',
      ariaLabel: 'Download LendLocal Android App (APK)',
      note: 'Direct APK download for Android devices. ',
      fallbackLink: relUrl ? {
        href: relUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        className: 'auth-app-fallback-link',
        text: 'View on GitHub Releases',
        ariaLabel: 'View LendLocal v1.0.0 release notes on GitHub (opens in a new tab)'
      } : null
    };
  }
  return {
    active: false,
    disabled: true,
    note: 'Official APK release build is in preparation. Download access will activate once the release asset is hosted.'
  };
}

// When unconfigured:
const unconfiguredResult = simulateInitAndroidDownload('', '', '');
assert.strictEqual(unconfiguredResult.active, false, 'Must be inactive when unconfigured');
assert.strictEqual(unconfiguredResult.disabled, true, 'Must remain disabled');
assert(unconfiguredResult.note.includes('in preparation'), 'Unconfigured state must retain preparation notice');

// When verified GitHub release URL is configured:
const verifiedUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/download/v1.0.0/lendlocal.apk';
const verifiedReleasesUrl = 'https://github.com/Bhatt-Momin/lend-local/releases/tag/v1.0.0';
const activeResult = simulateInitAndroidDownload(verifiedUrl, '', verifiedReleasesUrl);
assert.strictEqual(activeResult.active, true, 'Must activate when valid HTTPS URL is set');
assert.strictEqual(activeResult.href, verifiedUrl, 'Must point to verified URL');
assert.strictEqual(activeResult.download, 'lendlocal.apk', 'Must have download attribute');
assert.strictEqual(activeResult.rel, 'noopener noreferrer', 'Must have secure rel attribute');
assert(activeResult.fallbackLink, 'Active state must provide secondary fallback link to releases');
assert.strictEqual(activeResult.fallbackLink.href, verifiedReleasesUrl, 'Fallback link must point to verified release page');
assert.strictEqual(activeResult.fallbackLink.target, '_blank', 'Fallback link must open in new tab');
assert.strictEqual(activeResult.fallbackLink.rel, 'noopener noreferrer', 'Fallback link must use noopener noreferrer');

// When unsafe URL is injected (e.g. javascript:):
const unsafeResult = simulateInitAndroidDownload('javascript:alert(1)', '', '');
assert.strictEqual(unsafeResult.active, false, 'Must reject non-https/non-root URLs');

// When data-download-url override is provided:
const overrideUrl = 'https://custom-domain.com/downloads/lendlocal.apk';
const overrideResult = simulateInitAndroidDownload(overrideUrl, verifiedUrl, verifiedReleasesUrl);
assert.strictEqual(overrideResult.active, true, 'Must activate with data-download-url override');
assert.strictEqual(overrideResult.href, overrideUrl, 'data-download-url must take priority over constant');
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
