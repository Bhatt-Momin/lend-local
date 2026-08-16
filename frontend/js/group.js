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

  const expenseModal =
    document.getElementById('expenseModal');

  const expenseForm =
    document.getElementById('expenseForm');

  const expenseAlert =
    document.getElementById('expenseAlert');

  const splitList =
    document.getElementById('splitList');

  /* =========================================================
     USER AVATAR
  ========================================================= */

  const userAvatar =
    document.getElementById('userAvatar');

  if (userAvatar && me) {
    const name = me.name || 'U';

    userAvatar.textContent =
      name.charAt(0).toUpperCase();
  }

  /* =========================================================
     TABS
  ========================================================= */

  document
    .querySelectorAll('.tab')
    .forEach((tab) => {
      tab.addEventListener('click', () => {
        document
          .querySelectorAll('.tab')
          .forEach((t) => {
            t.classList.remove('active');
          });

        document
          .querySelectorAll('.panel')
          .forEach((panel) => {
            panel.classList.remove('active');
          });

        tab.classList.add('active');

        const panel =
          document.getElementById(
            `panel-${tab.dataset.tab}`
          );

        if (panel) {
          panel.classList.add('active');
        }
      });
    });

  /* =========================================================
     EXPENSE MODAL
  ========================================================= */

  function closeExpenseModal() {
    expenseModal.classList.remove('open');

    hideAlert(expenseAlert);
  }

  document
    .getElementById('openExpense')
    .addEventListener('click', () => {
      hideAlert(expenseAlert);

      expenseForm.reset();

      expenseForm.date.value =
        new Date()
          .toISOString()
          .slice(0, 10);

      renderSplitInputs('equal');

      expenseModal.classList.add('open');
    });

  /* X BUTTON */

  const closeExpense =
    document.getElementById('closeExpense');

  if (closeExpense) {
    closeExpense.addEventListener(
      'click',
      closeExpenseModal
    );
  }

  /* CANCEL BUTTON */

  const closeExpenseSecondary =
    document.getElementById(
      'closeExpenseSecondary'
    );

  if (closeExpenseSecondary) {
    closeExpenseSecondary.addEventListener(
      'click',
      closeExpenseModal
    );
  }

  /* CLICK OUTSIDE MODAL */

  expenseModal.addEventListener(
    'click',
    (e) => {
      if (e.target === expenseModal) {
        closeExpenseModal();
      }
    }
  );

  /* ESC KEY */

  document.addEventListener(
    'keydown',
    (e) => {
      if (
        e.key === 'Escape' &&
        expenseModal.classList.contains('open')
      ) {
        closeExpenseModal();
      }
    }
  );

  /* =========================================================
     SPLIT TYPE
  ========================================================= */

  document
    .getElementById('expSplitType')
    .addEventListener('change', (e) => {
      renderSplitInputs(e.target.value);
    });

  document
    .getElementById('expAmount')
    .addEventListener('input', () => {
      const splitType =
        document.getElementById(
          'expSplitType'
        ).value;

      if (splitType === 'equal') {
        renderSplitInputs('equal');
      }
    });

  /* =========================================================
     HELPERS
  ========================================================= */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* =========================================================
     SPLIT INPUTS
  ========================================================= */

  function renderSplitInputs(type) {
    const amount =
      Number(
        document.getElementById(
          'expAmount'
        ).value
      ) || 0;

    const equalShare =
      members.length
        ? Math.round(
            (amount / members.length) * 100
          ) / 100
        : 0;

    splitList.innerHTML = members
      .map((member) => {
        const userId =
          member.id || member._id;

        if (type === 'custom') {
          return `
            <div class="split-row">
              <label>
                <input
                  type="checkbox"
                  class="split-check"
                  data-user="${userId}"
                  checked
                />

                ${escapeHtml(member.name)}
              </label>

              <input
                type="number"
                class="split-share"
                data-user="${userId}"
                min="0"
                step="0.01"
                value="${equalShare}"
              />
            </div>
          `;
        }

        return `
          <div class="split-row">
            <label>
              <input
                type="checkbox"
                class="split-check"
                data-user="${userId}"
                checked
              />

              ${escapeHtml(member.name)}
            </label>

            <span
              style="
                color: var(--muted);
                font-size: 0.9rem;
              "
            >
              ${formatMoney(equalShare)} each
            </span>
          </div>
        `;
      })
      .join('');
  }

  /* =========================================================
     PAID BY
  ========================================================= */

  function renderPaidBy() {
    const select =
      document.getElementById('expPaidBy');

    select.innerHTML = members
      .map((member) => {
        const userId =
          member.id || member._id;

        return `
          <option
            value="${userId}"
            ${
              String(userId) ===
              String(me.id || me._id)
                ? 'selected'
                : ''
            }
          >
            ${escapeHtml(member.name)}
          </option>
        `;
      })
      .join('');
  }

  /* =========================================================
     LOAD GROUP DATA
  ========================================================= */

  async function loadAll() {
    const [
      groupRes,
      expenseRes,
      balanceRes,
    ] = await Promise.all([
      api(`/groups/${groupId}`),

      api(`/expenses/${groupId}`),

      api(`/balances/${groupId}`),
    ]);

    group = groupRes.group;

    members = group.members || [];

    document.title =
      `${group.name} — LendLocal`;

    document.getElementById(
      'groupName'
    ).textContent = group.name;

    document.getElementById(
      'groupDesc'
    ).textContent =
      group.description ||
      `${members.length} members`;

    const statTotal =
      document.getElementById('statTotal');

    const statCount =
      document.getElementById('statCount');

    const mineEl =
      document.getElementById('statMine');

    const mine =
      (balanceRes.balances || []).find(
        (balance) =>
          String(balance.userId) ===
          String(me.id || me._id)
      );

    const myNet =
      mine ? mine.net : 0;

    /* Statistics */

    if (window.FX) {
      window.FX.animateNumber(
        statTotal,
        balanceRes.totalSpent || 0,
        {
          prefix: '₹',
          decimals: 2,
        }
      );

      window.FX.animateNumber(
        statCount,
        balanceRes.expenseCount || 0,
        {
          decimals: 0,
        }
      );
    } else {
      statTotal.textContent =
        formatMoney(
          balanceRes.totalSpent || 0
        );

      statCount.textContent =
        String(
          balanceRes.expenseCount || 0
        );
    }

    /* Your balance */

    mineEl.textContent =
      Math.abs(myNet) < 0.01
        ? 'Settled'
        : myNet > 0
          ? `+${formatMoney(myNet)}`
          : `−${formatMoney(
              Math.abs(myNet)
            )}`;

    mineEl.className = `value ${
      myNet > 0.01
        ? 'positive'
        : myNet < -0.01
          ? 'negative'
          : ''
    }`;

    renderExpenses(
      expenseRes.expenses || []
    );

    renderBalances(balanceRes);

    renderMembers();

    renderPaidBy();
  }

  /* =========================================================
     EXPENSES
  ========================================================= */

  function renderExpenses(expenses) {
    const list =
      document.getElementById('expenseList');

    if (!expenses.length) {
      list.innerHTML = `
        <div class="empty">
          <strong>No expenses yet</strong>
          Add the first shared cost for this group.
        </div>
      `;

      return;
    }

    list.innerHTML = expenses
      .map((expense) => `
        <article class="expense-item">

          <div>
            <h4>
              ${escapeHtml(
                expense.description
              )}
            </h4>

            <div class="meta">
              ${escapeHtml(
                expense.category
              )}
              · Paid by
              ${escapeHtml(
                expense.paidBy.name
              )}
              ·
              ${formatDate(expense.date)}
            </div>
          </div>

          <div class="amount">
            ${formatMoney(expense.amount)}
          </div>

          <div class="actions">
            <button
              class="btn btn-danger"
              type="button"
              data-delete="${expense.id}"
            >
              Delete
            </button>
          </div>

        </article>
      `)
      .join('');

    if (window.FX) {
      window.FX.staggerReveal(
        list,
        '.expense-item'
      );
    }

    list
      .querySelectorAll('[data-delete]')
      .forEach((btn) => {
        btn.addEventListener(
          'click',
          async () => {
            if (
              !confirm(
                'Delete this expense?'
              )
            ) {
              return;
            }

            try {
              const expenseItem =
                btn.closest(
                  '.expense-item'
                );

              await api(
                `/expenses/${btn.dataset.delete}`,
                {
                  method: 'DELETE',
                }
              );

              if (
                window.FX &&
                expenseItem
              ) {
                window.FX.removeWithAnimation(
                  expenseItem,
                  async () => {
                    window.FX.toast(
                      'Expense deleted'
                    );

                    await loadAll();
                  }
                );
              } else {
                await loadAll();
              }
            } catch (err) {
              alert(err.message);

              if (window.FX) {
                window.FX.shake(list);
              }
            }
          }
        );
      });
  }

  /* =========================================================
     BALANCES
  ========================================================= */

  function renderBalances(data) {
    const settlements =
      data.settlements || [];

    const balances =
      data.balances || [];

    const sList =
      document.getElementById(
        'settlementList'
      );

    if (!settlements.length) {
      sList.innerHTML = `
        <div class="empty">
          <strong>All settled</strong>
          No outstanding debts in this group.
        </div>
      `;
    } else {
      sList.innerHTML = settlements
        .map((settlement) => `
          <div class="settlement-item">

            <div class="flow">
              ${escapeHtml(
                settlement.from.name
              )}

              <span>owes</span>

              ${escapeHtml(
                settlement.to.name
              )}
            </div>

            <strong>
              ${formatMoney(
                settlement.amount
              )}
            </strong>

            <button
              class="pay-btn"
              type="button"
              data-pay="${settlement.amount}"
              data-to="${
                settlement.to.id ||
                settlement.to._id
              }"
            >
              Pay
              ${formatMoney(
                settlement.amount
              )}
            </button>

          </div>
        `)
        .join('');

      if (window.FX) {
        window.FX.staggerReveal(
          sList,
          '.settlement-item'
        );
      }

      sList
        .querySelectorAll('[data-pay]')
        .forEach((button) => {
          button.addEventListener(
            'click',
            () => {
              const amount =
                Number(
                  button.dataset.pay
                );

              const toUserId =
                button.dataset.to;

              startPayment(
                amount,
                toUserId
              );
            }
          );
        });
    }

    const balanceList =
      document.getElementById(
        'balanceList'
      );

    balanceList.innerHTML = balances
      .map((balance) => {
        const label =
          Math.abs(balance.net) < 0.01
            ? 'Settled'
            : balance.net > 0
              ? `owed ${formatMoney(
                  balance.net
                )}`
              : `owes ${formatMoney(
                  Math.abs(balance.net)
                )}`;

        return `
          <div class="balance-item">

            <div>
              ${escapeHtml(balance.name)}

              ${
                String(balance.userId) ===
                String(me.id || me._id)
                  ? ' (you)'
                  : ''
              }
            </div>

            <span
              class="balance-pill
              ${balanceClass(balance.net)}"
            >
              ${label}
            </span>

          </div>
        `;
      })
      .join('');

    if (window.FX) {
      window.FX.staggerReveal(
        balanceList,
        '.balance-item'
      );
    }
  }

  /* =========================================================
     MEMBERS
  ========================================================= */

  function renderMembers() {
    const memberList =
      document.getElementById(
        'memberList'
      );

    memberList.innerHTML = members
      .map((member) => {
        const userId =
          member.id || member._id;

        return `
          <div class="member-item">

            <div>
              <strong>
                ${escapeHtml(member.name)}

                ${
                  String(userId) ===
                  String(me.id || me._id)
                    ? ' (you)'
                    : ''
                }
              </strong>

              <div class="email">
                ${escapeHtml(member.email)}
              </div>
            </div>

          </div>
        `;
      })
      .join('');

    if (window.FX) {
      window.FX.staggerReveal(
        memberList,
        '.member-item'
      );
    }
  }

  /* =========================================================
     PAYMENT
  ========================================================= */

  async function startPayment(
    amount,
    toUserId
  ) {
    try {
      const order = await api(
        '/payment/create-order',
        {
          method: 'POST',

          body: JSON.stringify({
            amount,
            groupId,
            toUserId,
          }),
        }
      );

      const options = {
        key: 'rzp_test_TPv7QuxyBVkM0D',

        amount: order.amount,

        currency: order.currency,

        name: 'LendLocal',

        description:
          'Settlement Payment',

        order_id: order.id,

        handler: async function (
          response
        ) {
          try {
            const verification =
              await api(
                '/payment/verify-payment',
                {
                  method: 'POST',

                  body: JSON.stringify({
                    razorpay_payment_id:
                      response
                        .razorpay_payment_id,

                    razorpay_order_id:
                      response
                        .razorpay_order_id,

                    razorpay_signature:
                      response
                        .razorpay_signature,

                    amount,
                    groupId,
                    toUserId,
                  }),
                }
              );

            if (verification.success) {
              if (window.FX) {
                window.FX.toast(
                  'Payment verified successfully!'
                );

                window.FX.confettiBurst();
              } else {
                alert(
                  'Payment verified successfully!'
                );
              }

              setTimeout(
                async () => {
                  await loadAll();
                },
                500
              );
            } else {
              alert(
                'Payment verification failed.'
              );

              if (window.FX) {
                window.FX.toast(
                  'Payment verification failed'
                );
              }
            }
          } catch (error) {
            console.error(
              'Verification error:',
              error
            );

            alert(
              error.message ||
              'Payment verification failed'
            );
          }
        },

        prefill: {
          name: me.name || '',
          email: me.email || '',
        },

        theme: {
          color: '#0f5c4e',
        },
      };

      const razorpay =
        new Razorpay(options);

      razorpay.open();
    } catch (err) {
      console.error(
        'Payment error:',
        err
      );

      alert(
        err.message ||
        'Could not start payment. Please try again.'
      );
    }
  }

  /* =========================================================
     ADD MEMBER
  ========================================================= */

  document
    .getElementById('addMemberForm')
    .addEventListener(
      'submit',
      async (e) => {
        e.preventDefault();

        const alertEl =
          document.getElementById(
            'memberAlert'
          );

        hideAlert(alertEl);

        const email =
          document
            .getElementById(
              'memberEmail'
            )
            .value
            .trim();

        try {
          const data = await api(
            `/groups/${groupId}/members`,
            {
              method: 'POST',

              body: JSON.stringify({
                email,
              }),
            }
          );

          members =
            data.members || [];

          document.getElementById(
            'memberEmail'
          ).value = '';

          showAlert(
            alertEl,
            'Member added',
            'success'
          );

          if (window.FX) {
            window.FX.toast(
              'Member added successfully!'
            );
          }

          await loadAll();
        } catch (err) {
          showAlert(
            alertEl,
            err.message
          );

          if (window.FX) {
            window.FX.shake(alertEl);
          }
        }
      }
    );

  /* =========================================================
     ADD EXPENSE
  ========================================================= */

  expenseForm.addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();

      hideAlert(expenseAlert);

      const splitType =
        expenseForm.splitType.value;

      const checked = [
        ...document.querySelectorAll(
          '.split-check:checked'
        ),
      ];

      if (!checked.length) {
        showAlert(
          expenseAlert,
          'Select at least one participant'
        );

        if (window.FX) {
          window.FX.shake(
            expenseAlert
          );
        }

        return;
      }

      let splits;

      if (splitType === 'equal') {
        splits = checked.map(
          (checkbox) => ({
            user:
              checkbox.dataset.user,
          })
        );
      } else {
        splits = checked.map(
          (checkbox) => {
            const input =
              document.querySelector(
                `.split-share[data-user="${checkbox.dataset.user}"]`
              );

            return {
              user:
                checkbox.dataset.user,

              share:
                Number(input.value),
            };
          }
        );
      }

      try {
        await api('/expenses', {
          method: 'POST',

          body: JSON.stringify({
            groupId,

            description:
              expenseForm.description.value.trim(),

            amount:
              Number(
                expenseForm.amount.value
              ),

            paidBy:
              expenseForm.paidBy.value,

            splitType,

            splits,

            category:
              expenseForm.category.value,

            date:
              expenseForm.date.value ||
              undefined,
          }),
        });

        closeExpenseModal();

        if (window.FX) {
          window.FX.toast(
            'Expense added successfully!'
          );
        }

        await loadAll();
      } catch (err) {
        showAlert(
          expenseAlert,
          err.message
        );

        if (window.FX) {
          window.FX.shake(
            expenseAlert
          );
        }
      }
    }
  );

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  loadAll().catch((err) => {
    document.getElementById(
      'expenseList'
    ).innerHTML = `
      <div class="empty">
        <strong>Could not load group</strong>
        ${escapeHtml(err.message)}
      </div>
    `;
  });
}