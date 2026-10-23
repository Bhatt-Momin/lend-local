if (!requireAuth()) {
  /* redirected */
} else {
  fillUserChip();
  wireLogout();

  const groupList =
    document.getElementById('groupList');

  const createModal =
    document.getElementById('createModal');

  const createForm =
    document.getElementById('createForm');

  const createAlert =
    document.getElementById('createAlert');

  const statGroups =
    document.getElementById('statGroups');

  const statOwed =
    document.getElementById('statOwed');

  const statOwe =
    document.getElementById('statOwe');

  const netBalance =
    document.getElementById('netBalance');

  const balanceStatus =
    document.getElementById('balanceStatus');

  const userAvatar =
    document.querySelector('.user-avatar');


  /* =========================================================
     USER AVATAR
  ========================================================= */

  function updateUserAvatar() {
    if (!userAvatar) return;

    const user = getUser();

    if (!user) {
      userAvatar.textContent = 'U';
      return;
    }

    const name =
      user.name ||
      user.email ||
      'U';

    userAvatar.textContent =
      name
        .trim()
        .charAt(0)
        .toUpperCase();
  }

  updateUserAvatar();


  /* =========================================================
     CREATE GROUP MODAL
  ========================================================= */

  let createModalLastFocus = null;
  let createFocusTimeout;

  document
    .getElementById('openCreate')
    ?.addEventListener('click', () => {
      createModalLastFocus = document.activeElement;
      hideAlert(createAlert);
      createForm.reset();
      createModal.classList.add('open');
      document.body.classList.add('modal-open');
      clearTimeout(createFocusTimeout);
      createFocusTimeout = setTimeout(() => {
        if (createModal.classList.contains('open')) createForm.querySelector('input')?.focus();
      }, 50);
    });

  function closeCreateModal() {
    createModal.classList.remove('open');
    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.classList.remove('modal-open');
    }
    clearTimeout(createFocusTimeout);
    restoreFocusSafe(createModalLastFocus);
  }

  document
    .getElementById('closeCreate')
    ?.addEventListener('click', closeCreateModal);

  document
    .getElementById('closeCreateAlt')
    ?.addEventListener('click', closeCreateModal);

  createModal?.addEventListener('click', (e) => {
    if (e.target === createModal) {
      closeCreateModal();
    }
  });


  /* =========================================================
     CREATE GROUP
  ========================================================= */

  createForm.addEventListener(
    'submit',
    async (e) => {

      e.preventDefault();

      hideAlert(createAlert);

      const emails =
        createForm.memberEmails.value
          .split(',')
          .map((email) => email.trim())
          .filter(Boolean);

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.innerHTML = `<span class="fx-spinner"></span> Creating...`;
      }

      try {

        const data =
          await api('/groups', {

            method: 'POST',

            body: JSON.stringify({

              name:
                createForm.name.value.trim(),

              description:
                createForm.description.value.trim(),

              memberEmails:
                emails,

            }),

          });


        createModal.classList.remove('open');


        if (window.FX) {

          window.FX.toast(
            'Group created successfully!'
          );

        }


        setTimeout(() => {

          window.location.href =
            `/group.html?id=${data.group.id}`;

        }, 600);


      } catch (err) {

        showAlert(
          createAlert,
          err.message
        );


        if (window.FX) {

          window.FX.shake(
            createAlert
          );

        }

      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || 'Create Group';
        }
      }

    }
  );


  /* =========================================================
     UPDATE OVERALL BALANCE CARD
  ========================================================= */

  function updateOverallBalance(
    owed,
    owe
  ) {

    if (!netBalance || !balanceStatus) {
      return;
    }


    const net =
      owed - owe;


    if (Math.abs(net) < 0.01) {

      netBalance.textContent =
        '₹0.00';

      balanceStatus.textContent =
        'All settled up';

      return;

    }


    if (net > 0) {

      netBalance.textContent =
        `+${formatMoney(net)}`;

      balanceStatus.textContent =
        'You are owed overall';

      return;

    }


    netBalance.textContent =
      `−${formatMoney(
        Math.abs(net)
      )}`;

    balanceStatus.textContent =
      'You owe overall';

  }


  /* =========================================================
     EMPTY STATE
  ========================================================= */

  function renderEmptyState() {

    groupList.innerHTML = `

      <div class="modern-empty">

        <div class="empty-icon">
          👥
        </div>

        <strong>
          No groups yet
        </strong>

        <p>
          Create your first group and start
          tracking shared expenses.
        </p>

        <button
          class="btn btn-primary"
          type="button"
          id="emptyCreateGroup"
        >
          Create your first group
        </button>

      </div>

    `;


    document
      .getElementById('emptyCreateGroup')
      ?.addEventListener('click', () => {
        createModalLastFocus = document.activeElement;
        hideAlert(createAlert);
        createForm.reset();
        createModal.classList.add('open');
        clearTimeout(createFocusTimeout);
        createFocusTimeout = setTimeout(() => {
          if (createModal.classList.contains('open')) createForm.querySelector('input')?.focus();
        }, 50);
      });

  }


  /* =========================================================
     RENDER GROUPS
  ========================================================= */

  function renderGroups(groups) {

    groupList.innerHTML =
      groups
        .map((g) => {

          const balance =
            Number(g.myBalance) || 0;


          const cls =
            balanceClass(balance);


          let balanceLabel;


          if (Math.abs(balance) < 0.01) {
            balanceLabel = '<span class="bal-status">Settled</span>';
          } else if (balance > 0) {
            balanceLabel = `<span class="bal-status">You are owed</span> <strong class="bal-amount">${formatMoney(balance)}</strong>`;
          } else {
            balanceLabel = `<span class="bal-status">You owe</span> <strong class="bal-amount">${formatMoney(Math.abs(balance))}</strong>`;
          }


          const initial =
            escapeHtml(
              String(g.name || 'G')
                .trim()
                .charAt(0)
                .toUpperCase()
            );


          const description =
            g.description
              ? escapeHtml(
                  g.description
                )
              : `${g.memberCount || 0} members · ${
                  g.expenseCount || 0
                } expenses`;


          return `

            <a
              class="modern-group-card group-row"
              href="/group.html?id=${g.id}"
            >

              <div class="group-icon">
                ${initial}
              </div>


              <div class="group-main">

                <h3>
                  ${escapeHtml(g.name)}
                </h3>

                <div class="meta">
                  ${description}
                </div>

              </div>


              <div class="group-balance">

                <span class="group-balance-label">
                  Your balance
                </span>

                <span
                  class="balance-pill ${cls}"
                >
                  ${balanceLabel}
                </span>

              </div>

            </a>

          `;

        })
        .join('');


    if (window.FX) {

      window.FX.staggerReveal(
        groupList,
        '.modern-group-card'
      );

    }

  }


  /* =========================================================
     LOAD GROUPS
  ========================================================= */

  window.reloadCurrentData = loadGroups;
  const loaderQueue = createLoaderQueue(async () => {
    const res = await _loadGroups();
    lastLoadTime = Date.now();
    return res;
  });

  function loadGroups(force = false) {
    return loaderQueue.load(force);
  }

  async function _loadGroups() {
    const retryBtn = document.getElementById('retryGroups');
    if (retryBtn) {
      retryBtn.disabled = true;
      retryBtn.textContent = 'Loading...';
    }
    try {

      /*
       * First get the user's groups.
       */

      const data =
        await api('/groups');


      const groups =
        data.groups || [];


      /*
       * IMPORTANT:
       *
       * Do NOT trust group.myBalance here.
       *
       * The /groups endpoint can contain the old
       * expense-only balance.
       *
       * /balances/:groupId contains the updated
       * payment-adjusted balance.
       */


      const groupsWithBalances =
        await Promise.all(

          groups.map(
            async (group) => {

              try {

                const balanceData =
                  await api(
                    `/balances/${group.id}`
                  );


                /*
                 * Find the logged-in user's
                 * balance in this group.
                 */

                const user =
                  getUser();


                const userId =
                  String(
                    user.id ||
                    user._id
                  );


                const myBalance =
                  (
                    balanceData.balances ||
                    []
                  ).find(
                    (balance) =>
                      String(
                        balance.userId
                      ) === userId
                  );


                return {

                  ...group,

                  /*
                   * This is now the payment-adjusted
                   * balance.
                   */

                  myBalance:
                    myBalance
                      ? Number(
                          myBalance.net
                        )
                      : 0,

                };

              } catch (error) {
                console.error(`Failed to load balance for group ${group.id}:`, error);
                throw error;
              }

            }
          )

        );


      /* =====================================================
         CALCULATE TOTALS
      ===================================================== */

      let owed = 0;

      let owe = 0;


      groupsWithBalances.forEach(
        (group) => {

          const balance =
            Number(
              group.myBalance
            ) || 0;


          if (balance > 0) {

            owed += balance;

          }


          if (balance < 0) {

            owe +=
              Math.abs(balance);

          }

        }
      );


      /*
       * Round totals to avoid floating-point
       * garbage such as 349.999999.
       */

      owed =
        Math.round(
          owed * 100
        ) / 100;


      owe =
        Math.round(
          owe * 100
        ) / 100;


      /* =====================================================
         UPDATE STATISTICS
      ===================================================== */

      if (window.FX) {

        window.FX.animateNumber(
          statGroups,
          groupsWithBalances.length,
          {
            decimals: 0,
          }
        );


        window.FX.animateNumber(
          statOwed,
          owed,
          {
            prefix: '₹',
            decimals: 2,
          }
        );


        window.FX.animateNumber(
          statOwe,
          owe,
          {
            prefix: '₹',
            decimals: 2,
          }
        );

      } else {

        statGroups.textContent =
          String(
            groupsWithBalances.length
          );


        statOwed.textContent =
          formatMoney(owed);


        statOwe.textContent =
          formatMoney(owe);

      }


      /* =====================================================
         UPDATE MAIN BALANCE
      ===================================================== */

      updateOverallBalance(
        owed,
        owe
      );


      /* =====================================================
         EMPTY STATE
      ===================================================== */

      if (!groupsWithBalances.length) {

        renderEmptyState();

        return;

      }


      /* =====================================================
         RENDER GROUP CARDS
      ===================================================== */

      renderGroups(
        groupsWithBalances
      );


    } catch (err) {

      console.error(
        'Dashboard load error:',
        err
      );


      groupList.innerHTML = `

        <div class="modern-empty">

          <div class="empty-icon">
            !
          </div>

          <strong>
            Could not load groups
          </strong>

          <p>
            ${escapeHtml(
              err.message ||
              'Something went wrong.'
            )}
          </p>

          <button
            id="retryGroups"
            class="btn btn-primary"
            type="button"
          >
            Try again
          </button>

        </div>

      `;


      document
        .getElementById('retryGroups')
        ?.addEventListener('click', () => {
          loadGroups().catch(err => {
            console.error('Retry failed:', err);
          });
        });
      throw err;
    }

  }


  /* =========================================================
     ESCAPE HTML
  ========================================================= */

  function escapeHtml(str) {

    return String(str)

      .replace(
        /&/g,
        '&amp;'
      )

      .replace(
        /</g,
        '&lt;'
      )

      .replace(
        />/g,
        '&gt;'
      )

      .replace(
        /"/g,
        '&quot;'
      )

      .replace(
        /'/g,
        '&#039;'
      );

  }



  /* =========================================================
     SETTINGS
  ========================================================= */
  const settingsModal = document.getElementById('settingsModal');
  const settingsBtn = document.getElementById('settingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const upiIdInput = document.getElementById('upiIdInput');
  const settingsAlert = document.getElementById('settingsAlert');

  let settingsModalLastFocus = null;
  let settingsFocusTimeout;

  function openSettingsModal() {
    settingsModalLastFocus = document.activeElement;
    hideAlert(settingsAlert);
    upiIdInput.value = '';
    settingsModal.classList.add('open');
    document.body.classList.add('modal-open');
    if (window.syncNotificationSettingsUi) {
      window.syncNotificationSettingsUi();
    }
    clearTimeout(settingsFocusTimeout);
    settingsFocusTimeout = setTimeout(() => {
      if (settingsModal.classList.contains('open')) upiIdInput.focus();
    }, 50);
    upiIdInput.placeholder = 'Loading...';

    api('/auth/me', { method: 'GET' })
      .then(data => {
        upiIdInput.placeholder = 'username@bank';
        if (data && data.user && data.user.upiId) {
          upiIdInput.value = data.user.upiId;
        }
      })
      .catch(err => {
        upiIdInput.placeholder = 'username@bank';
        console.error('Failed to fetch profile:', err);
      });
  }

  function closeSettings() {
    settingsModal.classList.remove('open');
    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.classList.remove('modal-open');
    }
    clearTimeout(settingsFocusTimeout);
    restoreFocusSafe(settingsModalLastFocus);
  }

  if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
  if (cancelSettingsBtn) cancelSettingsBtn.addEventListener('click', closeSettings);
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      closeSettings();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal?.classList.contains('open')) {
        closeSettings();
      } else if (createModal?.classList.contains('open')) {
        closeCreateModal();
      }
    }
  });

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
      try {
        hideAlert(settingsAlert);
        saveSettingsBtn.disabled = true;
        saveSettingsBtn.textContent = 'Saving...';

        const res = await api('/auth/upi-id', {
          method: 'POST',
          body: JSON.stringify({ upiId: upiIdInput.value })
        });

        showAlert(settingsAlert, res.message || 'Settings saved successfully', 'success');
      } catch (err) {
        showAlert(settingsAlert, err.message, 'error');
      } finally {
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.textContent = 'Save Settings';
      }
    });
  }

  /* =========================================================
     MONTHLY SPENDING ANALYTICS
  ========================================================= */

  let analyticsYear = new Date().getFullYear();
  let analyticsMonth = new Date().getMonth() + 1; // 1-12

  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const currentMonthLabel = document.getElementById('currentMonthLabel');
  const analyticsLoading = document.getElementById('analyticsLoading');
  const analyticsError = document.getElementById('analyticsError');
  const analyticsContent = document.getElementById('analyticsContent');
  const analyticsPrimaryAmount = document.getElementById('analyticsPrimaryAmount');
  const analyticsComparisonBadge = document.getElementById('analyticsComparisonBadge');
  const analyticsPersonallyPaid = document.getElementById('analyticsPersonallyPaid');
  const analyticsNetOwedToOthers = document.getElementById('analyticsNetOwedToOthers');
  const analyticsNetOwedToUser = document.getElementById('analyticsNetOwedToUser');
  const analyticsCategoryList = document.getElementById('analyticsCategoryList');
  const analyticsDailyTrendChart = document.getElementById('analyticsDailyTrendChart');
  const trendEndDayLabel = document.getElementById('trendEndDayLabel');
  const analyticsRecentList = document.getElementById('analyticsRecentList');

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  async function loadMonthlyAnalytics(year, month) {
    if (!currentMonthLabel) return;

    const now = new Date();
    const isCurrentOrFuture = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);

    currentMonthLabel.textContent = `${monthNames[month - 1].slice(0, 3)} ${year}`;
    if (nextMonthBtn) {
      nextMonthBtn.disabled = isCurrentOrFuture;
      nextMonthBtn.style.opacity = isCurrentOrFuture ? '0.4' : '1';
      nextMonthBtn.style.cursor = isCurrentOrFuture ? 'not-allowed' : 'pointer';
    }

    if (analyticsLoading) analyticsLoading.style.display = 'block';
    if (analyticsError) analyticsError.style.display = 'none';
    if (analyticsContent) analyticsContent.style.opacity = '0.5';

    try {
      const data = await api(`/expenses/analytics/monthly?year=${year}&month=${month}`);

      if (analyticsPrimaryAmount) {
        analyticsPrimaryAmount.textContent = formatMoney(data.primaryMetric?.amount || 0);
      }

      if (analyticsComparisonBadge) {
        const pct = data.primaryMetric?.percentageChange;
        if (pct !== null && pct !== undefined) {
          const sign = pct > 0 ? '+' : '';
          const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
          analyticsComparisonBadge.textContent = `${arrow} ${sign}${pct}% vs last month`;
          analyticsComparisonBadge.style.color = pct > 0 ? 'var(--ll-warning)' : 'var(--ll-positive)';
          analyticsComparisonBadge.style.background = pct > 0 ? 'rgba(251, 191, 36, 0.1)' : 'rgba(52, 211, 153, 0.1)';
        } else if (data.primaryMetric?.amount > 0 && (!data.primaryMetric?.previousMonthAmount || data.primaryMetric?.previousMonthAmount === 0)) {
          analyticsComparisonBadge.textContent = 'First month recorded';
          analyticsComparisonBadge.style.color = 'var(--ll-brand)';
          analyticsComparisonBadge.style.background = 'var(--ll-brand-dim)';
        } else {
          analyticsComparisonBadge.textContent = 'No prior data';
          analyticsComparisonBadge.style.color = 'var(--ll-text-muted)';
          analyticsComparisonBadge.style.background = 'rgba(255,255,255,0.05)';
        }
      }

      if (analyticsPersonallyPaid) {
        analyticsPersonallyPaid.textContent = formatMoney(data.secondaryMetrics?.personallyPaid || 0);
      }
      if (analyticsNetOwedToOthers) {
        analyticsNetOwedToOthers.textContent = formatMoney(data.secondaryMetrics?.netOwedToOthers || 0);
      }
      if (analyticsNetOwedToUser) {
        analyticsNetOwedToUser.textContent = formatMoney(data.secondaryMetrics?.netOwedToUser || 0);
      }

      // Categories
      if (analyticsCategoryList) {
        if (!data.categoryBreakdown || data.categoryBreakdown.length === 0) {
          analyticsCategoryList.innerHTML = '<p style="color: var(--ll-text-muted); font-size: 0.875rem;">No spending recorded for this month.</p>';
        } else {
          analyticsCategoryList.innerHTML = data.categoryBreakdown.map((cat) => `
            <div class="analytics-cat-row">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem;">
                <span style="font-weight: 500; color: var(--ll-text);">${escapeHtml(cat.category)}</span>
                <span style="font-family: var(--ll-font-mono); font-weight: 600; color: var(--ll-text);">${formatMoney(cat.amount)} <span style="color: var(--ll-text-muted); font-size: 0.75rem;">(${cat.percentage}%)</span></span>
              </div>
              <div style="background: rgba(255,255,255,0.07); border-radius: 99px; height: 6px; overflow: hidden;">
                <div style="background: var(--ll-brand); width: ${Math.max(cat.percentage, 2)}%; height: 100%; border-radius: 99px;"></div>
              </div>
            </div>
          `).join('');
        }
      }

      // Daily Trend
      if (analyticsDailyTrendChart) {
        const trend = data.dailyTrend || [];
        const maxVal = trend.reduce((max, d) => Math.max(max, d.amount), 0);
        if (trendEndDayLabel) {
          trendEndDayLabel.textContent = `Day ${trend.length}`;
        }

        if (maxVal === 0) {
          analyticsDailyTrendChart.innerHTML = '<div style="width: 100%; text-align: center; color: var(--ll-text-muted); font-size: 0.8rem; margin: auto;">No daily activity recorded</div>';
        } else {
          analyticsDailyTrendChart.innerHTML = trend.map((d) => {
            const heightPct = maxVal > 0 ? Math.round((d.amount / maxVal) * 100) : 0;
            const barHeight = Math.max(heightPct, d.amount > 0 ? 8 : 2);
            const isZero = d.amount === 0;
            return `
              <div
                title="Day ${d.day}: ${formatMoney(d.amount)}"
                style="flex: 1; height: ${barHeight}%; background: ${isZero ? 'rgba(255,255,255,0.06)' : 'var(--ll-brand)'}; border-radius: 2px 2px 0 0; transition: height 0.3s ease;"
              ></div>
            `;
          }).join('');
        }
      }

      // Recent Expenses
      if (analyticsRecentList) {
        if (!data.recentExpenses || data.recentExpenses.length === 0) {
          analyticsRecentList.innerHTML = '<p style="color: var(--ll-text-muted); font-size: 0.875rem;">No expenses found for this month.</p>';
        } else {
          analyticsRecentList.innerHTML = data.recentExpenses.map((ex) => {
            const dateStr = new Date(ex.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.65rem 0.85rem; background: rgba(255,255,255,0.02); border: 1px solid var(--ll-border); border-radius: var(--ll-radius-sm); font-size: 0.875rem;">
                <div>
                  <div style="font-weight: 600; color: var(--ll-text);">${escapeHtml(ex.description)}</div>
                  <div style="font-size: 0.75rem; color: var(--ll-text-muted); margin-top: 0.15rem;">
                    <span>${escapeHtml(ex.groupName)}</span> &bull; <span>${escapeHtml(ex.category)}</span> &bull; <span>${dateStr}</span>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-family: var(--ll-font-mono); font-weight: 700; color: var(--ll-text);">
                    ${formatMoney(ex.userShare)}
                  </div>
                  <div style="font-size: 0.75rem; color: var(--ll-text-muted);">
                    ${ex.isPayer ? 'You paid ' + formatMoney(ex.totalAmount) : 'Paid by ' + escapeHtml(ex.paidByName)}
                  </div>
                </div>
              </div>
            `;
          }).join('');
        }
      }

    } catch (err) {
      console.error('Failed to load monthly analytics:', err);
      if (analyticsError) {
        analyticsError.textContent = 'Failed to load monthly spending analytics. Click to retry.';
        analyticsError.style.display = 'block';
        analyticsError.onclick = () => loadMonthlyAnalytics(analyticsYear, analyticsMonth);
      }
    } finally {
      if (analyticsLoading) analyticsLoading.style.display = 'none';
      if (analyticsContent) analyticsContent.style.opacity = '1';
    }
  }

  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      if (analyticsMonth === 1) {
        analyticsMonth = 12;
        analyticsYear -= 1;
      } else {
        analyticsMonth -= 1;
      }
      loadMonthlyAnalytics(analyticsYear, analyticsMonth);
    });
  }

  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      const now = new Date();
      if (analyticsYear > now.getFullYear() || (analyticsYear === now.getFullYear() && analyticsMonth >= now.getMonth() + 1)) {
        return; // Prevent navigating to future months
      }
      if (analyticsMonth === 12) {
        analyticsMonth = 1;
        analyticsYear += 1;
      } else {
        analyticsMonth += 1;
      }
      loadMonthlyAnalytics(analyticsYear, analyticsMonth);
    });
  }

  /* =========================================================
     BACKGROUND RESUME
  ========================================================= */
  let lastLoadTime = Date.now();
  let isRefreshing = false;
  const STALE_MS = 2 * 60 * 1000; // 2 minutes

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (Date.now() - lastLoadTime > STALE_MS && !isRefreshing) {
        isRefreshing = true;
        // Check if create modal or settings modal is open to avoid disrupting input?
        // Actually, loadGroups() replaces the list but doesn't close modals.
        // It's safe to run in background.
        loadGroups(true)
          .catch(err => console.warn('Background refresh failed', err))
          .finally(() => { isRefreshing = false; });
      }
    }
  });

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  loadGroups(true).catch(err => {
    console.error('Initial load failed:', err);
  });

  loadMonthlyAnalytics(analyticsYear, analyticsMonth).catch(err => {
    console.error('Initial analytics load failed:', err);
  });

}