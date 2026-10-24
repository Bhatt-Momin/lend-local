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
    const user = getUser();
    const displayName = (user && (user.name || user.email))
      ? (user.name || user.email).trim()
      : 'User';

    if (userAvatar) {
      userAvatar.textContent =
        displayName
          ? displayName.charAt(0).toUpperCase()
          : 'U';
    }

    fillUserChip();
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

    netBalance.classList.remove('positive', 'negative');
    balanceStatus.classList.remove('positive', 'negative');

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
      netBalance.classList.add('positive');

      balanceStatus.textContent =
        'You are owed overall';
      balanceStatus.classList.add('positive');

      return;

    }


    netBalance.textContent =
      `−${formatMoney(
        Math.abs(net)
      )}`;
    netBalance.classList.add('negative');

    balanceStatus.textContent =
      'You owe overall';
    balanceStatus.classList.add('negative');

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
     VIEW SWITCHING & SIDEBAR NAVIGATION CONTROLLER
  ========================================================= */
  const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
  const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
  const dashboardSidebar = document.getElementById('dashboardSidebar');
  const sidebarBackdrop = document.getElementById('sidebarBackdrop');

  const navDashboard = document.getElementById('navDashboard');
  const navGroups = document.getElementById('navGroups');
  const navMonthlySpending = document.getElementById('navMonthlySpending');
  const navAnalytics = document.getElementById('navAnalytics');

  const viewDashboard = document.getElementById('viewDashboard');
  const viewMonthlySpending = document.getElementById('viewMonthlySpending');
  const viewAnalytics = document.getElementById('viewAnalytics');

  const backFromMonthlyBtn = document.getElementById('backFromMonthlyBtn');
  const backFromAnalyticsBtn = document.getElementById('backFromAnalyticsBtn');
  const viewMonthlyFromActivityBtn = document.getElementById('viewMonthlyFromActivityBtn');
  const goToAnalyticsFromMonthlyBtn = document.getElementById('goToAnalyticsFromMonthlyBtn');

  let sidebarLastFocus = null;

  function openSidebar() {
    if (!dashboardSidebar) return;
    sidebarLastFocus = document.activeElement;
    dashboardSidebar.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('open');
    document.body.classList.add('sidebar-open');
    dashboardSidebar.setAttribute('aria-hidden', 'false');
    if (sidebarToggleBtn) sidebarToggleBtn.setAttribute('aria-expanded', 'true');
    setTimeout(() => {
      if (sidebarCloseBtn) sidebarCloseBtn.focus();
    }, 50);
  }

  function closeSidebar() {
    if (!dashboardSidebar) return;
    dashboardSidebar.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
    document.body.classList.remove('sidebar-open');
    dashboardSidebar.setAttribute('aria-hidden', 'true');
    if (sidebarToggleBtn) sidebarToggleBtn.setAttribute('aria-expanded', 'false');
    restoreFocusSafe(sidebarLastFocus);
  }

  function syncSidebarMode() {
    if (!dashboardSidebar) return;
    dashboardSidebar.setAttribute('role', 'dialog');
    dashboardSidebar.setAttribute('aria-modal', 'true');
    const isOpen = dashboardSidebar.classList.contains('open');
    dashboardSidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (sidebarToggleBtn) {
      sidebarToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  window.addEventListener('resize', syncSidebarMode);
  syncSidebarMode();

  if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

  function updateSidebarActive(activeNavId) {
    [navDashboard, navGroups, navMonthlySpending, navAnalytics].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
    const target = document.getElementById(activeNavId);
    if (target) target.classList.add('active');
  }

  function switchView(viewName, scrollTarget = null) {
    if (!viewDashboard || !viewMonthlySpending || !viewAnalytics) return;

    viewDashboard.style.display = 'none';
    viewDashboard.classList.remove('active');
    viewMonthlySpending.style.display = 'none';
    viewMonthlySpending.classList.remove('active');
    viewAnalytics.style.display = 'none';
    viewAnalytics.classList.remove('active');

    if (viewName === 'monthly-spending') {
      viewMonthlySpending.style.display = 'block';
      viewMonthlySpending.classList.add('active');
      updateSidebarActive('navMonthlySpending');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (viewName === 'analytics') {
      viewAnalytics.style.display = 'block';
      viewAnalytics.classList.add('active');
      updateSidebarActive('navAnalytics');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Default: 'dashboard' or 'groups'
      viewDashboard.style.display = 'block';
      viewDashboard.classList.add('active');
      updateSidebarActive(viewName === 'groups' ? 'navGroups' : 'navDashboard');

      if (scrollTarget) {
        setTimeout(() => {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  // Sidebar item navigation click handlers
  if (navDashboard) {
    navDashboard.addEventListener('click', () => {
      closeSidebar();
      if (window.location.hash !== '#dashboard') {
        history.pushState(null, '', '#dashboard');
      }
      switchView('dashboard');
    });
  }

  if (navGroups) {
    navGroups.addEventListener('click', () => {
      closeSidebar();
      if (window.location.hash !== '#groups') {
        history.pushState(null, '', '#groups');
      }
      const groupsSec = document.getElementById('groupsSection') || document.querySelector('.groups-section');
      switchView('groups', groupsSec);
    });
  }

  if (navMonthlySpending) {
    navMonthlySpending.addEventListener('click', () => {
      closeSidebar();
      if (window.location.hash !== '#monthly-spending') {
        history.pushState(null, '', '#monthly-spending');
      }
      switchView('monthly-spending');
    });
  }

  if (navAnalytics) {
    navAnalytics.addEventListener('click', () => {
      closeSidebar();
      if (window.location.hash !== '#analytics') {
        history.pushState(null, '', '#analytics');
      }
      switchView('analytics');
    });
  }

  // Back navigation buttons
  if (backFromMonthlyBtn) {
    backFromMonthlyBtn.addEventListener('click', () => {
      history.pushState(null, '', '#dashboard');
      switchView('dashboard');
    });
  }

  if (backFromAnalyticsBtn) {
    backFromAnalyticsBtn.addEventListener('click', () => {
      history.pushState(null, '', '#dashboard');
      switchView('dashboard');
    });
  }

  if (viewMonthlyFromActivityBtn) {
    viewMonthlyFromActivityBtn.addEventListener('click', () => {
      history.pushState(null, '', '#monthly-spending');
      switchView('monthly-spending');
    });
  }

  if (goToAnalyticsFromMonthlyBtn) {
    goToAnalyticsFromMonthlyBtn.addEventListener('click', () => {
      history.pushState(null, '', '#analytics');
      switchView('analytics');
    });
  }

  window.addEventListener('hashchange', () => {
    const hash = (window.location.hash || '').replace('#', '');
    if (hash === 'monthly-spending') {
      switchView('monthly-spending');
    } else if (hash === 'analytics') {
      switchView('analytics');
    } else if (hash === 'groups') {
      const groupsSec = document.getElementById('groupsSection') || document.querySelector('.groups-section');
      switchView('groups', groupsSec);
    } else {
      switchView('dashboard');
    }
  });

  const initialHash = (window.location.hash || '').replace('#', '');
  if (initialHash === 'monthly-spending' || initialHash === 'analytics' || initialHash === 'groups') {
    const groupsSec = initialHash === 'groups' ? (document.getElementById('groupsSection') || document.querySelector('.groups-section')) : null;
    switchView(initialHash, groupsSec);
  } else {
    switchView('dashboard');
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

  /* Phone verification elements in Settings */
  const settingsPhoneStatusPill = document.getElementById('settingsPhoneStatusPill');
  const settingsPhoneAlert = document.getElementById('settingsPhoneAlert');
  const settingsPhoneVerifiedView = document.getElementById('settingsPhoneVerifiedView');
  const settingsPhoneVerifiedDisplay = document.getElementById('settingsPhoneVerifiedDisplay');
  const settingsPhoneVerifiedAt = document.getElementById('settingsPhoneVerifiedAt');
  const changePhoneBtn = document.getElementById('changePhoneBtn');
  const removePhoneBtn = document.getElementById('removePhoneBtn');

  const settingsPhoneRequestView = document.getElementById('settingsPhoneRequestView');
  const settingsPhoneInput = document.getElementById('settingsPhoneInput');
  const sendPhoneCodeBtn = document.getElementById('sendPhoneCodeBtn');
  const settingsCancelChangeRow = document.getElementById('settingsCancelChangeRow');
  const cancelChangePhoneBtn = document.getElementById('cancelChangePhoneBtn');

  const settingsPhoneVerifyView = document.getElementById('settingsPhoneVerifyView');
  const settingsPhoneMasked = document.getElementById('settingsPhoneMasked');
  const settingsPhoneOtpInput = document.getElementById('settingsPhoneOtpInput');
  const verifyPhoneCodeBtn = document.getElementById('verifyPhoneCodeBtn');
  const editPhoneInputBtn = document.getElementById('editPhoneInputBtn');
  const resendPhoneCodeBtn = document.getElementById('resendPhoneCodeBtn');

  let currentPhoneData = {
    phoneNumber: null,
    phoneVerified: false,
    phoneVerifiedAt: null
  };
  let pendingVerificationPhone = '';
  let phoneCooldownTimer = null;
  let phoneCooldownSeconds = 0;

  function stopPhoneCooldown() {
    if (phoneCooldownTimer) {
      clearInterval(phoneCooldownTimer);
      phoneCooldownTimer = null;
    }
    if (resendPhoneCodeBtn) {
      resendPhoneCodeBtn.disabled = false;
      resendPhoneCodeBtn.textContent = 'Resend code';
    }
  }

  function startPhoneCooldown(seconds = 60) {
    if (!resendPhoneCodeBtn) return;
    if (phoneCooldownTimer) clearInterval(phoneCooldownTimer);

    phoneCooldownSeconds = seconds;
    resendPhoneCodeBtn.disabled = true;
    resendPhoneCodeBtn.innerHTML = `Resend code (<span id="settingsPhoneCooldown">${phoneCooldownSeconds}</span>s)`;

    phoneCooldownTimer = setInterval(() => {
      phoneCooldownSeconds -= 1;
      const cooldownEl = document.getElementById('settingsPhoneCooldown');
      if (cooldownEl) {
        cooldownEl.textContent = phoneCooldownSeconds;
      }
      if (phoneCooldownSeconds <= 0) {
        clearInterval(phoneCooldownTimer);
        phoneCooldownTimer = null;
        resendPhoneCodeBtn.disabled = false;
        resendPhoneCodeBtn.textContent = 'Resend code';
      }
    }, 1000);
  }

  function renderPhoneSectionUi(data) {
    if (settingsPhoneAlert) hideAlert(settingsPhoneAlert);

    const isVerified = Boolean(data && data.phoneVerified && data.phoneNumber);
    const hasUnverifiedPhone = Boolean(data && data.phoneNumber && !data.phoneVerified);

    if (isVerified) {
      if (settingsPhoneStatusPill) {
        settingsPhoneStatusPill.className = 'notif-pill notif-pill-active';
        settingsPhoneStatusPill.textContent = 'Verified';
      }
      if (settingsPhoneVerifiedDisplay) {
        settingsPhoneVerifiedDisplay.textContent = data.phoneNumber;
      }
      if (settingsPhoneVerifiedAt) {
        if (data.phoneVerifiedAt) {
          try {
            const dateStr = new Date(data.phoneVerifiedAt).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            });
            settingsPhoneVerifiedAt.textContent = `Verified on: ${dateStr}`;
          } catch {
            settingsPhoneVerifiedAt.textContent = 'Verified';
          }
        } else {
          settingsPhoneVerifiedAt.textContent = 'Verified';
        }
      }

      if (settingsPhoneVerifiedView) settingsPhoneVerifiedView.style.display = 'block';
      if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'none';
      if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'none';
      if (settingsCancelChangeRow) settingsCancelChangeRow.style.display = 'none';
    } else if (hasUnverifiedPhone) {
      if (settingsPhoneStatusPill) {
        settingsPhoneStatusPill.className = 'notif-pill notif-pill-warning';
        settingsPhoneStatusPill.textContent = 'Unverified';
      }
      if (settingsPhoneInput && !pendingVerificationPhone) {
        settingsPhoneInput.value = data.phoneNumber;
      }
      if (pendingVerificationPhone && settingsPhoneVerifyView && settingsPhoneVerifyView.style.display === 'block') {
        if (settingsPhoneVerifiedView) settingsPhoneVerifiedView.style.display = 'none';
        if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'none';
      } else {
        if (settingsPhoneVerifiedView) settingsPhoneVerifiedView.style.display = 'none';
        if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'block';
        if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'none';
      }
      if (settingsCancelChangeRow) settingsCancelChangeRow.style.display = 'none';
    } else {
      if (settingsPhoneStatusPill) {
        settingsPhoneStatusPill.className = 'notif-pill notif-pill-disabled';
        settingsPhoneStatusPill.textContent = 'Not configured';
      }
      if (pendingVerificationPhone && settingsPhoneVerifyView && settingsPhoneVerifyView.style.display === 'block') {
        if (settingsPhoneVerifiedView) settingsPhoneVerifiedView.style.display = 'none';
        if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'none';
      } else {
        if (settingsPhoneVerifiedView) settingsPhoneVerifiedView.style.display = 'none';
        if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'block';
        if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'none';
      }
      if (settingsCancelChangeRow) settingsCancelChangeRow.style.display = 'none';
    }
  }

  function validateE164Format(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const clean = raw.trim();
    if (!clean.startsWith('+')) return false;
    if (/[a-zA-Z]/.test(clean)) return false;
    const digitsOnly = clean.replace(/\D/g, '');
    return digitsOnly.length >= 7 && digitsOnly.length <= 15;
  }

  // Change Phone Button
  if (changePhoneBtn) {
    changePhoneBtn.addEventListener('click', () => {
      if (settingsPhoneAlert) hideAlert(settingsPhoneAlert);
      if (settingsPhoneVerifiedView) settingsPhoneVerifiedView.style.display = 'none';
      if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'none';
      if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'block';
      if (settingsCancelChangeRow) settingsCancelChangeRow.style.display = 'block';
      if (settingsPhoneInput) {
        settingsPhoneInput.value = '';
        settingsPhoneInput.focus();
      }
    });
  }

  // Cancel Change Button
  if (cancelChangePhoneBtn) {
    cancelChangePhoneBtn.addEventListener('click', () => {
      if (settingsPhoneAlert) hideAlert(settingsPhoneAlert);
      renderPhoneSectionUi(currentPhoneData);
    });
  }

  // Edit Phone from OTP Screen Button
  if (editPhoneInputBtn) {
    editPhoneInputBtn.addEventListener('click', () => {
      if (settingsPhoneAlert) hideAlert(settingsPhoneAlert);
      if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'none';
      if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'block';
      if (currentPhoneData.phoneVerified && settingsCancelChangeRow) {
        settingsCancelChangeRow.style.display = 'block';
      }
      if (settingsPhoneInput) {
        if (pendingVerificationPhone) settingsPhoneInput.value = pendingVerificationPhone;
        settingsPhoneInput.focus();
      }
    });
  }

  // Send Code Handler
  async function handleSendPhoneCode() {
    if (!settingsPhoneInput) return;
    const rawNumber = settingsPhoneInput.value.trim();

    if (!validateE164Format(rawNumber)) {
      showAlert(
        settingsPhoneAlert,
        'Phone number must include an international country code starting with "+" (e.g. +919876543210 or +14155552671)',
        'error'
      );
      settingsPhoneInput.focus();
      return;
    }

    try {
      hideAlert(settingsPhoneAlert);
      sendPhoneCodeBtn.disabled = true;
      sendPhoneCodeBtn.dataset.origText = sendPhoneCodeBtn.textContent;
      sendPhoneCodeBtn.textContent = 'Sending...';

      const res = await api('/auth/phone/start-verification', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: rawNumber })
      });

      pendingVerificationPhone = rawNumber;
      if (settingsPhoneMasked) {
        settingsPhoneMasked.textContent = res.phoneMasked || rawNumber;
      }

      if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'none';
      if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'block';
      if (settingsPhoneOtpInput) {
        settingsPhoneOtpInput.value = '';
        settingsPhoneOtpInput.focus();
      }

      startPhoneCooldown(res.cooldownSeconds || 60);
      showAlert(settingsPhoneAlert, res.message || 'Verification code sent', 'success');
    } catch (err) {
      showAlert(settingsPhoneAlert, err.message || 'Failed to send verification code', 'error');
    } finally {
      if (sendPhoneCodeBtn) {
        sendPhoneCodeBtn.disabled = false;
        sendPhoneCodeBtn.textContent = sendPhoneCodeBtn.dataset.origText || 'Send Code';
      }
    }
  }

  if (sendPhoneCodeBtn) {
    sendPhoneCodeBtn.addEventListener('click', handleSendPhoneCode);
  }

  // Resend Code Handler
  if (resendPhoneCodeBtn) {
    resendPhoneCodeBtn.addEventListener('click', async () => {
      if (!pendingVerificationPhone) return;
      try {
        hideAlert(settingsPhoneAlert);
        resendPhoneCodeBtn.disabled = true;
        resendPhoneCodeBtn.textContent = 'Sending...';

        const res = await api('/auth/phone/start-verification', {
          method: 'POST',
          body: JSON.stringify({ phoneNumber: pendingVerificationPhone })
        });

        startPhoneCooldown(res.cooldownSeconds || 60);
        showAlert(settingsPhoneAlert, res.message || 'A new verification code has been sent', 'success');
      } catch (err) {
        showAlert(settingsPhoneAlert, err.message || 'Failed to resend code', 'error');
        resendPhoneCodeBtn.disabled = false;
        resendPhoneCodeBtn.textContent = 'Resend code';
      }
    });
  }

  // Verify Code Handler
  async function handleVerifyPhoneCode() {
    if (!settingsPhoneOtpInput) return;
    const otp = settingsPhoneOtpInput.value.trim();

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      showAlert(settingsPhoneAlert, 'Verification code must be a 6-digit number', 'error');
      settingsPhoneOtpInput.focus();
      return;
    }

    try {
      hideAlert(settingsPhoneAlert);
      verifyPhoneCodeBtn.disabled = true;
      verifyPhoneCodeBtn.dataset.origText = verifyPhoneCodeBtn.textContent;
      verifyPhoneCodeBtn.textContent = 'Verifying...';

      const res = await api('/auth/phone/confirm-verification', {
        method: 'POST',
        body: JSON.stringify({
          otp,
          phoneNumber: pendingVerificationPhone || undefined
        })
      });

      stopPhoneCooldown();
      pendingVerificationPhone = '';

      if (res && res.user) {
        currentPhoneData = {
          phoneNumber: res.user.phoneNumber,
          phoneVerified: Boolean(res.user.phoneVerified),
          phoneVerifiedAt: res.user.phoneVerifiedAt || new Date().toISOString()
        };

        const localUser = getUser();
        if (localUser) {
          localUser.phoneNumber = currentPhoneData.phoneNumber;
          localUser.phoneVerified = currentPhoneData.phoneVerified;
          localUser.phoneVerifiedAt = currentPhoneData.phoneVerifiedAt;
          localStorage.setItem('lendlocal_user', JSON.stringify(localUser));
        }
      }

      renderPhoneSectionUi(currentPhoneData);
      showAlert(settingsPhoneAlert, res.message || 'Phone number verified successfully', 'success');
      if (window.FX) {
        window.FX.confetti();
      }
    } catch (err) {
      showAlert(settingsPhoneAlert, err.message || 'Invalid verification code', 'error');
      if (err.message && (err.message.includes('exhausted') || err.message.includes('expired'))) {
        stopPhoneCooldown();
        if (settingsPhoneVerifyView) settingsPhoneVerifyView.style.display = 'none';
        if (settingsPhoneRequestView) settingsPhoneRequestView.style.display = 'block';
      }
    } finally {
      if (verifyPhoneCodeBtn) {
        verifyPhoneCodeBtn.disabled = false;
        verifyPhoneCodeBtn.textContent = verifyPhoneCodeBtn.dataset.origText || 'Verify Code';
      }
    }
  }

  if (verifyPhoneCodeBtn) {
    verifyPhoneCodeBtn.addEventListener('click', handleVerifyPhoneCode);
  }

  if (settingsPhoneOtpInput) {
    settingsPhoneOtpInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleVerifyPhoneCode();
      }
    });
  }

  // Remove Phone Handler
  if (removePhoneBtn) {
    removePhoneBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'Are you sure you want to remove your verified phone number? You will no longer be able to recover your account via SMS.'
      );
      if (!confirmed) return;

      try {
        hideAlert(settingsPhoneAlert);
        removePhoneBtn.disabled = true;
        removePhoneBtn.textContent = 'Removing...';

        const res = await api('/auth/phone', { method: 'DELETE' });

        stopPhoneCooldown();
        pendingVerificationPhone = '';
        currentPhoneData = {
          phoneNumber: null,
          phoneVerified: false,
          phoneVerifiedAt: null
        };

        const localUser = getUser();
        if (localUser) {
          localUser.phoneNumber = null;
          localUser.phoneVerified = false;
          localUser.phoneVerifiedAt = null;
          localStorage.setItem('lendlocal_user', JSON.stringify(localUser));
        }

        if (settingsPhoneInput) settingsPhoneInput.value = '';
        renderPhoneSectionUi(currentPhoneData);
        showAlert(settingsPhoneAlert, res.message || 'Phone number removed successfully', 'success');
      } catch (err) {
        showAlert(settingsPhoneAlert, err.message || 'Failed to remove phone number', 'error');
      } finally {
        if (removePhoneBtn) {
          removePhoneBtn.disabled = false;
          removePhoneBtn.textContent = 'Remove';
        }
      }
    });
  }

  let settingsModalLastFocus = null;
  let settingsFocusTimeout;

  function openSettingsModal() {
    closeSidebar();
    settingsModalLastFocus = document.activeElement;
    hideAlert(settingsAlert);
    if (settingsPhoneAlert) hideAlert(settingsPhoneAlert);
    upiIdInput.value = '';
    settingsModal.classList.add('open');
    document.body.classList.add('modal-open');

    // Ensure settings modal always starts at top of scrollable content
    const modalBody = settingsModal.querySelector('.modal-body-scroll');
    if (modalBody) {
      modalBody.scrollTop = 0;
    }

    if (window.syncNotificationSettingsUi) {
      window.syncNotificationSettingsUi();
    }

    clearTimeout(settingsFocusTimeout);
    settingsFocusTimeout = setTimeout(() => {
      if (settingsModal.classList.contains('open')) {
        // Place initial focus on close button without auto-scrolling to UPI section
        if (closeSettingsBtn) {
          closeSettingsBtn.focus({ preventScroll: true });
        }
      }
    }, 50);

    upiIdInput.placeholder = 'Loading...';

    api('/auth/me', { method: 'GET' })
      .then(data => {
        upiIdInput.placeholder = 'username@bank';
        if (data && data.user) {
          if (data.user.upiId) {
            upiIdInput.value = data.user.upiId;
          }
          currentPhoneData = {
            phoneNumber: data.user.phoneNumber || null,
            phoneVerified: Boolean(data.user.phoneVerified),
            phoneVerifiedAt: data.user.phoneVerifiedAt || null
          };
          renderPhoneSectionUi(currentPhoneData);
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
    hideAlert(settingsAlert);
    if (settingsPhoneAlert) hideAlert(settingsPhoneAlert);
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
      if (dashboardSidebar?.classList.contains('open')) {
        closeSidebar();
      } else if (settingsModal?.classList.contains('open')) {
        closeSettings();
      } else if (createModal?.classList.contains('open')) {
        closeCreateModal();
      }
    }
  });

  const installAppBtn = document.getElementById('installAppBtn');
  if (installAppBtn) {
    installAppBtn.addEventListener('click', () => {
      closeSidebar();
    });
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      closeSidebar();
    });
  }

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
     MONTHLY SPENDING ANALYTICS & RECENT ACTIVITY
  ========================================================= */

  let analyticsYear = new Date().getFullYear();
  let analyticsMonth = new Date().getMonth() + 1; // 1-12

  const prevMonthBtn = document.getElementById('prevMonthBtn');
  const nextMonthBtn = document.getElementById('nextMonthBtn');
  const currentMonthLabel = document.getElementById('currentMonthLabel');

  const analyticsPrevMonthBtn = document.getElementById('analyticsPrevMonthBtn');
  const analyticsNextMonthBtn = document.getElementById('analyticsNextMonthBtn');
  const analyticsMonthLabel = document.getElementById('analyticsMonthLabel');

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
  const dashboardRecentActivityList = document.getElementById('dashboardRecentActivityList');

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function getCategoryEmoji(cat) {
    const c = String(cat || '').toLowerCase();
    if (c.includes('food') || c.includes('dinner') || c.includes('lunch') || c.includes('cafe')) return '🍔';
    if (c.includes('transport') || c.includes('travel') || c.includes('cab') || c.includes('fuel')) return '🚗';
    if (c.includes('grocer') || c.includes('supermarket')) return '🛒';
    if (c.includes('rent') || c.includes('house') || c.includes('home')) return '🏠';
    if (c.includes('util') || c.includes('bill') || c.includes('wifi') || c.includes('electricity')) return '💡';
    if (c.includes('movie') || c.includes('event') || c.includes('fun') || c.includes('game')) return '🎬';
    return '📦';
  }

  async function loadMonthlyAnalytics(year, month) {
    const now = new Date();
    const isCurrentOrFuture = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);

    const monthText = `${monthNames[month - 1].slice(0, 3)} ${year}`;
    if (currentMonthLabel) currentMonthLabel.textContent = monthText;
    if (analyticsMonthLabel) analyticsMonthLabel.textContent = monthText;

    [nextMonthBtn, analyticsNextMonthBtn].forEach(btn => {
      if (btn) {
        btn.disabled = isCurrentOrFuture;
        btn.style.opacity = isCurrentOrFuture ? '0.4' : '1';
        btn.style.cursor = isCurrentOrFuture ? 'not-allowed' : 'pointer';
      }
    });

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

      // Detailed Monthly Expenses List (in Analytics View)
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

      // Homepage Recent Activity Feed
      if (dashboardRecentActivityList) {
        if (!data.recentExpenses || data.recentExpenses.length === 0) {
          dashboardRecentActivityList.innerHTML = `
            <div class="empty-activity-card">
              <span class="empty-activity-icon" aria-hidden="true">🧾</span>
              <div>
                <strong style="display: block; color: var(--ll-text); font-size: 0.9rem;">No recent expenses recorded</strong>
                <p style="margin-top: 0.2rem; font-size: 0.8rem; color: var(--ll-text-muted);">Shared expenses you add or participate in will appear here.</p>
              </div>
            </div>
          `;
        } else {
          const recentItems = data.recentExpenses.slice(0, 6);
          dashboardRecentActivityList.innerHTML = recentItems.map((ex) => {
            const dateStr = new Date(ex.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const catEmoji = getCategoryEmoji(ex.category);
            return `
              <div class="recent-expense-card">
                <div class="recent-expense-left">
                  <span class="category-icon-pill" aria-hidden="true">${catEmoji}</span>
                  <div style="min-width: 0;">
                    <div class="recent-expense-title">${escapeHtml(ex.description)}</div>
                    <div class="recent-expense-meta">
                      <span class="group-tag">${escapeHtml(ex.groupName)}</span>
                      <span>&bull;</span>
                      <span>${escapeHtml(ex.category)}</span>
                      <span>&bull;</span>
                      <span>${dateStr}</span>
                    </div>
                  </div>
                </div>
                <div class="recent-expense-right">
                  <div class="recent-expense-amount">
                    ${formatMoney(ex.userShare > 0 ? ex.userShare : ex.totalAmount)}
                  </div>
                  <div class="recent-expense-status ${ex.isPayer ? 'paid-by-you' : 'share-label'}">
                    ${ex.isPayer ? 'You paid ' + formatMoney(ex.totalAmount) : 'Your share: ' + formatMoney(ex.userShare)}
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

  function handlePrevMonth() {
    if (analyticsMonth === 1) {
      analyticsMonth = 12;
      analyticsYear -= 1;
    } else {
      analyticsMonth -= 1;
    }
    loadMonthlyAnalytics(analyticsYear, analyticsMonth);
  }

  function handleNextMonth() {
    const now = new Date();
    if (analyticsYear > now.getFullYear() || (analyticsYear === now.getFullYear() && analyticsMonth >= now.getMonth() + 1)) {
      return;
    }
    if (analyticsMonth === 12) {
      analyticsMonth = 1;
      analyticsYear += 1;
    } else {
      analyticsMonth += 1;
    }
    loadMonthlyAnalytics(analyticsYear, analyticsMonth);
  }

  if (prevMonthBtn) prevMonthBtn.addEventListener('click', handlePrevMonth);
  if (analyticsPrevMonthBtn) analyticsPrevMonthBtn.addEventListener('click', handlePrevMonth);
  if (nextMonthBtn) nextMonthBtn.addEventListener('click', handleNextMonth);
  if (analyticsNextMonthBtn) analyticsNextMonthBtn.addEventListener('click', handleNextMonth);

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