const fs = require('fs');
const assert = require('assert');

// Minimal DOM mock for logic testing
// NOTE: This is purely a logic test for the focus trap handler.
// It does not verify real browser layout, true keyboard behavior,
// or screen-reader announcements.
class MockElement {
  constructor(tag, opts={}) {
    this.tagName = tag.toUpperCase();
    this.id = opts.id || '';
    this.className = opts.className || '';
    this.attributes = { ...opts.attributes };
    this.children = [];
    this.style = { display: opts.style?.display || '' };
    this.disabled = opts.disabled || false;
    this._isConnected = true;
    this.offsetWidth = 100;
    this.offsetHeight = 100;
    this.parent = null;
  }
  
  get isConnected() { return this._isConnected; }
  
  hasAttribute(name) { return name in this.attributes; }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, val) { this.attributes[name] = val; }
  
  appendChild(child) { this.children.push(child); child.parent = this; }
  
  focus() {
    global.document.activeElement = this;
  }
  
  contains(el) {
    if (this === el) return true;
    let curr = el;
    while(curr.parent) {
      if (curr.parent === this) return true;
      curr = curr.parent;
    }
    return false;
  }
  
  querySelectorAll(sel) {
    let results = [];
    const search = (node) => {
      let match = false;
      
      // Parse selectors roughly
      const parts = sel.split(',').map(s => s.trim());
      
      for (const p of parts) {
        if (p === '.modal-backdrop.open' && node.className.includes('modal-backdrop') && node.className.includes('open')) match = true;
        if (p === '.modern-modal-backdrop.open' && node.className.includes('modern-modal-backdrop') && node.className.includes('open')) match = true;
        if (p === '[role="dialog"].open' && node.getAttribute('role') === 'dialog' && node.className.includes('open')) match = true;
        if (p === '.open' && node.className.includes('open')) match = true;
        if (p === '.modal' && node.className.includes('modal')) match = true;
        if (p === '.modern-modal' && node.className.includes('modern-modal')) match = true;
        
        if (p === 'a[href]' && node.tagName === 'A' && node.hasAttribute('href')) match = true;
        if (p === 'button:not([disabled])' && node.tagName === 'BUTTON' && !node.disabled) match = true;
        if (p === 'input:not([disabled])' && node.tagName === 'INPUT' && !node.disabled) match = true;
        if (p === 'textarea:not([disabled])' && node.tagName === 'TEXTAREA' && !node.disabled) match = true;
        if (p === 'select:not([disabled])' && node.tagName === 'SELECT' && !node.disabled) match = true;
        if (p === '[tabindex]:not([tabindex="-1"])' && node.hasAttribute('tabindex') && node.getAttribute('tabindex') !== '-1') match = true;
      }
      
      if (match) results.push(node);
      node.children.forEach(search);
    };
    search(this);
    // filter out the root itself unless it's queried specifically
    return results.filter(n => n !== this || sel.includes(this.className) || sel.includes(this.tagName.toLowerCase()));
  }
  
  querySelector(sel) {
    const res = this.querySelectorAll(sel);
    return res[0] || null;
  }
}

global.document = {
  activeElement: null,
  body: new MockElement('body'),
  querySelectorAll: (sel) => {
    let res = global.document.body.querySelectorAll(sel);
    return res;
  },
  querySelector: (sel) => global.document.body.querySelector(sel),
  getElementById: (id) => {
    let found = null;
    const search = (node) => {
      if (node.id === id) found = node;
      node.children.forEach(search);
    };
    search(global.document.body);
    return found;
  }
};
global.window = {
  addEventListener: (event, handler) => {
    if (event === 'keydown') global.keydownHandler = handler;
  }
};

const main = new MockElement('main');
global.document.body.appendChild(main);

const installModal = new MockElement('div', { id: 'installManualModal', style: { display: 'none' } });
global.document.body.appendChild(installModal);

// Valid Modal
const testModal = new MockElement('div', { id: 'testModal', className: 'modal-backdrop open' });
const testModalInner = new MockElement('div', { className: 'modal modern-modal' });
const alertEl = new MockElement('div', { id: 'alert', attributes: { tabindex: '-1' } });
const firstInput = new MockElement('input', { id: 'firstInput' });
const lastBtn = new MockElement('button', { id: 'lastBtn' });
testModalInner.appendChild(alertEl);
testModalInner.appendChild(firstInput);
testModalInner.appendChild(lastBtn);
testModal.appendChild(testModalInner);
global.document.body.appendChild(testModal);

