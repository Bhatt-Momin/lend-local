const fs = require('fs');
const assert = require('assert');

// Global Mocks
global.reloaded = false;
global.window = {
  addEventListener: () => {},
  reloadCurrentData: null,
  location: { reload: () => { global.reloaded = true; } },
  dispatchEvent: () => {}
};
const myNavigator = { onLine: true };
global.alert = (msg) => { global.lastAlert = msg; };

class StorageMock {
  getItem(key) { return this.hasOwnProperty(key) ? this[key] : null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
}
Object.defineProperty(StorageMock.prototype, 'getItem', {enumerable: false});
Object.defineProperty(StorageMock.prototype, 'setItem', {enumerable: false});
Object.defineProperty(StorageMock.prototype, 'removeItem', {enumerable: false});

global.sessionStorage = new StorageMock();
global.localStorage = new StorageMock();

class MockElement {
  constructor(id) {
    this.id = id;
    this.style = {};
    this.listeners = {};
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
  }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  async click() { if (this.listeners['click']) await this.listeners['click'](); }
  remove() { if (global.document.body.children[this.id]) delete global.document.body.children[this.id]; }
}

global.document = {
  body: {
    children: {},
    appendChild: (el) => { global.document.body.children[el.id] = el; }
  },
  getElementById: (id) => {
    return global.document.body.children[id] || null;
  },
  createElement: (tag) => new MockElement('new_' + tag)
};

// Evaluate the script in the global context
const apiCode = fs.readFileSync('frontend/js/api.js', 'utf8');
const scriptFn = new Function(
  'window', 'document', 'navigator', 'sessionStorage', 'localStorage', 'alert', 
  apiCode + '\nreturn { api, renderRecoveryPanel, clearSession, saveUnresolvedActions };'
);
const { api, renderRecoveryPanel, clearSession, saveUnresolvedActions } = scriptFn(
  global.window, global.document, myNavigator, global.sessionStorage, global.localStorage, global.alert
);

// We need to inject fetch globally too
let fetchShouldDropBody = false;
let fetchShouldFail = false;
global.fetch = async () => {
  if (fetchShouldFail) throw new TypeError("Failed to fetch");
  return {
    ok: true,
    text: async () => {
      if (fetchShouldDropBody) throw new TypeError("Dropped body");
      return JSON.stringify({ success: true });
    }
  };
};

async function runTests() {
  let exitCode = 0;
  try {
    console.log("--- Testing api.js Uncertain Action Recovery & Lockouts ---");
    
    global.localStorage.setItem('lendlocal_user', JSON.stringify({ id: 'user123' }));
    
    // a) Body-read failure
    fetchShouldDropBody = true;
    try {
      await api('/expenses', { method: 'POST' });
      assert.fail("Should have thrown");
    } catch(e) {
      assert.ok(e.message.includes("Connection lost"), "Error should indicate connection lost");
    }
    fetchShouldDropBody = false;

    const scopedKey = 'lendlocal_unresolved_user123';
    assert.ok(global.sessionStorage.getItem(scopedKey).includes('expenses'), "Expense should be in scoped sessionStorage");
    
    let panel = global.document.body.children['unresolved-recovery-panel'];
    assert.ok(panel, "Recovery panel should be in DOM");

    // b) Auth exclusions
    fetchShouldFail = true;
    try {
      await api('/auth/login', { method: 'POST' });
      assert.fail("Should have thrown");
    } catch(e) {
      assert.ok(e.message.includes("Network error"));
      assert.ok(!global.sessionStorage.getItem(scopedKey).includes('auth'), "Auth should NOT be locked");
    }
    fetchShouldFail = false;

    // c) Persistence across reload
    // Simulate reload by wiping DOM and re-rendering panel
    global.document.body.children = {}; 
    renderRecoveryPanel();
    panel = global.document.body.children['unresolved-recovery-panel'];
    assert.ok(panel.innerHTML.includes('expenses'), "Panel lists expenses after reload");

    // d) Acknowledgment recovery / Review Current Data
    let reloadCalled = false;
    let reloadShouldFail = false;
    global.window.reloadCurrentData = async () => {
      if (reloadShouldFail) throw new Error("Reload mock failed");
      reloadCalled = true; 
    };
    
    // The panel sets innerHTML which has ids "panel-reload" and "panel-unlock"
    // Since our mock DOM doesn't parse innerHTML, we manually attach mock elements to the document
    const reloadBtn = new MockElement('panel-reload');
    const unlockBtn = new MockElement('panel-unlock');
    global.document.body.children['panel-reload'] = reloadBtn;
    global.document.body.children['panel-unlock'] = unlockBtn;
    
    // Re-render to attach listeners to our mocked buttons
    renderRecoveryPanel();
    
    // Verify acknowledgment starts disabled from HTML
    assert.ok(panel.innerHTML.match(/id="panel-unlock"[^>]*disabled/), "Unlock button is disabled in HTML initially");
    
    // Since mock elements don't sync with innerHTML, manually apply the initial state
    unlockBtn.disabled = true;

    // First, test reload failure propagation
    reloadShouldFail = true;
    await reloadBtn.click();
    assert.strictEqual(global.lastAlert, "Reload mock failed", "Reload failure propagated to alert");
    assert.strictEqual(reloadBtn.disabled, false, "Reload button re-enabled on failure");
    assert.strictEqual(unlockBtn.disabled, true, "Unlock button stays disabled on failure");
    
    // Next, test reload success
    reloadShouldFail = false;
    await reloadBtn.click();
    assert.ok(reloadCalled, "Reload was called");
    assert.strictEqual(reloadBtn.textContent, 'Data Refreshed', "Button text updated");
    assert.strictEqual(unlockBtn.disabled, false, "Unlock is enabled after successful reload");
    
    await unlockBtn.click();
    
    assert.ok(!global.sessionStorage.getItem(scopedKey).includes('expenses'), "Expenses removed from session storage");
    
    // e) Logout cleanup
    saveUnresolvedActions(new Set(['groups']));
    clearSession();
    assert.strictEqual(global.sessionStorage.getItem(scopedKey), null, "Session storage cleared on logout");

    // 3. Test offline.html logic
    console.log("--- Testing offline.html Repeated Retry Failure ---");
    const offlineHtml = fs.readFileSync('frontend/offline.html', 'utf8');
    const scriptMatch = offlineHtml.match(/<script>([\s\S]*?)<\/script>/);
    const offlineScript = scriptMatch[1];
    
    const retryBtnMockOffline = new MockElement('retryBtn');
    const msgMockOffline = new MockElement('offlineMsg');
    global.document.body.children['retryBtn'] = retryBtnMockOffline;
    global.document.body.children['offlineMsg'] = msgMockOffline;
    
    // Evaluate script using Function constructor
    const offlineFn = new Function('window', 'document', 'navigator', 'setTimeout', 'clearTimeout', 'AbortController', 'fetch', offlineScript + '\nreturn { checkAndReload };');
    
    let mockFetchCalled = false;
    const mockFetchOffline = async () => { mockFetchCalled = true; throw new Error("Network down"); };
    
    class AbortController { abort(){} get signal(){return null;} }
    
    const { checkAndReload } = offlineFn(global.window, global.document, global.navigator, setTimeout, clearTimeout, AbortController, mockFetchOffline);
    
    global.reloaded = false;
    await checkAndReload();
    assert.ok(mockFetchCalled, "Fetch was called");
    assert.strictEqual(global.reloaded, false, "Did not reload loop on failure");
    assert.strictEqual(msgMockOffline.textContent, "Connect to the internet to load your groups and save changes.", "Gracefully reverted to offline state");
    
    console.log("✅ All tests passed successfully!");
  } catch (err) {
    console.error("❌ Test failed:", err);
    exitCode = 1;
  }
  process.exit(exitCode);
}
runTests();
