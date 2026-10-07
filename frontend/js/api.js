const API_BASE = '/api';


function getUnresolvedKey() {
  const u = getUser();
  if (!u || (!u.id && !u._id)) return 'lendlocal_unresolved_anon';
  return 'lendlocal_unresolved_' + (u.id || u._id);
}

function getUnresolvedActions() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(getUnresolvedKey()) || '[]'));
  } catch {
    return new Set();
  }
}

function saveUnresolvedActions(actions) {
  sessionStorage.setItem(getUnresolvedKey(), JSON.stringify(Array.from(actions)));
}

function clearUnresolvedAction(resource) {
  const actions = getUnresolvedActions();
  actions.delete(resource);
  saveUnresolvedActions(actions);
  renderRecoveryPanel();
}

function renderRecoveryPanel() {
  let panel = document.getElementById('unresolved-recovery-panel');
  const actions = Array.from(getUnresolvedActions());

  if (actions.length === 0) {
    if (panel) panel.remove();
    return;
  }

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'unresolved-recovery-panel';
    panel.style.cssText = "position: fixed; top: 10px; left: 10px; right: 10px; max-width: 400px; margin: 0 auto; background: var(--ll-bg-secondary, #333); color: var(--ll-text-primary, #fff); padding: 15px; border-radius: 8px; z-index: 10000; box-shadow: 0 4px 15px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--ll-color-danger, #ff4444); font-size: 0.9rem; max-height: 90vh; overflow-y: auto;";
    document.body.appendChild(panel);
  }

  const resourcesList = actions.map(r => `<strong>${r}</strong>`).join(', ');
  const canReload = !!window.reloadCurrentData;

  panel.innerHTML = `
    <div>
      <strong style="color: var(--ll-color-danger, #ff4444);">Unresolved Actions:</strong><br>
      Network interrupted changes on: ${resourcesList}.<br>
      <span style="font-size: 0.85rem; opacity: 0.9; margin-top:5px; display:inline-block;">
        We cannot automatically confirm if these succeeded. Manual confirmation does not guarantee duplicate prevention. Please review the server data below to verify before continuing.
      </span>
    </div>
    <div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end;">
      ${canReload ? `<button id="panel-reload" class="btn btn-outline" style="flex: 1; min-width: 140px; min-height: 36px; padding: 0.5rem; font-size: 0.85rem;">Review Current Data</button>` : `<span style="font-size: 0.8rem; opacity:0.7; align-self:center;">Manual refresh required to review</span>`}
      <button id="panel-unlock" class="btn btn-primary" style="flex: 1; min-width: 140px; min-height: 36px; padding: 0.5rem; font-size: 0.85rem;" disabled>Acknowledge & Unlock</button>
    </div>
  `;

  const reloadBtn = document.getElementById('panel-reload');
  const unlockBtn = document.getElementById('panel-unlock');

  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.disabled = true;
      reloadBtn.textContent = 'Loading...';
      try {
        await window.reloadCurrentData();
        reloadBtn.textContent = 'Data Refreshed';
        if (unlockBtn) unlockBtn.disabled = false;
      } catch (err) {
        reloadBtn.textContent = 'Failed. Retry?';
        reloadBtn.disabled = false;
        if (typeof alert === 'function') alert(err.message || "Failed to load data.");
      }
    });
  }

  if (unlockBtn) {
    unlockBtn.addEventListener('click', () => {
      actions.forEach(r => clearUnresolvedAction(r));
    });
  }
}

window.addEventListener('DOMContentLoaded', renderRecoveryPanel);

function getToken() {
  return localStorage.getItem('lendlocal_token');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('lendlocal_user') || 'null');
  } catch {
    return null;
  }
}

function setSession(token, user) {
  localStorage.setItem('lendlocal_token', token);
  localStorage.setItem('lendlocal_user', JSON.stringify(user));
}

