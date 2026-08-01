if (!requireAuth()) {
  /* redirected */
} else {
  fillUserChip();
  wireLogout();

  const params = new URLSearchParams(window.location.search);
  const groupId = params.get('id');
  if (!groupId) {
    window.location.href = '/dashboard.html';
  }

  const me = getUser();
  let group = null;
  let members = [];

  const expenseModal = document.getElementById('expenseModal');
  const expenseForm = document.getElementById('expenseForm');
  const expenseAlert = document.getElementById('expenseAlert');
  const splitList = document.getElementById('splitList');

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('openExpense').addEventListener('click', () => {
    hideAlert(expenseAlert);
    expenseForm.reset();
    expenseForm.date.value = new Date().toISOString().slice(0, 10);
    renderSplitInputs('equal');
    expenseModal.classList.add('open');
  });

  document.getElementById('closeExpense').addEventListener('click', () => {
    expenseModal.classList.remove('open');
  });

  expenseModal.addEventListener('click', (e) => {
    if (e.target === expenseModal) expenseModal.classList.remove('open');
  });

  document.getElementById('expSplitType').addEventListener('change', (e) => {
    renderSplitInputs(e.target.value);
  });

  document.getElementById('expAmount').addEventListener('input', () => {
    if (document.getElementById('expSplitType').value === 'equal') {
      renderSplitInputs('equal');
    }
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderSplitInputs(type) {
    const amount = Number(document.getElementById('expAmount').value) || 0;
    const equalShare = members.length ? Math.round((amount / members.length) * 100) / 100 : 0;

    splitList.innerHTML = members
      .map((m) => {
        if (type === 'custom') {
          return `
            <div class="split-row">
              <label>
                <input type="checkbox" class="split-check" data-user="${m.id}" checked />
                ${escapeHtml(m.name)}
              </label>
              <input type="number" class="split-share" data-user="${m.id}" min="0" step="0.01" value="${equalShare}" />
            </div>`;
        }
        return `
          <div class="split-row">
            <label>
              <input type="checkbox" class="split-check" data-user="${m.id}" checked />
              ${escapeHtml(m.name)}
            </label>
            <span style="color:var(--muted);font-size:0.9rem">${formatMoney(equalShare)} each*</span>
          </div>`;
      })
      .join('');
  }

  function renderPaidBy() {
    const select = document.getElementById('expPaidBy');
    select.innerHTML = members
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === me.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
      )
      .join('');
  }

  async function loadAll() {
    const [groupRes, expenseRes, balanceRes] = await Promise.all([
      api(`/groups/${groupId}`),
      api(`/expenses/${groupId}`),
      api(`/balances/${groupId}`),
    ]);

    group = groupRes.group;
    members = group.members;

    document.title = `${group.name} — LendLocal`;
    document.getElementById('groupName').textContent = group.name;
    document.getElementById('groupDesc').textContent =
      group.description || `${members.length} members`;

    document.getElementById('statTotal').textContent = formatMoney(balanceRes.totalSpent);
    document.getElementById('statCount').textContent = String(balanceRes.expenseCount);

    const mine = balanceRes.balances.find((b) => b.userId === me.id);
    const myNet = mine ? mine.net : 0;
    const mineEl = document.getElementById('statMine');
    mineEl.textContent =
      Math.abs(myNet) < 0.01
        ? 'Settled'
        : myNet > 0
          ? `+${formatMoney(myNet)}`
          : `−${formatMoney(Math.abs(myNet))}`;
    mineEl.className = `value ${myNet > 0.01 ? 'positive' : myNet < -0.01 ? 'negative' : ''}`;

    renderExpenses(expenseRes.expenses || []);
    renderBalances(balanceRes);
    renderMembers();
    renderPaidBy();
  }

  function renderExpenses(expenses) {
    const list = document.getElementById('expenseList');
    if (!expenses.length) {
      list.innerHTML = `
        <div class="empty">
          <strong>No expenses yet</strong>
          Add the first shared cost for this group.
        </div>`;
      return;
    }

    list.innerHTML = expenses
      .map(
        (e) => `
        <article class="expense-item">
          <div>
            <h4>${escapeHtml(e.description)}</h4>
            <div class="meta">${escapeHtml(e.category)} · Paid by ${escapeHtml(e.paidBy.name)} · ${formatDate(e.date)}</div>
          </div>
          <div class="amount">${formatMoney(e.amount)}</div>
          <div class="actions">
            <button class="btn btn-danger" type="button" data-delete="${e.id}">Delete</button>
          </div>
        </article>`
      )
      .join('');

    list.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this expense?')) return;
        try {
          await api(`/expenses/${btn.dataset.delete}`, { method: 'DELETE' });
          await loadAll();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function renderBalances(data) {
    const settlements = data.settlements || [];
    const balances = data.balances || [];

    const sList = document.getElementById('settlementList');
    if (!settlements.length) {
      sList.innerHTML = `<div class="empty"><strong>All settled</strong>No outstanding debts in this group.</div>`;
    } else {
      sList.innerHTML = settlements
        .map(
          (s) => `
          <div class="settlement-item">
            <div class="flow">${escapeHtml(s.from.name)} <span>owes</span> ${escapeHtml(s.to.name)}</div>
            <strong>${formatMoney(s.amount)}</strong>
          </div>`
        )
        .join('');
    }

    document.getElementById('balanceList').innerHTML = balances
      .map((b) => {
        const label =
          Math.abs(b.net) < 0.01
            ? 'Settled'
            : b.net > 0
              ? `owed ${formatMoney(b.net)}`
              : `owes ${formatMoney(Math.abs(b.net))}`;
        return `
          <div class="balance-item">
            <div>${escapeHtml(b.name)}${b.userId === me.id ? ' (you)' : ''}</div>
            <span class="balance-pill ${balanceClass(b.net)}">${label}</span>
          </div>`;
      })
      .join('');
  }

  function renderMembers() {
    document.getElementById('memberList').innerHTML = members
      .map(
        (m) => `
        <div class="member-item">
          <div>
            <strong>${escapeHtml(m.name)}${m.id === me.id ? ' (you)' : ''}</strong>
            <div class="email">${escapeHtml(m.email)}</div>
          </div>
        </div>`
      )
      .join('');
  }

  document.getElementById('addMemberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById('memberAlert');
    hideAlert(alertEl);
    const email = document.getElementById('memberEmail').value.trim();

    try {
      const data = await api(`/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      members = data.members;
      document.getElementById('memberEmail').value = '';
      showAlert(alertEl, 'Member added', 'success');
      await loadAll();
    } catch (err) {
      showAlert(alertEl, err.message);
    }
  });

  expenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(expenseAlert);

    const splitType = expenseForm.splitType.value;
    const checked = [...document.querySelectorAll('.split-check:checked')];
    if (!checked.length) {
      showAlert(expenseAlert, 'Select at least one participant');
      return;
    }

    let splits;
    if (splitType === 'equal') {
      splits = checked.map((c) => ({ user: c.dataset.user }));
    } else {
      splits = checked.map((c) => {
        const input = document.querySelector(`.split-share[data-user="${c.dataset.user}"]`);
        return { user: c.dataset.user, share: Number(input.value) };
      });
    }

    try {
      await api('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          groupId,
          description: expenseForm.description.value.trim(),
          amount: Number(expenseForm.amount.value),
          paidBy: expenseForm.paidBy.value,
          splitType,
          splits,
          category: expenseForm.category.value,
          date: expenseForm.date.value || undefined,
        }),
      });
      expenseModal.classList.remove('open');
      await loadAll();
    } catch (err) {
      showAlert(expenseAlert, err.message);
    }
  });

  loadAll().catch((err) => {
    document.getElementById('expenseList').innerHTML = `
      <div class="empty"><strong>Could not load group</strong>${escapeHtml(err.message)}</div>`;
  });
}
