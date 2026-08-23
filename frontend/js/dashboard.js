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

  document
    .getElementById('openCreate')
    ?.addEventListener('click', () => {

      hideAlert(createAlert);

      createForm.reset();

      createModal.classList.add('open');
    });


  document
    .getElementById('closeCreate')
    ?.addEventListener('click', () => {

      createModal.classList.remove('open');

    });


  document
    .getElementById('closeCreateAlt')
    ?.addEventListener('click', () => {

      createModal.classList.remove('open');

    });


  createModal?.addEventListener('click', (e) => {

    if (e.target === createModal) {

      createModal.classList.remove('open');

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

        hideAlert(createAlert);

        createForm.reset();

        createModal.classList.add('open');

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

            balanceLabel =
              'Settled';

          } else if (balance > 0) {

            balanceLabel =
              `Owed ${formatMoney(
                balance
              )}`;

          } else {

            balanceLabel =
              `You owe ${formatMoney(
                Math.abs(balance)
              )}`;

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

  async function loadGroups() {

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

                console.error(
                  `Failed to load balance for group ${group.id}:`,
                  error
                );


                /*
                 * If one group's balance fails,
                 * don't break the entire dashboard.
                 */

                return {

                  ...group,

                  myBalance: 0,

                };

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
        ?.addEventListener(
          'click',
          loadGroups
        );

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
     INITIAL LOAD
  ========================================================= */

  loadGroups();

}