function clearSession() {
  localStorage.removeItem('lendlocal_token');
  localStorage.removeItem('lendlocal_user');
  // Clear all scoped unresolved actions
  Object.keys(sessionStorage).forEach(key => {
    if (key.startsWith('lendlocal_unresolved_')) {
      sessionStorage.removeItem(key);
    }
  });
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function redirectIfAuthed() {
  if (getToken()) {
    window.location.href = '/dashboard.html';
  }
}

async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const resource = path.split('/')[1] || 'generic';

  if (method !== 'GET' && resource !== 'auth' && getUnresolvedActions().has(resource)) {
    renderRecoveryPanel();
    throw new Error(`A previous action on '${resource}' remains unresolved. Please acknowledge it before making further changes.`);
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  let text = '';
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
    // Awaiting text inside the try block covers connection drops while reading the body
    text = await res.text();
  } catch (error) {
    if (method !== 'GET' && resource !== 'auth') {
      const actions = getUnresolvedActions();
      actions.add(resource);
      saveUnresolvedActions(actions);
      renderRecoveryPanel();
      throw new Error(`Connection lost. The outcome of this action is unknown. Please verify manually if it succeeded.`);
    }
    if (!navigator.onLine) {
      throw new Error("You're offline. Please connect to the internet to perform this action.");
    }
    throw new Error("Network error. Please try again.");
  }

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (res.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/register')) {
    clearSession();
    if (!window.location.pathname.includes('login.html')) {
      const dest = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login.html?expired=1&next=${dest}`;
    }
  }

  if (!res.ok) {
    const err = new Error((data && data.message) || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function formatMoney(amount) {
  const n = Number(amount) || 0;
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function showAlert(el, message, type = 'error') {
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type} show`;
  if (type === 'error') {
    el.setAttribute('tabindex', '-1');
    el.focus();
  }
}

function hideAlert(el) {
  if (!el) return;
  el.className = 'alert';
  el.textContent = '';
}

function balanceClass(net) {
  if (Math.abs(net) < 0.01) return 'settled';
  return net > 0 ? 'owed' : 'owe';
}

function balanceLabel(net) {
  if (Math.abs(net) < 0.01) return 'Settled up';
  if (net > 0) return `You are owed ${formatMoney(net)}`;
  return `You owe ${formatMoney(Math.abs(net))}`;
}

function wireLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const oldText = btn.innerHTML;
    btn.innerHTML = 'Logging out...';
    if (typeof window.clearFCMToken === 'function') {
      try {
        await Promise.race([
          window.clearFCMToken(),
          new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 3000))
        ]);
      } catch (err) {
        console.warn('FCM cleanup failed:', err);
      }
    }
    clearSession();
    window.location.href = '/login.html';
  });
}

function fillUserChip() {
  const chip = document.getElementById('userChip');
  const user = getUser();
  if (chip && user) chip.textContent = user.name;
}

function restoreFocusSafe(el) {
  if (el && el.isConnected && (el.offsetWidth > 0 || el.offsetHeight > 0) && !el.disabled) {
    el.focus();
  } else {
    let fallback = document.querySelector('main') || document.body;
    if (fallback) {
      if (!fallback.hasAttribute('tabindex')) {
        fallback.setAttribute('tabindex', '-1');
      }
      fallback.focus();
    }
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;

  const installModal = document.getElementById('installManualModal');
  if (installModal && installModal.style.display === 'flex') return;

  const openModals = Array.from(
    document.querySelectorAll('.modal-backdrop.open, .modern-modal-backdrop.open, [role="dialog"].open')
  ).filter(el => (el.offsetWidth > 0 || el.offsetHeight > 0) && el.style.display !== 'none');
  if (openModals.length === 0) return;
  const backdrop = openModals[openModals.length - 1];
  const dialogContainer = backdrop.querySelector('.modal, .modern-modal') || backdrop;

  const focusable = Array.from(
    backdrop.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')
  ).filter(el => el.offsetWidth > 0 || el.offsetHeight > 0);

  if (focusable.length === 0) {
    if (!dialogContainer.hasAttribute('tabindex')) {
      dialogContainer.setAttribute('tabindex', '-1');
    }
    dialogContainer.focus();
    e.preventDefault();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const isTabbable = focusable.includes(active);

  if (e.shiftKey) {
    if (active === first || !backdrop.contains(active) || (!isTabbable && backdrop.contains(active))) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (active === last || !backdrop.contains(active) || (!isTabbable && backdrop.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }
});
