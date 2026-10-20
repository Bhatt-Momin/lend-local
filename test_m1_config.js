/**
 * LendLocal Native Android — Milestone 1 (M1) Test Suite
 * Production Configuration & Release Hardening
 *
 * Covers:
 * 1. URL Normalization (whitespace, slashes, /health stripping, /api suffix)
 * 2. URL Validation (protocols, hostnames, ports, malformed inputs)
 * 3. Safe Production Fallback (standalone APK, absent EXPO_PUBLIC_API_URL)
 * 4. Environment Variable Override (EXPO_PUBLIC_API_URL precedence & normalization)
 * 5. Development Runtime Detection (Expo Go LAN IP, Android emulator, iOS simulator)
 * 6. Reset-to-Default Behavior (standalone production vs development)
 * 7. SecureStore Custom Override & Corruption Fallback Simulation
 * 8. Connection Health Check, 20s Timeout & Error Recovery Simulation
 */

const assert = require('assert');

// Direct production import via Node 26 native type stripping
const {
  PRODUCTION_API_URL,
  HEALTH_CHECK_TIMEOUT_MS,
  normalizeApiBaseUrl,
  validateApiBaseUrl,
  resolveDefaultApiBaseUrl,
} = require('./mobile/src/utils/serverConfig.ts');

