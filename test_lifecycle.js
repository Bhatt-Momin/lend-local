const fs = require('fs');
const assert = require('assert');

// 1. Load the shared production helpers
const { parseReturnUrl, createLoaderQueue } = require('./frontend/js/helpers.js');

class Element {
  constructor(tag) {
    this.tagName = tag ? tag.toUpperCase() : '';
    this.id = '';
    this.className = '';
    this.classList = {
      contains: (c) => this.className.includes(c),
      add: (c) => this.className += ' ' + c,
      remove: (c) => this.className = this.className.replace(c, '')
    };
    this.style = { cssText: '', display: '' };
    this.children = [];
    this.value = '';
    this.defaultValue = '';
    this.type = 'text';
    this.checked = false;
    this.defaultChecked = false;
    this.options = [];
    this.selectedIndex = -1;
    this._parent = null;
    this.textContent = '';
  }
  addEventListener(evt, cb) {
    this['on' + evt] = cb;
  }
  focus() {}
  appendChild(child) {
    child._parent = this;
    this.children.push(child);
  }
  remove() {
    if (this._parent) {
      this._parent.children = this._parent.children.filter(c => c !== this);
    }
  }
  closest(selector) {
    let el = this;
    while (el) {
      if (selector.includes('modal-backdrop') && el.className.includes('modal-backdrop')) return el;
      if (selector.includes('[role="dialog"]') && el.role === 'dialog') return el;
      el = el._parent;
    }
    return null;
  }
  querySelector(selector) {
    let result = null;
    if (selector.includes('button')) {
      result = this.children.find(c => c.tagName === 'BUTTON' && !c.className.includes('btn-ghost'));
    }
    if (!result) {
      for (const child of this.children) {
        result = child.querySelector(selector);
        if (result) return result;
      }
    }
    return result;
  }
}

const mockDoc = {
  body: new Element('body'),
  head: new Element('head'),
  elements: {},
  getElementById(id) {
    if (this.elements[id]) return this.elements[id];
    let el = this.body.children.find(c => c.id === id);
    if (el) return el;
    if (id === 'pwa-update-toast') return null;
    el = new Element('div');
    el.id = id;
    this.elements[id] = el;
    this.body.appendChild(el);
    return el;
  },
  createElement(tag) { return new Element(tag); },
  querySelectorAll(selector) {
    if (selector.includes('input')) return Object.values(this.elements);
    return [];
  },
  addEventListener() {}
};

global.document = mockDoc;
let reloadCount = 0;
global.window = {
  matchMedia: () => ({ addEventListener: () => {}, matches: false }),
  location: { reload: () => { reloadCount++; } },
  isPaymentActive: false,
  isPaymentRequestInFlight: false,
  addEventListener: (e, cb) => { if (e === 'load') window.onload = cb; },
  Event: class {},
  dispatchEvent: () => {}
};
Object.defineProperty(global, 'navigator', { value: { serviceWorker: { addEventListener: () => {} } }, configurable: true, writable: true });
global.alert = () => {};

let capturedSWRegister = null;
let updatefoundHandler = null;
let controllerchangeHandler = null;
global.navigator.serviceWorker.addEventListener = (evt, handler) => {
  if (evt === 'controllerchange') controllerchangeHandler = handler;
};
global.navigator.serviceWorker.register = async (url) => {
  capturedSWRegister = {
    scope: url,
    addEventListener: (evt, handler) => { if (evt === 'updatefound') updatefoundHandler = handler; }
  };
  return capturedSWRegister;
};

// Evaluate pwa.js
const pwaCode = fs.readFileSync('frontend/js/pwa.js', 'utf8');
eval(pwaCode);