// Empty Modal
const emptyModal = new MockElement('div', { id: 'emptyModal', className: 'modal-backdrop' });
const emptyModalInner = new MockElement('div', { className: 'modal' });
emptyModal.appendChild(emptyModalInner);
global.document.body.appendChild(emptyModal);

// Non-dialog open element (like a dropdown menu)
const dropdownMenu = new MockElement('div', { id: 'dropdown', className: 'dropdown-menu open' });
const dropdownItem = new MockElement('button', { id: 'dropdownBtn' });
dropdownMenu.appendChild(dropdownItem);
global.document.body.appendChild(dropdownMenu);

// Load api.js
const apiJsCode = fs.readFileSync('./frontend/js/api.js', 'utf8');
eval(apiJsCode);

function simulateKey(key, shiftKey = false) {
  let prevented = false;
  const event = {
    key,
    shiftKey,
    preventDefault: () => { prevented = true; }
  };
  global.keydownHandler(event);
  return { defaultPrevented: prevented };
}

console.log("--- Running Focus Trap Logic Tests ---");
try {
  // Test 1: Focused error alert -> Tab moves to first input
  alertEl.focus();
  let evt = simulateKey('Tab');
  assert.strictEqual(evt.defaultPrevented, true, "Test 1 failed: default not prevented");
  assert.strictEqual(global.document.activeElement, firstInput, "Test 1 failed: focus not moved to first input");

  // Test 2: Focused error alert -> Shift+Tab moves to last button
  alertEl.focus();
  evt = simulateKey('Tab', true);
  assert.strictEqual(evt.defaultPrevented, true, "Test 2 failed: default not prevented");
  assert.strictEqual(global.document.activeElement, lastBtn, "Test 2 failed: focus not moved to last button");

  // Test 3: First input -> Shift+Tab moves to last button
  firstInput.focus();
  evt = simulateKey('Tab', true);
  assert.strictEqual(evt.defaultPrevented, true, "Test 3 failed: default not prevented");
  assert.strictEqual(global.document.activeElement, lastBtn, "Test 3 failed: focus not moved to last button");

  // Test 4: Last button -> Tab moves to first input
  lastBtn.focus();
  evt = simulateKey('Tab');
  assert.strictEqual(evt.defaultPrevented, true, "Test 4 failed: default not prevented");
  assert.strictEqual(global.document.activeElement, firstInput, "Test 4 failed: focus not moved to first input");

  // Test 5: Dialog with no enabled controls
  testModal.className = 'modal-backdrop';
  emptyModal.className = 'modal-backdrop open';
  global.document.body.focus();
  evt = simulateKey('Tab');
  assert.strictEqual(evt.defaultPrevented, true, "Test 5 failed: default not prevented");
  assert.strictEqual(global.document.activeElement, emptyModalInner, "Test 5 failed: focus not kept on dialog container");
  assert.strictEqual(emptyModalInner.getAttribute('tabindex'), '-1', "Test 5 failed: dialog container lacks tabindex=-1");

  // Test 6: Closed dialog ignored
  emptyModal.className = 'modal-backdrop';
  firstInput.focus();
  evt = simulateKey('Tab');
  assert.strictEqual(evt.defaultPrevented, false, "Test 6 failed: closed dialog should not prevent default");

  // Test 7: Conflict with install dialog
  testModal.className = 'modal-backdrop open';
  lastBtn.focus();
  installModal.style.display = 'flex';
  evt = simulateKey('Tab');
  assert.strictEqual(evt.defaultPrevented, false, "Test 7 failed: install modal active should bypass handler");

  // Test 8: Non-dialog open element ignored
  installModal.style.display = 'none';
  testModal.className = 'modal-backdrop';
  // Dropdown is already .dropdown-menu.open
  dropdownItem.focus();
  evt = simulateKey('Tab');
  assert.strictEqual(evt.defaultPrevented, false, "Test 8 failed: non-dialog open element should be ignored");

  console.log("✅ All focus trap logic tests passed successfully.");
  process.exit(0);
} catch (e) {
  console.error("❌ Test failed:", e.message);
  process.exit(1);
}