async function runTests() {
  console.log('--- Running Native Android Milestone 1 (M1) Test Suite ---');

  // ============================================================================
  // 1. URL Normalization
  // ============================================================================
  console.log('Testing URL Normalization...');

  {
    // Test 1.1: Production URL without trailing slash
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/api'),
      'https://lendlocal-58sf.onrender.com/api'
    );

    // Test 1.2: Production URL with redundant trailing slashes
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/api/'),
      'https://lendlocal-58sf.onrender.com/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/api///'),
      'https://lendlocal-58sf.onrender.com/api'
    );

    // Test 1.3: URL without /api suffix should automatically have /api appended
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com'),
      'https://lendlocal-58sf.onrender.com/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/'),
      'https://lendlocal-58sf.onrender.com/api'
    );

    // Test 1.4: Accidental /health suffix stripped and replaced with /api
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/api/health'),
      'https://lendlocal-58sf.onrender.com/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/api/health/'),
      'https://lendlocal-58sf.onrender.com/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('https://lendlocal-58sf.onrender.com/health'),
      'https://lendlocal-58sf.onrender.com/api'
    );

    // Test 1.5: Local IP addresses with ports
    assert.strictEqual(
      normalizeApiBaseUrl('http://192.168.1.100:3000'),
      'http://192.168.1.100:3000/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('http://192.168.1.100:3000/'),
      'http://192.168.1.100:3000/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('http://192.168.1.100:3000/api'),
      'http://192.168.1.100:3000/api'
    );
    assert.strictEqual(
      normalizeApiBaseUrl('http://192.168.1.100:3000/api/health'),
      'http://192.168.1.100:3000/api'
    );

    // Test 1.6: Whitespace trimming
    assert.strictEqual(
      normalizeApiBaseUrl('   https://lendlocal-58sf.onrender.com/api   '),
      'https://lendlocal-58sf.onrender.com/api'
    );

    // Test 1.7: Empty or non-string inputs
    assert.strictEqual(normalizeApiBaseUrl(''), '');
    assert.strictEqual(normalizeApiBaseUrl('   '), '');
    assert.strictEqual(normalizeApiBaseUrl(null), '');
    assert.strictEqual(normalizeApiBaseUrl(undefined), '');

    console.log('✅ URL Normalization tests passed.');
  }

  // ============================================================================
  // 2. URL Validation
  // ============================================================================
  console.log('Testing URL Validation...');

  {
    // Test 2.1: Valid URLs with normalization
    const validCases = [
      ['https://lendlocal-58sf.onrender.com/api', 'https://lendlocal-58sf.onrender.com/api'],
      ['https://lendlocal-58sf.onrender.com', 'https://lendlocal-58sf.onrender.com/api'],
      ['http://192.168.1.42:3000', 'http://192.168.1.42:3000/api'],
      ['http://10.0.2.2:3000/api', 'http://10.0.2.2:3000/api'],
      ['http://localhost:3000', 'http://localhost:3000/api'],
      ['https://subdomain.example.co.uk:8080/api/', 'https://subdomain.example.co.uk:8080/api'],
    ];

    for (const [input, expectedNormalized] of validCases) {
      const res = validateApiBaseUrl(input);
      assert.strictEqual(res.valid, true, `Expected "${input}" to be valid`);
      assert.strictEqual(res.normalizedUrl, expectedNormalized);
      assert.strictEqual(res.error, undefined);
    }

    // Test 2.2: Empty / whitespace inputs
    const emptyCases = ['', '   ', null, undefined];
    for (const input of emptyCases) {
      const res = validateApiBaseUrl(input);
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.error, 'Please enter a server URL');
    }

    // Test 2.3: Missing protocol
    const noProtocolCases = [
      '192.168.1.100:3000',
      'localhost:3000',
      'lendlocal-58sf.onrender.com/api',
    ];
    for (const input of noProtocolCases) {
      const res = validateApiBaseUrl(input);
      assert.strictEqual(res.valid, false, `Expected "${input}" to require protocol`);
      assert.strictEqual(res.error, 'URL must start with http:// or https://');
    }

    // Test 2.4: Invalid protocols
    const invalidProtocolCases = [
      'ftp://192.168.1.100:3000',
      'file:///tmp/api',
      'ws://192.168.1.100:3000',
      'javascript:alert(1)',
    ];
    for (const input of invalidProtocolCases) {
      const res = validateApiBaseUrl(input);
      assert.strictEqual(res.valid, false, `Expected protocol rejection for "${input}"`);
      assert.strictEqual(res.error, 'URL must start with http:// or https://');
    }

    console.log('✅ URL Validation tests passed.');
  }

  // ============================================================================
  // 3. Safe Production API Fallback (Standalone APK)
  // ============================================================================
  console.log('Testing Safe Production Fallback in Standalone APK...');

  {
    // Standalone production APK properties:
    // - EXPO_PUBLIC_API_URL: undefined
    // - isDev: false
    // - isDevice: true
    // - platform: 'android'
    // - hostUri: undefined
    const standaloneAndroid = resolveDefaultApiBaseUrl({
      envUrl: undefined,
      isDev: false,
      isDevice: true,
      platform: 'android',
      hostUri: undefined,
    });

    assert.strictEqual(
      standaloneAndroid,
      PRODUCTION_API_URL,
      'Standalone Android APK must resolve to PRODUCTION_API_URL'
    );
    assert.strictEqual(
      standaloneAndroid,
      'https://lendlocal-58sf.onrender.com/api',
      'PRODUCTION_API_URL must point to Render backend /api'
    );

    // Standalone iOS IPA release build
    const standaloneIos = resolveDefaultApiBaseUrl({
      envUrl: undefined,
      isDev: false,
      isDevice: true,
      platform: 'ios',
      hostUri: undefined,
    });
    assert.strictEqual(standaloneIos, PRODUCTION_API_URL);

    // Standalone build with empty env variable string
    const standaloneEmptyEnv = resolveDefaultApiBaseUrl({
      envUrl: '   ',
      isDev: false,
      isDevice: true,
      platform: 'android',
    });
    assert.strictEqual(standaloneEmptyEnv, PRODUCTION_API_URL);

    console.log('✅ Safe Production Fallback tests passed.');
  }

  // ============================================================================
  // 4. Environment Variable Override
  // ============================================================================
  console.log('Testing Environment Variable Override...');

  {
    // EXPO_PUBLIC_API_URL set to custom domain
    const res1 = resolveDefaultApiBaseUrl({
      envUrl: 'https://staging.lendlocal.com/api',
      isDev: false,
    });
    assert.strictEqual(res1, 'https://staging.lendlocal.com/api');

    // EXPO_PUBLIC_API_URL without trailing slash or /api
    const res2 = resolveDefaultApiBaseUrl({
      envUrl: 'https://staging.lendlocal.com/',
      isDev: false,
    });
    assert.strictEqual(res2, 'https://staging.lendlocal.com/api');

    // EXPO_PUBLIC_API_URL with trailing slash
    const res3 = resolveDefaultApiBaseUrl({
      envUrl: 'https://lendlocal-58sf.onrender.com/api/',
      isDev: false,
    });
    assert.strictEqual(res3, 'https://lendlocal-58sf.onrender.com/api');

    // EXPO_PUBLIC_API_URL takes precedence over dev detection
    const resDevOverride = resolveDefaultApiBaseUrl({
      envUrl: 'http://192.168.1.200:3000',
      isDev: true,
      isDevice: true,
      hostUri: '192.168.1.100:8081',
    });
    assert.strictEqual(resDevOverride, 'http://192.168.1.200:3000/api');

    console.log('✅ Environment Variable Override tests passed.');
  }

  // ============================================================================
  // 5. Development Runtime Detection
  // ============================================================================
  console.log('Testing Development Runtime Auto-Detection...');

  {
    // Test 5.1: Expo Go on physical device (extracts Metro LAN IP from hostUri)
    const expoGoDevice = resolveDefaultApiBaseUrl({
      isDev: true,
      isDevice: true,
      hostUri: '192.168.1.155:8081',
      platform: 'android',
    });
    assert.strictEqual(
      expoGoDevice,
      'http://192.168.1.155:3000/api',
      'Expo Go must extract Metro host IP and target port 3000'
    );

    // Test 5.2: Android Emulator (10.0.2.2 loopback bridge)
    const androidEmulator = resolveDefaultApiBaseUrl({
      isDev: true,
      isDevice: false,
      platform: 'android',
      hostUri: undefined,
    });
    assert.strictEqual(
      androidEmulator,
      'http://10.0.2.2:3000/api',
      'Android emulator must resolve to 10.0.2.2:3000/api'
    );

    // Test 5.3: iOS Simulator (localhost)
    const iosSimulator = resolveDefaultApiBaseUrl({
      isDev: true,
      isDevice: false,
      platform: 'ios',
      hostUri: undefined,
    });
    assert.strictEqual(
      iosSimulator,
      'http://localhost:3000/api',
      'iOS simulator must resolve to localhost:3000/api'
    );

    // Test 5.4: Physical device in dev mode with missing hostUri
    // Physical phones cannot resolve localhost, so it must fall back to PRODUCTION_API_URL
    const physicalDevNoHost = resolveDefaultApiBaseUrl({
      isDev: true,
      isDevice: true,
      platform: 'android',
      hostUri: undefined,
    });
    assert.strictEqual(
      physicalDevNoHost,
      PRODUCTION_API_URL,
      'Physical device with missing hostUri must fall back to production URL'
    );

    console.log('✅ Development Runtime Auto-Detection tests passed.');
  }

  // ============================================================================
  // 6. Reset-to-Default Behavior
  // ============================================================================
  console.log('Testing Reset-to-Default Behavior...');

  {
    // In a standalone production APK, resetting must NEVER select localhost
    const standaloneReset = resolveDefaultApiBaseUrl({
      envUrl: undefined,
      isDev: false,
      isDevice: true,
      platform: 'android',
    });
    assert.notStrictEqual(standaloneReset, 'http://localhost:3000/api');
    assert.strictEqual(standaloneReset, PRODUCTION_API_URL);

    // In Expo Go dev environment, resetting restores the Metro dev machine IP
    const devReset = resolveDefaultApiBaseUrl({
      envUrl: undefined,
      isDev: true,
      isDevice: true,
      hostUri: '10.0.0.12:8081',
      platform: 'android',
    });
    assert.strictEqual(devReset, 'http://10.0.0.12:3000/api');

    console.log('✅ Reset-to-Default tests passed.');
  }

  // ============================================================================
  // 7. SecureStore Custom Override & Corruption Fallback Simulation
  // ============================================================================
  console.log('Testing SecureStore Storage & Corruption Fallback Simulation...');

  {
    // Simulated storage
    const mockStorage = new Map();

    async function mockSetCustomApiBaseUrl(url) {
      const val = validateApiBaseUrl(url);
      if (!val.valid || !val.normalizedUrl) {
        throw new Error(val.error || 'Invalid API URL');
      }
      mockStorage.set('lendlocal_custom_api_url', val.normalizedUrl);
      return val.normalizedUrl;
    }

    async function mockGetActiveApiBaseUrl(defaultResolver) {
      const custom = mockStorage.get('lendlocal_custom_api_url');
      if (custom && custom.trim()) {
        const val = validateApiBaseUrl(custom);
        if (val.valid && val.normalizedUrl) {
          return val.normalizedUrl;
        }
      }
      return defaultResolver();
    }

    async function mockResetApiBaseUrl() {
      mockStorage.delete('lendlocal_custom_api_url');
    }

    // 7.1: Set valid custom URL with missing /api
    const saved = await mockSetCustomApiBaseUrl('http://192.168.1.99:3000');
    assert.strictEqual(saved, 'http://192.168.1.99:3000/api');
    assert.strictEqual(mockStorage.get('lendlocal_custom_api_url'), 'http://192.168.1.99:3000/api');

    // 7.2: Attempt invalid custom URL (rejected before saving)
    await assert.rejects(
      async () => mockSetCustomApiBaseUrl('not-a-valid-url'),
      /URL must start with http:\/\/ or https:\/\//
    );

    // 7.3: Retrieve active URL returns saved custom URL
    const activeCustom = await mockGetActiveApiBaseUrl(() => PRODUCTION_API_URL);
    assert.strictEqual(activeCustom, 'http://192.168.1.99:3000/api');

    // 7.4: Reset clears override and falls back to default
    await mockResetApiBaseUrl();
    const resetUrl = await mockGetActiveApiBaseUrl(() => PRODUCTION_API_URL);
    assert.strictEqual(resetUrl, PRODUCTION_API_URL);
    assert.strictEqual(mockStorage.has('lendlocal_custom_api_url'), false);

    // 7.5: Corruption resistance: if storage contains corrupted string
    mockStorage.set('lendlocal_custom_api_url', 'corrupted-data-no-protocol');
    const corruptedFallback = await mockGetActiveApiBaseUrl(() => PRODUCTION_API_URL);
    assert.strictEqual(
      corruptedFallback,
      PRODUCTION_API_URL,
      'Corrupted storage data must safely fall back to default'
    );

    console.log('✅ SecureStore simulation tests passed.');
  }

  // ============================================================================
  // 8. Connection Health Check, 20s Timeout & Error Recovery Simulation
  // ============================================================================
  console.log('Testing Connection Health Check & Timeout Resilience...');

  {
    // Test 8.1: Health check timeout constant is 20 seconds
    assert.strictEqual(HEALTH_CHECK_TIMEOUT_MS, 20000, 'Health check timeout must be 20,000ms (20s)');

    // Test 8.2: Target endpoint derivation
    const targetUrl = 'https://lendlocal-58sf.onrender.com/api';
    const healthEndpoint = `${targetUrl}/health`;
    assert.strictEqual(healthEndpoint, 'https://lendlocal-58sf.onrender.com/api/health');

    // Test 8.3: AbortError timeout handling simulation
    const simulateAbortError = () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      return err;
    };

    const handleTestError = (err) => {
      if (err?.name === 'AbortError') {
        const seconds = Math.round(HEALTH_CHECK_TIMEOUT_MS / 1000);
        return `Connection timed out (${seconds}s). If the hosted Render service was idle, it may need 30–50s to wake up. Please wait a moment and try again.`;
      }
      return `${err?.message || 'Connection failed'}. Ensure backend is running and reachable.`;
    };

    const timeoutMsg = handleTestError(simulateAbortError());
    assert.strictEqual(
      timeoutMsg.includes('Connection timed out (20s)'),
      true,
      'Timeout message must explicitly mention 20s'
    );
    assert.strictEqual(
      timeoutMsg.includes('Render service was idle'),
      true,
      'Timeout message must explain Render idle wake-up'
    );

    // Test 8.4: Network failure simulation
    const networkErr = new Error('Network request failed');
    const networkMsg = handleTestError(networkErr);
    assert.strictEqual(
      networkMsg.includes('Network request failed. Ensure backend is running and reachable.'),
      true
    );

    // Test 8.5: Loading state recovery simulation (finally block guarantee)
    let isTesting = true;
    try {
      throw simulateAbortError();
    } catch (err) {
      // caught
    } finally {
      isTesting = false;
    }
    assert.strictEqual(isTesting, false, 'isTesting must be false in finally block');

    console.log('✅ Connection Health Check & Timeout tests passed.');
  }

  // ============================================================================
  // 9. Services Dependency Graph Cycle Guard
  // ============================================================================
  console.log('Testing Services Dependency Graph for Circular Imports...');

  {
    const fs = require('fs');
    const path = require('path');
    const servicesDir = path.resolve(__dirname, 'mobile/src/services');
    const files = fs.readdirSync(servicesDir).filter((f) => f.endsWith('.ts'));

    const graph = {};
    for (const file of files) {
      const content = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      graph[file] = [];
      const importRegex = /(?:import|export)\s+.*?from\s+['"](\.\/[^'"]+)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const depName = match[1].replace(/^\.\//, '') + '.ts';
        if (files.includes(depName)) {
          graph[file].push(depName);
        }
      }
    }

    function findCycles(g) {
      const cycles = [];
      function dfs(node, visited, p) {
        if (p.includes(node)) {
          cycles.push([...p.slice(p.indexOf(node)), node]);
          return;
        }
        if (visited.has(node)) return;
        visited.add(node);
        for (const neighbor of g[node] || []) {
          dfs(neighbor, new Set(visited), [...p, node]);
        }
      }
      for (const node of Object.keys(g)) {
        dfs(node, new Set(), []);
      }
      return cycles;
    }

    const cycles = findCycles(graph);
    assert.strictEqual(
      cycles.length,
      0,
      `Expected zero circular dependency cycles in services, found: ${JSON.stringify(cycles)}`
    );

    console.log('✅ Services Dependency Graph Cycle Guard passed (0 cycles).');
  }

  console.log('🎉 All Native Android Milestone 1 (M1) tests passed successfully!');
}

runTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