(async () => {
  try {
    if (window.onload) await window.onload();
    
    let skipWaitingCalled = false;
    let statechangeHandler = null;
    capturedSWRegister.installing = {
      postMessage: (msg) => { if (msg === 'SKIP_WAITING') skipWaitingCalled = true; },
      state: 'installed',
      addEventListener: (evt, handler) => {
        if (evt === 'statechange') {
           statechangeHandler = handler;
        }
      }
    };
    if (updatefoundHandler) updatefoundHandler();
    if (statechangeHandler) {
       global.navigator.serviceWorker.controller = {}; 
       statechangeHandler();
    }
    
    const toast = mockDoc.getElementById('pwa-update-toast');
    assert.ok(toast, "Update banner should appear");
    const updateBtn = toast.querySelector('button.btn:not(.btn-ghost)');
    assert.ok(updateBtn, "Update button should exist");
    
    console.log("--- Testing PWA Update Guards ---");
    // Assert Unrequested controllerchange: zero reloads
    reloadCount = 0;
    
    if (controllerchangeHandler) controllerchangeHandler();
    assert.strictEqual(reloadCount, 0, "Unrequested controllerchange: zero reloads");

    window.isPaymentActive = true;
    window.isPaymentRequestInFlight = false;
    updateBtn.onclick();
    assert.strictEqual(skipWaitingCalled, false, "Should block update when payment active");
    
    window.isPaymentActive = false;
    window.isPaymentRequestInFlight = true;
    updateBtn.onclick();
    assert.strictEqual(skipWaitingCalled, false, "Should block update when payment request in flight");
    
    window.isPaymentActive = false;
    window.isPaymentRequestInFlight = false;
    updateBtn.onclick();
    assert.strictEqual(skipWaitingCalled, true, "Update requested");
    if (controllerchangeHandler) controllerchangeHandler();
    if (controllerchangeHandler) controllerchangeHandler(); // second event should be ignored
    assert.strictEqual(reloadCount, 1, "Accepted update: exactly one reload");

    console.log("✅ PWA Update Guards passed");

    console.log("--- Testing Loaders Overlap Logic ---");
    let apiCallCount = 0;
    let resolveApi = null;
    const loadQueue = createLoaderQueue(() => {
      apiCallCount++;
      return new Promise(r => resolveApi = r);
    });

    const p1 = loadQueue.load(false);
    assert.strictEqual(apiCallCount, 1, "First read started");
    const p2 = loadQueue.load(true);
    assert.strictEqual(apiCallCount, 1, "Second read queued but not started yet");
    const p3 = loadQueue.load(false);
    
    resolveApi(); 
    await p1; 
    await new Promise(r => setImmediate(r));
    assert.strictEqual(apiCallCount, 2, "Second fresh read started after first finished");
    resolveApi(); 
    await p2;
    await p3;
    
    let failed = false;
    const failQueue = createLoaderQueue(() => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error("Fail"));
      }
      return Promise.resolve("Success");
    });
    try {
      await failQueue.load();
      assert.fail("Should have rejected");
    } catch(e) {
      assert.strictEqual(e.message, "Fail", "Failed read propagates error");
    }
    const res = await failQueue.load();
    assert.strictEqual(res, "Success", "Next load can proceed");
    console.log("✅ Loaders Overlap Logic passed");

    console.log("--- Testing URL parsing for Login Return ---");
    assert.strictEqual(parseReturnUrl('/group.html?id=123', 'https://app.lendlocal.com'), '/group.html?id=123');
    assert.strictEqual(parseReturnUrl('https://evil.com/group.html', 'https://app.lendlocal.com'), '/dashboard.html');
    assert.strictEqual(parseReturnUrl('//evil.com/group.html', 'https://app.lendlocal.com'), '/dashboard.html');
    assert.strictEqual(parseReturnUrl('/login.html', 'https://app.lendlocal.com'), '/dashboard.html');
    console.log("✅ URL Parsing Logic passed");

    console.log("--- Testing Payment Handlers ---");
    global.groupId = "123";
    global.requireAuth = () => true;
    global.showUser = () => {};
    global.showAlert = () => {};
    global.hideAlert = () => {};
    global.escapeHtml = () => '';
    global.fillUserChip = () => {};
    global.wireLogout = () => {};
    global.setupThemeToggle = () => {};
    global.calculateTotalBalance = () => {};
    global.renderBalances = () => {};
    global.renderExpenses = () => {};
    global.renderGroupTitle = () => {};
    global.closePaymentMethodModal = () => {};
    global.startUpiPayment = () => {};
    global.restoreFocusSafe = () => {};
    global.getUser = () => ({ uid: "test-user" });
    global.formatMoney = () => "$0.00";
    global.api = async () => ({ group: { id: '123', name: 'Test', members: [] }, expenses: [], balances: [], intents: [] });
    global.URLSearchParams = class { get(k) { return k === 'id' ? '123' : null; } };
    mockDoc.body.innerHTML = '';
    const paymentModal = new Element('div');
    paymentModal.id = 'paymentMethodModal';
    mockDoc.elements['paymentMethodModal'] = paymentModal;
    mockDoc.body.appendChild(paymentModal);
    
    const upiModal = new Element('div');
    upiModal.id = 'upiPayerModal';
    mockDoc.elements['upiPayerModal'] = upiModal;
    const btnClaim = new Element('button');
    btnClaim.id = 'btnUpiClaim';
    mockDoc.elements['btnUpiClaim'] = btnClaim;
    upiModal.appendChild(btnClaim);
    const closeUpi = new Element('button');
    closeUpi.id = 'closeUpiPayerBtn';
    mockDoc.elements['closeUpiPayerBtn'] = closeUpi;
    upiModal.appendChild(closeUpi);
    const cancelUpi = new Element('button');
    cancelUpi.id = 'btnUpiCancel';
    mockDoc.elements['btnUpiCancel'] = cancelUpi;
    upiModal.appendChild(cancelUpi);
    mockDoc.body.appendChild(upiModal);
    
    const groupCode = fs.readFileSync('frontend/js/group.js', 'utf8');
    const injected = groupCode.replace(/}\s*$/, 'window.openUpiPayerModal = openUpiPayerModal; window.startPayment = startPayment; }');
    eval(injected);
    
    // Case 2: Close UPI dialog while claim is pending, then reject request
    window.openUpiPayerModal({ upiId: 'test@upi' }, { id: 'intent_1' });
    let rejectApi = null;
    global.api = () => new Promise((_, r) => rejectApi = r);
    window.isPaymentRequestInFlight = false;
    window.isPaymentActive = true;
    
    const promise = btnClaim.onclick();
    assert.strictEqual(window.isPaymentRequestInFlight, true, "Claim request is in flight");
    closeUpi.onclick();
    assert.strictEqual(window.isPaymentActive, true, "Updates remain blocked while pending");
    
    rejectApi(new Error("Claim failed"));
    await promise;
    assert.strictEqual(window.isPaymentRequestInFlight, false, "Claim request finished");
    assert.strictEqual(window.isPaymentActive, false, "Flags cleared after failure and dialog close");
    
    // Case 3: Complete Razorpay verification, fail data refresh
    let razorpayHandler = null;
    global.Razorpay = class { constructor(opt) { razorpayHandler = opt.handler; } open() {} };
    // Reset api mock so startPayment succeeds and creates razorpay instance
    let dataRefreshFailed = false;
    global.api = async (url) => {
      if (url === '/payment/initiate') return { rzpOrderId: 'order_1', intentId: 'intent_1' };
      if (url === '/payment/verify-payment') return { success: true };
      if (url === `/groups/${global.groupId}`) {
        dataRefreshFailed = true;
        throw new Error("Data Refresh Failed!");
      }
      return { group: { members: [] }, expenses: [], balances: [], intents: [] };
    };
    
    await window.startPayment(100, 'user2'); // Sets up Razorpay
    assert.ok(razorpayHandler, "Razorpay handler should be registered");
    
    window.isPaymentActive = true;
    window.isPaymentRequestInFlight = false;
    
    // Execute Razorpay handler
    let unhandledRejection = false;
    const processRejectionHandler = () => { unhandledRejection = true; };
    process.on('unhandledRejection', processRejectionHandler);
    
    await razorpayHandler({ razorpay_payment_id: 'pay_1', razorpay_order_id: 'order_1', razorpay_signature: 'sig_1' });
    
    // Check for unhandled rejections through the next event-loop turn
    await new Promise(r => setImmediate(r));
    process.removeListener('unhandledRejection', processRejectionHandler);
    
    assert.strictEqual(dataRefreshFailed, true, "Data refresh should have been attempted and failed");
    assert.strictEqual(unhandledRejection, false, "Data refresh failure should not cause unhandled rejection");
    assert.strictEqual(window.isPaymentRequestInFlight, false, "isPaymentRequestInFlight cleared");
    assert.strictEqual(window.isPaymentActive, false, "isPaymentActive cleared");
    
    console.log("✅ Payment Handlers passed");


    console.log("All lifecycle tests passed!");
  } catch(e) {
    console.error("Test failed:", e);
    process.exitCode = 1;
  }
})();
