if (!requireAuth()) {
  /* redirected */
} else {
  fillUserChip();
  wireLogout();

  const groupList = document.getElementById('groupList');
  const createModal = document.getElementById('createModal');
  const createForm = document.getElementById('createForm');
  const createAlert = document.getElementById('createAlert');

  document.getElementById('openCreate').addEventListener('click', () => {
    hideAlert(createAlert);
    createForm.reset();
    createModal.classList.add('open');
  });

  document.getElementById('closeCreate').addEventListener('click', () => {
    createModal.classList.remove('open');
  });

  createModal.addEventListener('click', (e) => {
    if (e.target === createModal) {
      createModal.classList.remove('open');
    }
  });

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(createAlert);

    const emails = createForm.memberEmails.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const data = await api('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: createForm.name.value.trim(),
          description: createForm.description.value.trim(),
          memberEmails: emails,
        }),
      });

      createModal.classList.remove('open');

      // Success feedback
      if (window.FX) {
        window.FX.toast('Group created successfully!');
      }

      // Give the toast a moment to appear before redirecting
      setTimeout(() => {
        window.location.href = `/group.html?id=${data.group.id}`;
      }, 600);

    } catch (err) {
      showAlert(createAlert, err.message);

      // Shake the alert on error
      if (window.FX) {
        window.FX.shake(createAlert);
      }
    }
  });

  async function loadGroups() {
    try {
      const data = await api('/groups');
      const groups = data.groups || [];

      const statGroups = document.getElementById('statGroups');
      const statOwed = document.getElementById('statOwed');
      const statOwe = document.getElementById('statOwe');

      // Calculate balances
      let owed = 0;
      let owe = 0;

      groups.forEach((g) => {
        if (g.myBalance > 0) owed += g.myBalance;
        if (g.myBalance < 0) owe += Math.abs(g.myBalance);
      });

      // Animate statistics
      if (window.FX) {
        window.FX.animateNumber(statGroups, groups.length, {
          decimals: 0,
        });

        window.FX.animateNumber(statOwed, owed, {
          prefix: '₹',
          decimals: 2,
        });

        window.FX.animateNumber(statOwe, owe, {
          prefix: '₹',
          decimals: 2,
        });
      } else {
        // Fallback if effects.js is unavailable
        statGroups.textContent = String(groups.length);
        statOwed.textContent = formatMoney(owed);
        statOwe.textContent = formatMoney(owe);
      }

      // Empty state
      if (!groups.length) {
        groupList.innerHTML = `
          <div class="empty">
            <strong>No groups yet</strong>
            Create a group to start tracking shared expenses with friends.
          </div>
        `;
        return;
      }

      // Render groups
      groupList.innerHTML = groups
        .map((g) => {
          const cls = balanceClass(g.myBalance);

          const label =
            Math.abs(g.myBalance) < 0.01
              ? 'Settled'
              : g.myBalance > 0
                ? `+${formatMoney(g.myBalance)}`
                : `−${formatMoney(Math.abs(g.myBalance))}`;

          return `
            <a class="group-row" href="/group.html?id=${g.id}">
              <div>
                <h3>${escapeHtml(g.name)}</h3>
                <div class="meta">
                  ${g.memberCount} members · ${g.expenseCount} expenses
                </div>
              </div>

              <span class="balance-pill ${cls}">
                ${label}
              </span>
            </a>
          `;
        })
        .join('');

      // Reveal groups one by one
      if (window.FX) {
        window.FX.staggerReveal(groupList, '.group-row');
      }

    } catch (err) {
      groupList.innerHTML = `
        <div class="empty">
          <strong>Could not load groups</strong>
          ${escapeHtml(err.message)}
        </div>
      `;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  loadGroups();
}