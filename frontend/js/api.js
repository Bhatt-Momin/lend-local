const API_BASE = 'https://lend-local-1.onrender.com/api';

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
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (res.status === 401 && !path.includes('/auth/login')) {
    clearSession();
    if (!window.location.pathname.includes('login')) {
      window.location.href = '/login.html';
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
  btn.addEventListener('click', () => {
    clearSession();
    window.location.href = '/login.html';
  });
}

function fillUserChip() {
  const chip = document.getElementById('userChip');
  const user = getUser();
  if (chip && user) chip.textContent = user.name;
}
