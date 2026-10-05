if (!requireAuth()) {
  /* redirected */
} else {
  fillUserChip();
  wireLogout();

  const params =
    new URLSearchParams(
      window.location.search
    );

  const groupId =
    params.get('id');

  if (!groupId) {
    window.location.href =
      '/dashboard.html';
  }

  const me = getUser();

  let group = null;
  let members = [];

  const expenseModal =
    document.getElementById(
      'expenseModal'
    );

  const expenseForm =
    document.getElementById(
      'expenseForm'
    );

  const expenseAlert =
    document.getElementById(
      'expenseAlert'
    );

  const splitList =
    document.getElementById(
      'splitList'
    );

  /* =========================================================
     USER AVATAR
  ========================================================= */

  const userAvatar =
    document.getElementById(
      'userAvatar'
    );

  if (userAvatar && me) {
    const name =
      me.name || 'U';

    userAvatar.textContent =
      name
        .charAt(0)
        .toUpperCase();
  }

  /* =========================================================
     TABS
  ========================================================= */

  document
    .querySelectorAll('.tab')
    .forEach((tab) => {
      tab.addEventListener(
        'click',
        () => {
          document
            .querySelectorAll('.tab')
            .forEach((t) => {
              t.classList.remove(
                'active'
              );
            });

          document
            .querySelectorAll('.panel')
            .forEach((panel) => {
              panel.classList.remove(
                'active'
              );
            });

          tab.classList.add(
            'active'
          );

          const panel =
            document.getElementById(
              `panel-${tab.dataset.tab}`
            );

          if (panel) {
            panel.classList.add(
              'active'
            );
          }
        }
      );
    });

  /* =========================================================
     EXPENSE MODAL
  ========================================================= */

  function closeExpenseModal() {
    expenseModal.classList.remove(
      'open'
    );

    hideAlert(
      expenseAlert
    );
  }

  /* =========================================================
     LEAVE GROUP
  ========================================================= */

  window.deleteGroup = async function () {
    if (
      !confirm(
        'Are you sure you want to permanently delete this group? All expenses and payment records will be permanently deleted. This action cannot be undone.'
      )
    ) {
      return;
    }

    try {
      const res = await api(`/groups/${groupId}`, {
        method: 'DELETE',
      });

      if (res.message) {
        if (window.FX) {
          window.FX.toast('Group permanently deleted');
        }

        setTimeout(() => {
          window.location.href = '/dashboard.html';
        }, 1000);
      }
    } catch (err) {
      alert(err.message || 'Failed to delete group');
    }
  };

  window.leaveGroup = async function () {
    if (
      !confirm(
        'Are you sure you want to leave this group? You will not participate in future expenses, but your existing historical balances will remain active.'
      )
    ) {
      return;
    }

    try {
      const res =
        await api(
          `/groups/${groupId}/members/me`,
          {
            method: 'DELETE',
          }
        );

      if (res.message) {
        if (window.FX) {
          window.FX.toast(
            'Successfully left group'
          );
        }

        setTimeout(() => {
          window.location.href =
            '/dashboard.html';
        }, 1000);
      }
    } catch (err) {
      alert(
        err.message ||
        'Failed to leave group'
      );
    }
  };

  document
    .getElementById('openExpense')
    .addEventListener(
      'click',
      () => {
        hideAlert(
          expenseAlert
        );

        expenseForm.reset();

        expenseForm.date.value =
          new Date()
            .toISOString()
            .slice(0, 10);

        renderSplitInputs(
          'equal'
        );

        expenseModal.classList.add(
          'open'
        );
      }
    );

  /* X BUTTON */

  const closeExpense =
    document.getElementById(
      'closeExpense'
    );

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
      if (
        e.target === expenseModal
      ) {
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
        expenseModal.classList.contains(
          'open'
        )
      ) {
        closeExpenseModal();
      }
    }
  );

  /* =========================================================
     SPLIT TYPE
  ========================================================= */

  document
    .getElementById(
      'expSplitType'
    )
    .addEventListener(
      'change',
      (e) => {
        renderSplitInputs(
          e.target.value
        );
      }
    );

  document
    .getElementById(
      'expAmount'
    )
    .addEventListener(
      'input',
      () => {
        const splitType =
          document.getElementById(
            'expSplitType'
          ).value;

        if (
          splitType === 'equal'
        ) {
          renderSplitInputs(
            'equal'
          );
        }
      }
    );

  /* =========================================================
     HELPERS
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
      );
  }

  function getUserId(user) {
    if (!user) {
      return null;
    }

    return (
      user.id ??
      user._id ??
      null
    );
  }

  function getCreatedById(createdBy) {
    if (!createdBy) {
      return null;
    }

    if (
      typeof createdBy ===
      'object'
    ) {
      return (
        createdBy.id ??
        createdBy._id ??
        null
      );
    }

    return createdBy;
  }

  function isActiveMember(userId) {
    return members.some(
      (member) =>
        String(
          getUserId(member)
        ) ===
        String(userId)
    );
  }

  function isCurrentUserActive() {
    return isActiveMember(
      getUserId(me)
    );
  }

  function isGroupCreator() {
    const currentUserId =
      getUserId(me);

    const creatorId =
      getCreatedById(
        group?.createdBy
      );

    return (
      currentUserId !== null &&
      creatorId !== null &&
      String(currentUserId) ===
        String(creatorId)
    );
  }

  function renderDepartedName(
    name,
    userId
  ) {
    const safeName =
      escapeHtml(name);

    const departed =
      !isActiveMember(
        userId
      );

    if (!departed) {
      return safeName;
    }

    return `
      ${safeName}
      <span
        class="badge"
        style="
          background:#555;
          color:#fff;
          font-size:0.7rem;
          padding:0.1rem 0.3rem;
          border-radius:4px;
          margin-left:5px;
        "
      >
        Departed
      </span>
    `;
  }

  /* =========================================================
     SPLIT INPUTS
  ========================================================= */

  function renderSplitInputs(
    type
  ) {
    const amount =
      Number(
        document.getElementById(
          'expAmount'
        ).value
      ) || 0;

    const equalShare =
      members.length
        ? Math.round(
            (
              amount /
              members.length
            ) * 100
          ) / 100
        : 0;

    splitList.innerHTML =
      members
        .map((member) => {
          const userId =
            getUserId(member);

          if (
            type === 'custom'
          ) {
            return `
              <div class="split-row">
                <label>
                  <input
                    type="checkbox"
                    class="split-check"
                    data-user="${userId}"
                    checked
                  />

                  ${escapeHtml(
                    member.name
                  )}
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

                ${escapeHtml(
                  member.name
                )}
              </label>

              <span
                style="
                  color: var(--ll-text-muted);
                  font-size: 0.9rem;
                "
              >
                ${formatMoney(
                  equalShare
                )} each
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
      document.getElementById(
        'expPaidBy'
      );

    select.innerHTML =
      members
        .map((member) => {
          const userId =
            getUserId(member);

          return `
            <option
              value="${userId}"
              ${
                String(userId) ===
                String(
                  getUserId(me)
                )
                  ? 'selected'
                  : ''
              }
            >
              ${escapeHtml(
                member.name
              )}
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
      activeIntentsRes
    ] = await Promise.all([
      api(
        `/groups/${groupId}`
      ),

      api(
        `/expenses/${groupId}`
      ),

      api(
        `/balances/${groupId}`
      ),

      api(
        `/payment/active/${groupId}`
      ).catch((err) => ({ error: true, message: err.message || "Failed to load active intents" }))
    ]);

    group =
      groupRes.group;

    members =
      group.members || [];

    document.title =
      `${group.name} — LendLocal`;

    document.getElementById(
      'groupName'
    ).textContent =
      group.name;

    document.getElementById(
      'groupDesc'
    ).textContent =
      group.description ||
      `${members.length} members`;

    const statTotal =
      document.getElementById(
        'statTotal'
      );

    const statCount =
      document.getElementById(
        'statCount'
      );

    const mineEl =
      document.getElementById(
        'statMine'
      );

    const mine =
      (
        balanceRes.balances ||
        []
      ).find(
        (balance) =>
          String(
            balance.userId
          ) ===
          String(
            getUserId(me)
          )
      );

    const myNet =
      mine
        ? mine.net
        : 0;

    /* Statistics */

    if (window.FX) {
      window.FX.animateNumber(
        statTotal,
        balanceRes.totalSpent ||
          0,
        {
          prefix: '₹',
          decimals: 2,
        }
      );

      window.FX.animateNumber(
        statCount,
        balanceRes.expenseCount ||
          0,
        {
          decimals: 0,
        }
      );
    } else {
      statTotal.textContent =
        formatMoney(
          balanceRes.totalSpent ||
            0
        );

      statCount.textContent =
        String(
          balanceRes.expenseCount ||
            0
        );
    }

    /* Your balance */

    mineEl.textContent =
      Math.abs(myNet) < 0.01
        ? 'Settled'
        : myNet > 0
          ? `+${formatMoney(
              myNet
            )}`
          : `−${formatMoney(
              Math.abs(myNet)
            )}`;

    mineEl.className =
      `value ${
        myNet > 0.01
          ? 'positive'
          : myNet < -0.01
            ? 'negative'
            : ''
      }`;

    renderExpenses(
      expenseRes.expenses || []
    );

    renderBalances(
      balanceRes,
      activeIntentsRes
    );

    renderMembers();

    renderPaidBy();
  }

  /* =========================================================
     EXPENSES
  ========================================================= */

  function renderExpenses(
    expenses
  ) {
    const list =
      document.getElementById(
        'expenseList'
      );

    if (!expenses.length) {
      list.innerHTML = `
        <div class="empty">
          <strong>
            No expenses yet
          </strong>

          Add the first shared cost
          for this group.
        </div>
      `;

      return;
    }

    list.innerHTML =
      expenses
        .map(
          (expense) => `
            <article
              class="expense-item"
            >
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

                  ${formatDate(
                    expense.date
                  )}
                </div>
              </div>

              <div class="amount">
                ${formatMoney(
                  expense.amount
                )}
              </div>

              ${(() => {
                const myId = String(
                  getUserId(me)
                );
                const exId = expense.createdBy
                  ? String(
                      getCreatedById(
                        expense.createdBy
                      )
                    )
                  : null;
                const grpId =
                  group &&
                  group.createdBy
                    ? String(
                        getCreatedById(
                          group.createdBy
                        )
                      )
                    : null;

                if (
                  myId === exId ||
                  myId === grpId
                ) {
                  return `
              <div class="actions">
                <button
                  class="btn btn-danger"
                  type="button"
                  data-delete="${expense.id}"
                >
                  Delete
                </button>
              </div>
              </div>`;
                }

                return '';
              })()}
            </article>
          `
        )
        .join('');

    if (window.FX) {
      window.FX.staggerReveal(
        list,
        '.expense-item'
      );
    }

    list
      .querySelectorAll(
        '[data-delete]'
      )
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
                  method:
                    'DELETE',
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
              alert(
                err.message
              );

              if (window.FX) {
                window.FX.shake(
                  list
                );
              }
            }
          }
        );
      });
  }

  /* =========================================================
     BALANCES
  ========================================================= */

  function renderBalances(
    data,
    activeIntentsRes = { intents: [] }
  ) {
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
          <strong>
            All settled
          </strong>

          No outstanding debts
          in this group.
        </div>
      `;
    } else {
      sList.innerHTML =
        settlements
          .map(
            (settlement) => {
              const fromId =
                settlement.from.id ||
                settlement.from.userId ||
                settlement.from._id;

              const toId =
                settlement.to.id ||
                settlement.to.userId ||
                settlement.to._id;

              const myId =
                getUserId(me);

              const isMyDebt =
                String(fromId) ===
                String(myId);

              const isMyCredit =
                String(toId) ===
                String(myId);

              let paymentAction =
                '';

              /*
               * ONLY THE DEBTOR
               * GETS THE PAY BUTTON.
               */

              if (isMyDebt) {
                if (activeIntentsRes.error) {
                  paymentAction = `
                    <span style="color: var(--ll-negative); font-size: 0.9rem;">
                      Intent sync failed
                    </span>
                  `;
                } else {
                  const activeIntents = activeIntentsRes.intents || [];
                  const activeIntent = activeIntents.find(i =>
                    String(i.from._id || i.from.id || i.from) === String(myId) &&
                    String(i.to._id || i.to.id || i.to) === String(toId) &&
                    (i.status === 'pending' || i.status === 'payer_claimed')
                  );

                  if (activeIntent) {
                    paymentAction = `
                      <button
                        class="btn btn-ghost"
                        type="button"
                        data-resume-intent-id="${activeIntent.intentId}"
                        style="font-size: 0.9rem;"
                      >
                        Payment in progress
                      </button>
                    `;
                  } else {
                    paymentAction = `
                      <button
                        class="pay-btn"
                        type="button"
                        data-pay="${settlement.amount}"
                        data-to="${toId}"
                      >
                        Pay
                        ${formatMoney(
                          settlement.amount
                        )}
                      </button>
                    `;
                  }
                }
              } else if (
                isMyCredit
              ) {
                if (activeIntentsRes.error) {
                  paymentAction = `
                    <span style="color: var(--ll-negative); font-size: 0.9rem;">
                      Intent sync failed
                    </span>
                  `;
                } else {
                  const activeIntents = activeIntentsRes.intents || [];
                  const claimIntent = activeIntents.find(i =>
                    String(i.from._id || i.from.id || i.from) === String(fromId) &&
                    String(i.to._id || i.to.id || i.to) === String(myId) &&
                    i.status === 'payer_claimed'
                  );

                  if (claimIntent) {
                    paymentAction = `
                      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 5px;">
                        <span style="color: var(--ll-warning); font-size: 0.85rem; text-align: right;">
                          Payment claim awaiting confirmation
                        </span>
                        <button
                          class="btn btn-ghost"
                          type="button"
                          data-review-intent-id="${claimIntent.intentId}"
                          style="font-size: 0.9rem; padding: 4px 10px;"
                        >
                          Review payment
                        </button>
                      </div>
                    `;
                  } else {
                    paymentAction = `
                      <span
                        class="payment-status"
                        style="
                          color: var(--ll-text-muted);
                          font-size: 0.9rem;
                        "
                      >
                        Awaiting payment
                      </span>
                    `;
                  }
                }
              }

              return `
                <div
                  class="settlement-item"
                >
                  <div class="flow">
                    ${renderDepartedName(
                      settlement.from.name,
                      fromId
                    )}

                    <span>
                      owes
                    </span>

                    ${renderDepartedName(
                      settlement.to.name,
                      toId
                    )}
                  </div>

                  <strong>
                    ${formatMoney(
                      settlement.amount
                    )}
                  </strong>

                  ${paymentAction}
                </div>
              `;
            }
          )
          .join('');

      if (window.FX) {
        window.FX.staggerReveal(
          sList,
          '.settlement-item'
        );
      }

      sList
        .querySelectorAll(
          '[data-pay]'
        )
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

              openPaymentMethodModal(amount, toUserId);
            }
          );
        });

      sList
        .querySelectorAll('[data-review-intent-id]')
        .forEach((button) => {
          button.addEventListener('click', () => {
            const intentId = button.dataset.reviewIntentId;
            const originalText = button.textContent;
            button.textContent = 'Loading...';
            button.disabled = true;
            handleRecipientClaim(intentId).finally(() => {
              button.textContent = originalText;
              button.disabled = false;
            });
          });
        });

      sList
        .querySelectorAll('[data-resume-intent-id]')
        .forEach((button) => {
          button.addEventListener('click', async () => {
            const originalText = button.textContent;
            button.textContent = 'Loading...';
            button.disabled = true;

            try {
              const res = await api(`/payment/active/${groupId}`);
              const intentId = button.dataset.resumeIntentId;

              const activeIntent = (res.intents || []).find(i => i.intentId === intentId);

              if (activeIntent && (activeIntent.status === 'pending' || activeIntent.status === 'payer_claimed')) {
                currentPayerIntentId = intentId;
                openUpiPayerModal(activeIntent);
              } else {
                alert('Payment intent no longer active or state changed. Refreshing...');
                window.location.reload();
              }
            } catch (err) {
              alert(err.message || 'Failed to fetch intent state.');
            } finally {
              button.textContent = originalText;
              button.disabled = false;
            }
          });
        });
    }

    /* =======================================================
       NET BALANCES
    ======================================================= */

    const balanceList =
      document.getElementById(
        'balanceList'
      );

    balanceList.innerHTML =
      balances
        .map(
          (balance) => {
            const displayName =
              renderDepartedName(
                balance.name,
                balance.userId
              );

            const label =
              Math.abs(
                balance.net
              ) < 0.01
                ? 'Settled'
                : balance.net > 0
                  ? `owed ${formatMoney(
                      balance.net
                    )}`
                  : `owes ${formatMoney(
                      Math.abs(
                        balance.net
                      )
                    )}`;

            return `
              <div
                class="balance-item"
              >
                <div>
                  ${displayName}

                  ${
                    String(
                      balance.userId
                    ) ===
                    String(
                      getUserId(me)
                    )
                      ? ' (you)'
                      : ''
                  }
                </div>

                <span
                  class="balance-pill
                  ${balanceClass(
                    balance.net
                  )}"
                >
                  ${label}
                </span>
              </div>
            `;
          }
        )
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

    memberList.innerHTML =
      members
        .map(
          (member) => {
            const userId =
              getUserId(member);

            const currentUserId =
              getUserId(me);

            const creatorId =
              getCreatedById(
                group?.createdBy
              );

            const isMe = String(userId) === String(currentUserId);
            const isOwner = isMe && String(userId) === String(creatorId);
            const canLeave = isMe && !isOwner;

            return `
              <div class="member-item">
                <div>
                  <strong>
                    ${escapeHtml(member.name)}
                    ${isMe ? ' (you)' : ''}
                  </strong>
                  <div class="email">
                    ${escapeHtml(member.email)}
                    ${canLeave ? `
                      <button class="btn btn-danger" style="margin-left:1rem; padding:0.2rem 0.5rem; font-size:0.8rem;" type="button" onclick="leaveGroup()">
                        Leave Group
                      </button>
                    ` : ''}
                    ${isOwner ? `
                      <button class="btn btn-danger" style="margin-left:1rem; padding:0.2rem 0.5rem; font-size:0.8rem;" type="button" onclick="deleteGroup()">
                        Delete Group
                      </button>
                    ` : ''}
                  </div>
                </div>
              </div>
            `;
          }
        )
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
      const order =
        await api(
          '/payment/create-order',
          {
            method: 'POST',

            body:
              JSON.stringify({
                amount,
                groupId,
                toUserId,
              }),
          }
        );

      const options = {
        key:
          'rzp_test_TPv7QuxyBVkM0D',

        amount:
          order.amount,

        currency:
          order.currency,

        name:
          'LendLocal',

        description:
          'Settlement Payment',

        order_id:
          order.id,

        handler:
          async function (
            response
          ) {
            try {
              const verification =
                await api(
                  '/payment/verify-payment',
                  {
                    method:
                      'POST',

                    body:
                      JSON.stringify({
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

              if (
                verification.success
              ) {
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
          name:
            me.name || '',

          email:
            me.email || '',
        },

        theme: {
          color:
            '#0f5c4e',
        },
      };

      const razorpay =
        new Razorpay(
          options
        );

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
    .getElementById(
      'addMemberForm'
    )
    .addEventListener(
      'submit',
      async (e) => {
        e.preventDefault();

        const alertEl =
          document.getElementById(
            'memberAlert'
          );

        hideAlert(
          alertEl
        );

        const email =
          document
            .getElementById(
              'memberEmail'
            )
            .value
            .trim();

        try {
          const data =
            await api(
              `/groups/${groupId}/members`,
              {
                method:
                  'POST',

                body:
                  JSON.stringify({
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
            window.FX.shake(
              alertEl
            );
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

      hideAlert(
        expenseAlert
      );

      const splitType =
        expenseForm.splitType.value;

      const checked =
        [
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

      if (
        splitType === 'equal'
      ) {
        splits =
          checked.map(
            (checkbox) => ({
              user:
                checkbox.dataset.user,
            })
          );
      } else {
        splits =
          checked.map(
            (checkbox) => {
              const input =
                document.querySelector(
                  `.split-share[data-user="${checkbox.dataset.user}"]`
                );

              return {
                user:
                  checkbox.dataset.user,

                share:
                  Number(
                    input.value
                  ),
              };
            }
          );
      }

      try {
        await api(
          '/expenses',
          {
            method: 'POST',

            body:
              JSON.stringify({
                groupId,

                description:
                  expenseForm
                    .description
                    .value
                    .trim(),

                amount:
                  Number(
                    expenseForm
                      .amount
                      .value
                  ),

                paidBy:
                  expenseForm
                    .paidBy
                    .value,

                splitType,

                splits,

                category:
                  expenseForm
                    .category
                    .value,

                date:
                  expenseForm
                    .date
                    .value ||
                  undefined,
              }),
          }
        );

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

  window.reloadCurrentData = initLoadAll;
  function initLoadAll() {
    const btn = document.getElementById('retryGroupBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Loading...';
    }
    return loadAll().catch((err) => {
      const el = document.getElementById('expenseList');
      if (el) {
        el.innerHTML = `
          <div class="empty">
            <strong>Could not load group</strong>
            <p>${escapeHtml(err.message)}</p>
            <button id="retryGroupBtn" class="btn btn-primary" style="margin-top: 15px;" type="button">Retry</button>
          </div>
        `;
        document.getElementById('retryGroupBtn')?.addEventListener('click', () => {
          initLoadAll().catch(err => {
            console.error('Retry failed:', err);
          });
        });
      }
      throw err;
    });
  }
  initLoadAll().catch(err => {
    console.error('Initial load failed:', err);
  });

  /* =========================================================
     DIRECT UPI FRONTEND LOGIC
  ========================================================= */
  let currentPayerIntentId = null;
  let currentRecipientIntentId = null;

  function openPaymentMethodModal(amount, toUserId) {
    const modal = document.getElementById('paymentMethodModal');
    modal.classList.add('open');

    document.getElementById('closePaymentMethodBtn').onclick = () => modal.classList.remove('open');

    document.getElementById('btnPayRazorpay').onclick = () => {
      modal.classList.remove('open');
      startPayment(amount, toUserId);
    };

    document.getElementById('btnPayUpi').onclick = () => {
      modal.classList.remove('open');
      startUpiPayment(amount, toUserId);
    };
  }

  async function startUpiPayment(amount, toUserId) {
    try {
      const res = await api('/payment/intent', {
        method: 'POST',
        body: JSON.stringify({ groupId, toUserId, amount })
      });

      currentPayerIntentId = res.intentId;
      openUpiPayerModal(res);
    } catch (err) {
      alert(err.message || "Failed to initiate UPI payment");
    }
  }

  function openUpiPayerModal(intentData) {
    const modal = document.getElementById('upiPayerModal');
    const alertBox = document.getElementById('upiPayerAlert');
    const linkContainer = document.getElementById('upiLinkContainer');
    const btnCancel = document.getElementById('btnUpiCancel');
    const btnClaim = document.getElementById('btnUpiClaim');
    const statusText = document.getElementById('upiPayerStatusText');

    hideAlert(alertBox);
    modal.classList.add('open');
    document.getElementById('closeUpiPayerBtn').onclick = () => modal.classList.remove('open');

    if (intentData.status === 'pending') {
      statusText.textContent = "Complete your payment using any UPI app.";
      linkContainer.style.display = 'block';
      btnCancel.style.display = 'block';
      btnClaim.style.display = 'block';

      const upiLink = document.getElementById('upiDeepLink');
      const desktopMsg = document.getElementById('upiDesktopMessage');

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      if (isMobile) {
        upiLink.style.display = 'block';
        desktopMsg.style.display = 'none';
        if (intentData.upiUri) upiLink.href = intentData.upiUri;
      } else {
        upiLink.style.display = 'none';
        desktopMsg.style.display = 'block';
      }

    } else if (intentData.status === 'payer_claimed') {
      statusText.textContent = "Payment claimed. Awaiting confirmation from the recipient.";
      linkContainer.style.display = 'none';
      btnCancel.style.display = 'none';
      btnClaim.style.display = 'none';
    }

    btnClaim.onclick = async () => {
      try {
        const res = await api('/payment/claim', {
          method: 'POST',
          body: JSON.stringify({ intentId: currentPayerIntentId })
        });
        openUpiPayerModal(res);
      } catch (err) {
        showAlert(alertBox, err.message);
      }
    };

    btnCancel.onclick = async () => {
      try {
        await api('/payment/cancel', {
          method: 'POST',
          body: JSON.stringify({ intentId: currentPayerIntentId })
        });
        modal.classList.remove('open');
        window.location.reload();
      } catch (err) {
        showAlert(alertBox, err.message);
      }
    };
  }

  async function handleRecipientClaim(intentId) {
    try {
      const res = await api(`/payment/active/${groupId}`);
      const intent = res.intents.find(i => i.intentId === intentId);

      if (!intent) {
        alert("Payment intent not found or already processed.");
        window.location.href = `/group.html?id=${groupId}`;
        return;
      }

      const myId = getUserId(me);
      if (String(intent.to._id || intent.to.id || intent.to) !== String(myId)) {
        alert("Payment claim is not available for your account.");
        return; // UI stays on the page
      }

      if (intent.status !== 'payer_claimed') {
        alert("This payment is not in a claimed state.");
        window.location.reload();
        return;
      }

      currentRecipientIntentId = intent.intentId;
      const modal = document.getElementById('upiRecipientModal');
      const alertBox = document.getElementById('upiRecipientAlert');
      const statusText = document.getElementById('upiRecipientStatusText');

      hideAlert(alertBox);
      statusText.textContent = `${intent.payerName} claims they paid you ₹${intent.amount}. Please confirm if you received it.`;
      modal.classList.add('open');

      document.getElementById('closeUpiRecipientBtn').onclick = () => modal.classList.remove('open');

      document.getElementById('btnUpiConfirm').onclick = async () => {
        try {
          await api('/payment/confirm', {
            method: 'POST',
            body: JSON.stringify({ intentId: currentRecipientIntentId })
          });
          window.location.href = `/group.html?id=${groupId}`;
        } catch (err) {
          showAlert(alertBox, err.message);
        }
      };

      document.getElementById('btnUpiReject').onclick = async () => {
        if (!confirm("Are you sure you want to reject this payment claim?")) return;
        try {
          await api('/payment/reject', {
            method: 'POST',
            body: JSON.stringify({ intentId: currentRecipientIntentId })
          });
          window.location.href = `/group.html?id=${groupId}`;
        } catch (err) {
          showAlert(alertBox, err.message);
        }
      };
    } catch (err) {
      console.error(err);
      alert("Failed to load active intent details.");
    }
  }

  // Init recipient flow if URL param exists
  const claimIntentId = params.get('claimIntentId');
  if (claimIntentId) {
    handleRecipientClaim(claimIntentId);
  }

  // Listen for FCM foreground claims
  window.addEventListener('paymentClaim', (e) => {
    if (e.detail && e.detail.paymentId && e.detail.groupId) {
      if (e.detail.groupId === groupId) {
        handleRecipientClaim(e.detail.paymentId);
      } else {
        window.location.href = `/group.html?id=${e.detail.groupId}&claimIntentId=${e.detail.paymentId}`;
      }
    }
  });

  window.addEventListener('paymentConfirmed', (e) => {
    if (e.detail && e.detail.groupId === groupId) {
      alert(`Payment confirmed by ${e.detail.recipientName || 'recipient'}! Ledger updated.`);
      window.location.reload();
    }
  });

  window.addEventListener('paymentRejected', (e) => {
    if (e.detail && e.detail.groupId === groupId) {
      alert(`Payment claim was rejected by ${e.detail.recipientName || 'recipient'}.`);
      window.location.reload();
    }
  });

}