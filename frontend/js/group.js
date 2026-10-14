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
  let currentExpenses = [];

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
    expenseModal.classList.remove('open');
    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.classList.remove('modal-open');
    }
    clearTimeout(expenseFocusTimeout);
    restoreFocusSafe(expenseModalLastFocus);
    hideAlert(expenseAlert);
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

  let expenseModalLastFocus = null;
  let expenseFocusTimeout;

  document
    .getElementById('openExpense')
    .addEventListener(
      'click',
      () => {
        expenseModalLastFocus = document.activeElement;
        hideAlert(
          expenseAlert
        );

        document.getElementById('expenseModalTitle').textContent = 'Add expense';
        const editId = document.getElementById('editExpenseId');
        if (editId) editId.value = '';

        expenseForm.reset();

        expenseForm.date.value =
          new Date()
            .toISOString()
            .slice(0, 10);

        renderSplitInputs(
          'equal'
        );

        expenseModal.classList.add('open');
        document.body.classList.add('modal-open');
        clearTimeout(expenseFocusTimeout);
        expenseFocusTimeout = setTimeout(() => {
          if (expenseModal.classList.contains('open')) expenseForm.querySelector('input')?.focus();
        }, 50);
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const upiPayer = document.getElementById('upiPayerModal');
      const upiRecip = document.getElementById('upiRecipientModal');
      const payMethod = document.getElementById('paymentMethodModal');
      if (upiPayer?.classList.contains('open')) {
        if (!window.isPaymentRequestInFlight) {
          closeUpiPayerModal();
        }
      } else if (upiRecip?.classList.contains('open')) {
        document.getElementById('closeUpiRecipientBtn')?.click();
      } else if (payMethod?.classList.contains('open')) {
        closePaymentMethodModal();
      } else if (expenseModal?.classList.contains('open')) {
        closeExpenseModal();
      }
    }
  });

  /* =========================================================
     SPLIT TYPE & AMOUNT EVENTS
  ========================================================= */

  document
    .getElementById('expSplitType')
    .addEventListener('change', (e) => {
      renderSplitInputs(e.target.value, true);
    });

  document
    .getElementById('expAmount')
    .addEventListener('input', () => {
      updateSplitSummary();
    });

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
     SPLIT INPUTS & SUMMARY
  ========================================================= */

  function updateSplitSummary() {
    const splitType = document.getElementById('expSplitType')?.value || 'equal';
    const amountVal = Number(document.getElementById('expAmount')?.value) || 0;
    const totalPaise = Math.round(amountVal * 100);
    const summaryEl = document.getElementById('splitSummary');
    const allocEl = document.getElementById('splitAllocated') || document.getElementById('splitAllocatedAmount');
    const remEl = document.getElementById('splitRemaining') || document.getElementById('splitRemainingAmount');
    const statusEl = document.getElementById('splitStatusMsg') || document.getElementById('splitStatusText');

    if (!summaryEl) return;
    summaryEl.style.display = 'block';

    const checkedBoxes = Array.from(document.querySelectorAll('.split-check:checked'));
    const count = checkedBoxes.length;

    if (splitType === 'equal') {
      const basePaise = count > 0 ? Math.floor(totalPaise / count) : 0;
      const remPaise = count > 0 ? totalPaise % count : 0;

      // Update individual member labels
      document.querySelectorAll('.split-row').forEach((row) => {
        const cb = row.querySelector('.split-check');
        const shareLabel = row.querySelector('.equal-share-label');
        if (!cb || !shareLabel) return;
        if (!cb.checked) {
          shareLabel.textContent = 'Excluded';
          shareLabel.style.opacity = '0.5';
        } else {
          const idx = checkedBoxes.indexOf(cb);
          const sharePaise = basePaise + (idx < remPaise ? 1 : 0);
          shareLabel.textContent = `${formatMoney(sharePaise / 100)} each`;
          shareLabel.style.opacity = '1';
        }
      });

      const allocatedPaise = count > 0 ? totalPaise : 0;
      const remainingPaise = totalPaise - allocatedPaise;

      if (allocEl) allocEl.textContent = formatMoney(allocatedPaise / 100);
      if (remEl) remEl.textContent = formatMoney(remainingPaise / 100);

      if (statusEl) {
        if (count === 0) {
          statusEl.className = 'split-status-msg split-status-text error invalid';
          statusEl.textContent = 'Select at least one participant';
        } else if (totalPaise <= 0) {
          statusEl.className = 'split-status-msg split-status-text warning invalid';
          statusEl.textContent = 'Enter an expense amount';
        } else {
          statusEl.className = 'split-status-msg split-status-text valid';
          const remMsg = remPaise > 0 ? ` (${remPaise} member${remPaise > 1 ? 's' : ''} +₹0.01)` : '';
          statusEl.textContent = `Split equally among ${count} member${count > 1 ? 's' : ''}${remMsg}`;
        }
      }
    } else {
      // Custom split
      let allocatedPaise = 0;
      checkedBoxes.forEach((cb) => {
        const input = document.querySelector(`.split-share[data-user="${cb.dataset.user}"]`);
        const val = parseFloat(input?.value) || 0;
        allocatedPaise += Math.round(val * 100);
      });

      const remainingPaise = totalPaise - allocatedPaise;

      if (allocEl) allocEl.textContent = formatMoney(allocatedPaise / 100);
      if (remEl) remEl.textContent = formatMoney(remainingPaise / 100);

      if (statusEl) {
        if (count === 0) {
          statusEl.className = 'split-status-msg split-status-text error invalid';
          statusEl.textContent = 'Select at least one participant';
        } else if (totalPaise <= 0) {
          statusEl.className = 'split-status-msg split-status-text warning invalid';
          statusEl.textContent = 'Enter a valid expense amount';
        } else if (remainingPaise === 0) {
          statusEl.className = 'split-status-msg split-status-text valid';
          statusEl.textContent = '✓ Allocations match total amount exactly';
        } else if (remainingPaise > 0) {
          statusEl.className = 'split-status-msg split-status-text warning invalid';
          statusEl.textContent = `₹${(remainingPaise / 100).toFixed(2)} remaining to allocate`;
        } else {
          statusEl.className = 'split-status-msg split-status-text error invalid';
          statusEl.textContent = `Overallocated by ₹${(Math.abs(remainingPaise) / 100).toFixed(2)}`;
        }
      }
    }
  }

  function renderSplitInputs(
    type,
    preserveState = false,
    initialSplits = null
  ) {
    const amountVal = Number(document.getElementById('expAmount').value) || 0;
    const totalPaise = Math.round(amountVal * 100);

    const savedValues = {};
    const savedChecked = {};
    if (preserveState) {
      document.querySelectorAll('.split-check').forEach((cb) => {
        savedChecked[cb.dataset.user] = cb.checked;
        const input = document.querySelector(`.split-share[data-user="${cb.dataset.user}"]`);
        if (input) savedValues[cb.dataset.user] = input.value;
      });
    }

    const memberCount = members.length;

    splitList.innerHTML = members
      .map((member, i) => {
        const userId = String(getUserId(member));
        let isChecked = true;
        let shareValue = '';

        if (initialSplits && initialSplits.length) {
          const found = initialSplits.find(
            (s) => String(s.user?.id || s.user?._id || s.user) === userId
          );
          isChecked = !!found;
          if (found && type === 'custom') {
            shareValue = Number(found.share).toFixed(2);
          }
        } else if (preserveState) {
          if (savedChecked[userId] !== undefined) isChecked = savedChecked[userId];
          if (savedValues[userId] !== undefined) shareValue = savedValues[userId];
        }

        if (type === 'custom') {
          if (!shareValue && shareValue !== '0' && isChecked) {
            const basePaise = memberCount > 0 ? Math.floor(totalPaise / memberCount) : 0;
            const remPaise = memberCount > 0 ? totalPaise % memberCount : 0;
            const userPaise = basePaise + (i < remPaise ? 1 : 0);
            shareValue = (userPaise / 100).toFixed(2);
          } else if (!shareValue) {
            shareValue = '0.00';
          }

          return `
            <div class="split-row">
              <label>
                <input
                  type="checkbox"
                  class="split-check"
                  data-user="${userId}"
                  ${isChecked ? 'checked' : ''}
                />
                ${escapeHtml(member.name)}
              </label>
              <input
                type="number"
                class="split-share"
                data-user="${userId}"
                min="0"
                step="0.01"
                value="${shareValue}"
                ${isChecked ? '' : 'disabled'}
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
                ${isChecked ? 'checked' : ''}
              />
              ${escapeHtml(member.name)}
            </label>
            <span class="equal-share-label" style="color: var(--ll-text-muted); font-size: 0.9rem;">
              ₹0.00 each
            </span>
          </div>
        `;
      })
      .join('');

    splitList.querySelectorAll('.split-check').forEach((cb) => {
      cb.addEventListener('change', () => {
        const userId = cb.dataset.user;
        const shareInput = splitList.querySelector(`.split-share[data-user="${userId}"]`);
        if (shareInput) {
          shareInput.disabled = !cb.checked;
          if (!cb.checked) {
            shareInput.dataset.previousValue = shareInput.value;
            shareInput.value = '0.00';
          } else if (shareInput.dataset.previousValue) {
            shareInput.value = shareInput.dataset.previousValue;
          }
        }
        updateSplitSummary();
      });
    });

    if (type === 'custom') {
      splitList.querySelectorAll('.split-share').forEach((input) => {
        input.addEventListener('input', () => {
          updateSplitSummary();
        });
      });
    }

    updateSplitSummary();
  }

  /* =========================================================
     PAID BY
  ========================================================= */

  function renderPaidBy() {
    const select = document.getElementById('expPaidBy');
    if (!select) return;

    select.innerHTML = members
      .map((member) => {
        const userId = getUserId(member);
        return `
          <option
            value="${userId}"
            ${String(userId) === String(getUserId(me)) ? 'selected' : ''}
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

  const loaderQueue = createLoaderQueue(async () => {
    const res = await _loadAll();
    lastLoadTime = Date.now();
    return res;
  });

  function loadAll(force = false) {
    return loaderQueue.load(force);
  }


  async function _loadAll() {
    const searchInput = document.getElementById('expenseSearchInput');
    const searchTerm = searchInput ? searchInput.value.trim() : '';
    const expenseQs = searchTerm ? `?search=${encodeURIComponent(searchTerm)}` : '';

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
        `/expenses/${groupId}${expenseQs}`
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

    const editBtn = document.getElementById('editGroupNameBtn');
    if (editBtn) {
      editBtn.style.display = isGroupCreator() ? 'inline-flex' : 'none';
    }

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

    currentExpenses = expenseRes.expenses || [];
    renderExpenses(
      currentExpenses,
      !!searchTerm
    );

    renderBalances(
      balanceRes,
      activeIntentsRes
    );

    renderMembers();

    renderPaidBy();

    // Auto-close UPI modal if the intent was settled in the background
    const upiModal = document.getElementById('upiPayerModal');
    if (upiModal && upiModal.classList.contains('open') && currentPayerIntentId) {
      if (!activeIntentsRes.error) {
        const stillActive = (activeIntentsRes.intents || []).find(i => i.intentId === currentPayerIntentId);
        if (!stillActive) {
          // Fetch explicit status instead of inferring from absence
          try {
            const statusRes = await api(`/payment/status/${currentPayerIntentId}`);
            if (['confirmed', 'recipient_rejected', 'cancelled', 'unknown'].includes(statusRes.status)) {
              closeUpiPayerModal();
              window.isPaymentActive = false;
              if (!window.isPaymentRequestInFlight) {
                alert(`Payment status updated to: ${statusRes.status}`);
              }
            }
          } catch (err) {
            console.warn('Failed to fetch explicit intent status, keeping modal open', err);
          }
        }
      }
    }
  }

  /* =========================================================
     EXPENSES
  ========================================================= */

  function renderExpenses(
    expenses,
    isSearching = false
  ) {
    const list =
      document.getElementById(
        'expenseList'
      );

    if (!list) return;

    if (!expenses.length) {
      if (isSearching) {
        list.innerHTML = `
          <div class="modern-empty">
            <div class="empty-icon">🔍</div>
            <strong>No matching expenses</strong>
            <p>No expenses match your search.</p>
            <button class="btn btn-secondary" type="button" id="emptyClearSearch" style="margin-top: 15px;">Clear search</button>
          </div>
        `;
        const clearBtn = document.getElementById('emptyClearSearch');
        if (clearBtn) {
          clearBtn.addEventListener('click', () => {
            const searchInput = document.getElementById('expenseSearchInput');
            if (searchInput) searchInput.value = '';
            doExpenseSearch('');
          });
        }
      } else {
        list.innerHTML = `
          <div class="modern-empty">
            <div class="empty-icon">💸</div>
            <strong>No expenses yet</strong>
            <p>Add the first shared cost for this group.</p>
            <button class="btn btn-primary" type="button" id="emptyAddExpense" style="margin-top: 15px;">Add an expense</button>
          </div>
        `;

        const emptyBtn = document.getElementById('emptyAddExpense');
        if (emptyBtn) {
          emptyBtn.addEventListener('click', () => {
            expenseModalLastFocus = document.activeElement;
            const expenseModal = document.getElementById('expenseModal');
            if (expenseModal) {
              expenseModal.classList.add('open');
              clearTimeout(expenseFocusTimeout);
              expenseFocusTimeout = setTimeout(() => {
                if (expenseModal.classList.contains('open')) expenseForm?.querySelector('input')?.focus();
              }, 50);
            }
          });
        }
      }

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
                  myId === grpId ||
                  myId === String(expense.paidBy.id || expense.paidBy._id)
                ) {
                  return `
              <div class="actions">
                <button
                  class="btn btn-secondary"
                  type="button"
                  data-edit="${expense.id}"
                >
                  Edit
                </button>
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
        '[data-edit]'
      )
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          const expenseId = btn.dataset.edit;
          const expense = expenses.find(e => e.id === expenseId);
          if (!expense) return;

          expenseModalLastFocus = document.activeElement;
          hideAlert(expenseAlert);

          document.getElementById('expenseModalTitle').textContent = 'Edit expense';
          document.getElementById('editExpenseId').value = expense.id;

          expenseForm.description.value = expense.description;
          expenseForm.amount.value = expense.amount;
          expenseForm.category.value = expense.category || 'General';
          expenseForm.paidBy.value = expense.paidBy.id || expense.paidBy._id;
          if (expense.date) {
            expenseForm.date.value = new Date(expense.date).toISOString().slice(0, 10);
          }
          expenseForm.splitType.value = expense.splitType || 'equal';

          renderSplitInputs(expense.splitType || 'equal', false, expense.splits || []);

          expenseModal.classList.add('open');
          document.body.classList.add('modal-open');
          clearTimeout(expenseFocusTimeout);
          expenseFocusTimeout = setTimeout(() => {
            if (expenseModal.classList.contains('open')) expenseForm.querySelector('input')?.focus();
          }, 50);
        });
      });

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

                    await initLoadAll(true);
                  }
                );
              } else {
                await initLoadAll(true);
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
        <div class="modern-empty">
          <div class="empty-icon" style="color: var(--ll-positive);">🎉</div>
          <strong>All settled</strong>
          <p>No outstanding debts in this group.</p>
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
    window.isPaymentActive = true;
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

        handler: async function (response) {
            try {
              window.isPaymentRequestInFlight = true;

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


              await new Promise(r => setTimeout(r, 500));
              await initLoadAll(true).catch(e => console.warn('Payment refresh failed', e));

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

            } finally {
              window.isPaymentRequestInFlight = false;
              window.isPaymentActive = false;
            }
          },

        prefill: {
          name:
            me.name || '',

          email:
            me.email || '',
        },

        modal: {
          ondismiss: function() {
            if (!window.isPaymentRequestInFlight) {
              window.isPaymentActive = false;
            }
            initLoadAll(true).catch(() => {});
          }
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
      window.isPaymentActive = false;
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

        const alertEl = document.getElementById('memberAlert');
        hideAlert(alertEl);

        const emailInput = document.getElementById('memberEmail');
        const email = emailInput.value.trim();

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.innerHTML = `<span class="fx-spinner"></span> Adding...`;

        try {
          const data = await api(`/groups/${groupId}/members`, {
            method: 'POST',
            body: JSON.stringify({ email }),
          });

          members = data.members || [];
          emailInput.value = '';

          showAlert(alertEl, 'Member added', 'success');

          if (window.FX) {
            window.FX.toast('Member added successfully!');
          }

          await initLoadAll(true);
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
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || 'Add member';
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

      const amountVal = Number(expenseForm.amount.value);
      if (isNaN(amountVal) || amountVal <= 0 || !isFinite(amountVal)) {
        showAlert(expenseAlert, 'Enter a valid positive expense amount');
        if (window.FX) window.FX.shake(expenseAlert);
        return;
      }

      const totalPaise = Math.round(amountVal * 100);
      if (Math.abs(amountVal - totalPaise / 100) > 0.00001) {
        showAlert(expenseAlert, 'Amount cannot have more than 2 decimal places');
        if (window.FX) window.FX.shake(expenseAlert);
        return;
      }

      const description = expenseForm.description.value.trim();
      if (!description) {
        showAlert(expenseAlert, 'Description is required');
        if (window.FX) window.FX.shake(expenseAlert);
        return;
      }

      const paidBy = expenseForm.paidBy.value;
      if (!paidBy) {
        showAlert(expenseAlert, 'Select who paid');
        if (window.FX) window.FX.shake(expenseAlert);
        return;
      }

      const splitType = expenseForm.splitType.value;
      const checked = [...document.querySelectorAll('.split-check:checked')];

      if (!checked.length) {
        showAlert(expenseAlert, 'Select at least one participant');
        if (window.FX) window.FX.shake(expenseAlert);
        return;
      }

      let splits;
      if (splitType === 'equal') {
        splits = checked.map((cb) => ({
          user: cb.dataset.user,
        }));
      } else {
        let allocatedPaise = 0;
        splits = [];
        for (const cb of checked) {
          const input = document.querySelector(`.split-share[data-user="${cb.dataset.user}"]`);
          const shareNum = Number(input?.value);
          if (isNaN(shareNum) || shareNum < 0 || !isFinite(shareNum)) {
            showAlert(expenseAlert, 'Each participant share must be a valid non-negative number');
            if (window.FX) window.FX.shake(expenseAlert);
            return;
          }
          const sharePaise = Math.round(shareNum * 100);
          if (Math.abs(shareNum - sharePaise / 100) > 0.00001) {
            showAlert(expenseAlert, 'Participant shares cannot have more than 2 decimal places');
            if (window.FX) window.FX.shake(expenseAlert);
            return;
          }
          allocatedPaise += sharePaise;
          splits.push({
            user: cb.dataset.user,
            share: shareNum,
          });
        }

        if (allocatedPaise !== totalPaise) {
          const diff = (allocatedPaise - totalPaise) / 100;
          showAlert(
            expenseAlert,
            `Custom allocations (${formatMoney(allocatedPaise / 100)}) must add up exactly to total amount (${formatMoney(amountVal)}). Difference: ${formatMoney(Math.abs(diff))}`
          );
          if (window.FX) window.FX.shake(expenseAlert);
          return;
        }
      }

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.textContent;
        submitBtn.innerHTML = `<span class="fx-spinner"></span> Saving...`;
      }

      const editIdEl = document.getElementById('editExpenseId');
      const editId = editIdEl ? editIdEl.value : '';
      const method = editId ? 'PUT' : 'POST';
      const endpoint = editId ? `/expenses/${editId}` : '/expenses';

      try {
        await api(endpoint, {
          method,
          body: JSON.stringify({
            groupId,
            description,
            amount: amountVal,
            paidBy,
            splitType,
            splits,
            category: expenseForm.category.value,
            date: expenseForm.date.value || undefined,
          }),
        });

        closeExpenseModal();

        if (window.FX) {
          window.FX.toast('Expense saved successfully!');
        }

        await initLoadAll(true);
      } catch (err) {
        showAlert(expenseAlert, err.message);
        if (window.FX) window.FX.shake(expenseAlert);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.originalText || 'Save expense';
        }
      }
    }
  );

  /* =========================================================
     GROUP RENAMING
  ========================================================= */

  const editGroupNameBtn = document.getElementById('editGroupNameBtn');
  const renameGroupForm = document.getElementById('renameGroupForm');
  const renameGroupInput = document.getElementById('renameGroupInput');
  const cancelRenameBtn = document.getElementById('cancelRenameBtn');
  const saveRenameBtn = document.getElementById('saveRenameBtn');
  const renameGroupError = document.getElementById('renameGroupError');

  if (editGroupNameBtn) {
    editGroupNameBtn.addEventListener('click', () => {
      if (!renameGroupForm || !renameGroupInput) return;
      renameGroupInput.value = group?.name || '';
      if (renameGroupError) {
        renameGroupError.style.display = 'none';
        renameGroupError.textContent = '';
      }
      const titleRow = document.querySelector('.group-title-row');
      if (titleRow) titleRow.style.display = 'none';
      renameGroupForm.style.display = 'flex';
      renameGroupInput.focus();
      renameGroupInput.select();
    });
  }

  if (cancelRenameBtn) {
    cancelRenameBtn.addEventListener('click', () => {
      if (renameGroupForm) renameGroupForm.style.display = 'none';
      if (renameGroupError) {
        renameGroupError.style.display = 'none';
        renameGroupError.textContent = '';
      }
      const titleRow = document.querySelector('.group-title-row');
      if (titleRow) titleRow.style.display = 'flex';
      editGroupNameBtn?.focus();
    });
  }

  if (renameGroupForm) {
    renameGroupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newName = renameGroupInput.value.trim();

      if (!newName) {
        if (renameGroupError) {
          renameGroupError.textContent = 'Group name cannot be empty';
          renameGroupError.style.display = 'block';
        }
        return;
      }

      if (newName.length > 100) {
        if (renameGroupError) {
          renameGroupError.textContent = 'Group name must be 100 characters or less';
          renameGroupError.style.display = 'block';
        }
        return;
      }

      if (saveRenameBtn) {
        saveRenameBtn.disabled = true;
        saveRenameBtn.dataset.originalText = saveRenameBtn.textContent;
        saveRenameBtn.innerHTML = '<span class="fx-spinner"></span> Saving...';
      }
      if (renameGroupError) renameGroupError.style.display = 'none';

      try {
        const res = await api(`/groups/${groupId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: newName }),
        });

        const updatedName = res.group?.name || newName;
        if (group) group.name = updatedName;
        const nameHeading = document.getElementById('groupName');
        if (nameHeading) nameHeading.textContent = updatedName;
        document.title = `${updatedName} — LendLocal`;

        renameGroupForm.style.display = 'none';
        const titleRow = document.querySelector('.group-title-row');
        if (titleRow) titleRow.style.display = 'flex';
        editGroupNameBtn?.focus();

        if (window.FX) {
          window.FX.toast('Group renamed successfully');
        }
      } catch (err) {
        if (renameGroupError) {
          renameGroupError.textContent = err.message || 'Failed to rename group';
          renameGroupError.style.display = 'block';
        }
        if (window.FX) {
          window.FX.shake(renameGroupForm);
        }
      } finally {
        if (saveRenameBtn) {
          saveRenameBtn.disabled = false;
          saveRenameBtn.textContent = saveRenameBtn.dataset.originalText || 'Save';
        }
      }
    });
  }

  /* =========================================================
     COMPACT SEARCH
  ========================================================= */

  let expenseSearchSeq = 0;
  let searchDebounceTimer = null;

  async function doExpenseSearch(term) {
    const currentSeq = ++expenseSearchSeq;
    const trimmed = term.trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) {
      clearBtn.style.display = term.length > 0 ? 'block' : 'none';
    }

    const list = document.getElementById('expenseList');
    const query = trimmed ? `?search=${encodeURIComponent(trimmed)}` : '';

    try {
      const res = await api(`/expenses/${groupId}${query}`);
      if (currentSeq !== expenseSearchSeq) {
        return; // Discard stale response
      }
      currentExpenses = res.expenses || [];
      renderExpenses(currentExpenses, !!trimmed);
    } catch (err) {
      if (currentSeq !== expenseSearchSeq) return;
      if (list) {
        list.innerHTML = `
          <div class="modern-empty" style="padding: 2rem;">
            <div class="empty-icon" style="color: var(--ll-negative);">⚠️</div>
            <strong>Failed to load expenses</strong>
            <p>${escapeHtml(err.message || 'Network error')}</p>
            <button class="btn btn-secondary" style="margin-top: 15px;" type="button" id="retrySearchBtn">Retry</button>
          </div>
        `;
        document.getElementById('retrySearchBtn')?.addEventListener('click', () => {
          doExpenseSearch(document.getElementById('expenseSearchInput')?.value || '');
        });
      }
    }
  }

  const searchInput = document.getElementById('expenseSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        doExpenseSearch(e.target.value);
      }, 250);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(searchDebounceTimer);
        doExpenseSearch(searchInput.value);
      }
    });

    searchInput.addEventListener('search', () => {
      clearTimeout(searchDebounceTimer);
      doExpenseSearch(searchInput.value);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearTimeout(searchDebounceTimer);
      doExpenseSearch('');
    });
  }

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  window.reloadCurrentData = initLoadAll;
  function initLoadAll(force = false) { return loadAll(force).catch(handleInitLoadError); }

  function handleInitLoadError(err) {
    const errorHtml = `
      <div class="modern-empty" style="padding: 2rem;">
        <div class="empty-icon" style="color: var(--ll-negative);">⚠️</div>
        <strong>Could not load data</strong>
        <p>${escapeHtml(err?.message || 'Failed to load group')}</p>
        <button class="btn btn-primary retry-group-btn" style="margin-top: 15px;" type="button">Retry</button>
      </div>
    `;

    ['expenseList', 'settlementList', 'balanceList', 'memberList'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.innerHTML = errorHtml;
      }
    });

    document.querySelectorAll('.retry-group-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        ['expenseList', 'settlementList', 'balanceList', 'memberList'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            el.innerHTML = '<div class="loading-state"><span class="fx-spinner"></span> Loading...</div>';
          }
        });
        initLoadAll(true).catch((e) => console.error('Retry failed:', e));
      });
    });
  }



  initLoadAll(true).catch(err => {
      console.error('Initial load failed:', err);
    });

  /* =========================================================
     BACKGROUND RESUME
  ========================================================= */
  let lastLoadTime = Date.now();
  let isRefreshing = false;
  const STALE_MS = 2 * 60 * 1000; // 2 minutes

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const isPaymentReturn = window.isPaymentActive === true;
      if ((isPaymentReturn || Date.now() - lastLoadTime > STALE_MS) && !isRefreshing) {
        isRefreshing = true;
        initLoadAll(true)
          .catch(err => console.warn('Background refresh failed', err))
          .finally(() => { isRefreshing = false; });
      }
    }
  });

  /* =========================================================
     DIRECT UPI FRONTEND LOGIC
  ========================================================= */
  let currentPayerIntentId = null;
  let currentRecipientIntentId = null;

  let paymentModalLastFocus = null;
  let paymentFocusTimeout;
  function closePaymentMethodModal() {
    const modal = document.getElementById('paymentMethodModal');
    if (!modal) return;
    modal.classList.remove('open');
    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.classList.remove('modal-open');
    }
    clearTimeout(paymentFocusTimeout);
    restoreFocusSafe(paymentModalLastFocus);
  }

  let currentPaymentMaxAmount = 0;

  function parseAndValidatePaymentAmount(rawVal, maxAuthorized) {
    if (rawVal === undefined || rawVal === null || (typeof rawVal === 'string' && rawVal.trim() === '')) {
      return { valid: false, message: 'Please enter a payment amount' };
    }
    if (typeof rawVal !== 'number' && typeof rawVal !== 'string') {
      return { valid: false, message: 'Please enter a valid numeric amount' };
    }

    let num;
    if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return { valid: false, message: 'Please enter a valid numeric amount' };
      }
      num = Number(trimmed);
    } else {
      if (!Number.isFinite(rawVal) || isNaN(rawVal)) {
        return { valid: false, message: 'Please enter a valid numeric amount' };
      }
      num = rawVal;
    }

    if (num < 0.01) {
      return { valid: false, message: 'Payment amount must be at least ₹0.01' };
    }

    // Check decimal places strictly (at most 2 decimal places)
    if (typeof rawVal === 'string') {
      const trimmed = rawVal.trim();
      const dotIndex = trimmed.indexOf('.');
      if (dotIndex !== -1 && trimmed.length - dotIndex - 1 > 2) {
        return { valid: false, message: 'Amount cannot have more than 2 decimal places' };
      }
    } else {
      const str = rawVal.toString();
      const dotIndex = str.indexOf('.');
      if (dotIndex !== -1 && str.length - dotIndex - 1 > 2) {
        const requestedPaise = Math.round(rawVal * 100);
        const diff = Math.abs(rawVal - requestedPaise / 100);
        if (diff > 1e-9) {
          return { valid: false, message: 'Amount cannot have more than 2 decimal places' };
        }
      }
    }
    const requestedPaise = Math.round(num * 100);
    const maxPaise = Math.round(Number(maxAuthorized) * 100);
    if (requestedPaise > maxPaise) {
      return { valid: false, message: `Payment cannot exceed total outstanding debt of ${formatMoney(maxAuthorized)}` };
    }
    return { valid: true, amount: requestedPaise / 100, requestedPaise };
  }

  function openPaymentMethodModal(amount, toUserId) {
    currentPaymentMaxAmount = amount;
    paymentModalLastFocus = document.activeElement;
    const modal = document.getElementById('paymentMethodModal');
    const alertBox = document.getElementById('paymentMethodAlert');
    const debtEl = document.getElementById('paymentMethodTotalDebt');
    const amountInput = document.getElementById('paymentCustomAmount');
    const hintEl = document.getElementById('paymentAmountHint');

    if (alertBox) hideAlert(alertBox);
    if (debtEl) debtEl.textContent = formatMoney(amount);
    if (amountInput) {
      amountInput.value = amount.toFixed(2);
      amountInput.max = amount.toFixed(2);
      amountInput.min = '0.01';
      amountInput.step = '0.01';
      amountInput.oninput = () => {
        if (alertBox) hideAlert(alertBox);
      };
    }
    if (hintEl) {
      hintEl.textContent = `Default is full debt (${formatMoney(amount)}). You can enter a smaller amount (min ₹0.01).`;
    }

    modal.classList.add('open');
    document.body.classList.add('modal-open');
    clearTimeout(paymentFocusTimeout);
    paymentFocusTimeout = setTimeout(() => {
      if (modal.classList.contains('open')) {
        amountInput ? amountInput.focus() : modal.querySelector('button')?.focus();
      }
    }, 50);

    document.getElementById('closePaymentMethodBtn').onclick = closePaymentMethodModal;
    modal.onclick = (e) => {
      if (e.target === modal) {
        closePaymentMethodModal();
      }
    };

    document.getElementById('btnPayRazorpay').onclick = async () => {
      const inputVal = amountInput ? amountInput.value : amount;
      const validation = parseAndValidatePaymentAmount(inputVal, currentPaymentMaxAmount);
      if (!validation.valid) {
        if (alertBox) {
          showAlert(alertBox, validation.message);
          if (window.FX) window.FX.shake(alertBox);
        } else {
          alert(validation.message);
        }
        return;
      }

      try {
        const conf = await api('/config');
        if (conf.razorpayEnabled) {
          closePaymentMethodModal();
          startPayment(validation.amount, toUserId);
        } else {
          if (alertBox) {
            showAlert(alertBox, "Razorpay payments will be available soon. Currently under maintenance. Please use UPI.");
            if (window.FX) window.FX.shake(alertBox);
          } else {
            alert("Razorpay payments will be available soon. Currently under maintenance. Please use UPI.");
          }
        }
      } catch (err) {
        if (alertBox) {
          showAlert(alertBox, "Razorpay payments will be available soon. Currently under maintenance. Please use UPI.");
          if (window.FX) window.FX.shake(alertBox);
        } else {
          alert("Razorpay payments will be available soon. Currently under maintenance. Please use UPI.");
        }
      }
    };

    document.getElementById('btnPayUpi').onclick = () => {
      const inputVal = amountInput ? amountInput.value : amount;
      const validation = parseAndValidatePaymentAmount(inputVal, currentPaymentMaxAmount);
      if (!validation.valid) {
        if (alertBox) {
          showAlert(alertBox, validation.message);
          if (window.FX) window.FX.shake(alertBox);
        } else {
          alert(validation.message);
        }
        return;
      }

      closePaymentMethodModal();
      startUpiPayment(validation.amount, toUserId);
    };
  }

  async function startUpiPayment(amount, toUserId) {
    window.isPaymentActive = true;
    try {
      const res = await api('/payment/intent', {
        method: 'POST',
        body: JSON.stringify({ groupId, toUserId, amount })
      });

      currentPayerIntentId = res.intentId;
      openUpiPayerModal(res);
    } catch (err) {
      window.isPaymentActive = false;
      alert(err.message || "Failed to initiate UPI payment");
    }
  }

  let activeStatusPollTimer = null;
  let isPollRequestInFlight = false;
  let consecutivePollErrors = 0;
  let polledIntentId = null;

  function stopStatusPolling() {
    if (activeStatusPollTimer) {
      clearTimeout(activeStatusPollTimer);
      activeStatusPollTimer = null;
    }
    isPollRequestInFlight = false;
    consecutivePollErrors = 0;
    polledIntentId = null;
  }

  function startStatusPolling(intentId) {
    stopStatusPolling();
    if (!intentId) return;
    polledIntentId = intentId;

    const scheduleNext = () => {
      const modal = document.getElementById('upiPayerModal');
      if (!modal || !modal.classList.contains('open') || polledIntentId !== intentId) {
        stopStatusPolling();
        return;
      }
      activeStatusPollTimer = setTimeout(executePoll, 4000);
    };

    const executePoll = async () => {
      const modal = document.getElementById('upiPayerModal');
      if (!modal || !modal.classList.contains('open') || polledIntentId !== intentId) {
        stopStatusPolling();
        return;
      }

      if (isPollRequestInFlight) {
        scheduleNext();
        return;
      }

      isPollRequestInFlight = true;
      try {
        const data = await api(`/payment/status/${intentId}`);
        if (polledIntentId !== intentId || !modal.classList.contains('open')) {
          stopStatusPolling();
          return;
        }

        consecutivePollErrors = 0;

        if (data && data.status) {
          if (data.status === 'recipient_confirmed') {
            closeUpiPayerModal();
            window.isPaymentActive = false;

            if (window.FX) {
              window.FX.toast('Payment confirmed by recipient! 🎉');
              window.FX.confettiBurst();
            } else {
              alert('Payment confirmed by recipient!');
            }
            await initLoadAll(true).catch(e => console.warn('Payment refresh failed', e));
            return;
          }

          if (data.status === 'recipient_rejected') {
            stopStatusPolling();
            const alertBox = document.getElementById('upiPayerAlert');
            showAlert(alertBox, 'Recipient rejected this payment claim. Please verify your transfer details.');
            const statusText = document.getElementById('upiPayerStatusText');
            if (statusText) statusText.textContent = "Payment claim was rejected by recipient.";
            const btnClaim = document.getElementById('btnUpiClaim');
            if (btnClaim) btnClaim.style.display = 'none';
            return;
          }

          if (data.status === 'cancelled') {
            closeUpiPayerModal();
            window.isPaymentActive = false;
            await initLoadAll(true).catch(e => console.warn('Payment refresh failed', e));
            return;
          }
        }
        scheduleNext();
      } catch (err) {
        consecutivePollErrors++;
        if (consecutivePollErrors >= 4) {
          stopStatusPolling();
          const alertBox = document.getElementById('upiPayerAlert');
          showAlert(alertBox, 'Unable to check live payment status. You can close this dialog and check back later.');
          return;
        }
        scheduleNext();
      } finally {
        isPollRequestInFlight = false;
      }
    };

    scheduleNext();
  }

  window.addEventListener('pagehide', stopStatusPolling);

  let upiPayerModalLastFocus = null;
  let upiPayerFocusTimeout;

  function closeUpiPayerModal() {
    stopStatusPolling();
    const modal = document.getElementById('upiPayerModal');
    if (modal) {
      modal.classList.remove('open');
    }
    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.classList.remove('modal-open');
    }
    clearTimeout(upiPayerFocusTimeout);
    restoreFocusSafe(upiPayerModalLastFocus);
    currentPayerIntentId = null;
    if (!window.isPaymentRequestInFlight) {
      window.isPaymentActive = false;
    }
  }

  function openUpiPayerModal(intentData) {
    stopStatusPolling();
    if (intentData?.intentId || intentData?._id) {
      currentPayerIntentId = intentData.intentId || intentData._id;
    }
    upiPayerModalLastFocus = document.activeElement;
    const modal = document.getElementById('upiPayerModal');
    const alertBox = document.getElementById('upiPayerAlert');
    const linkContainer = document.getElementById('upiLinkContainer');
    const qrContainer = document.getElementById('upiQrContainer');
    const btnCancel = document.getElementById('btnUpiCancel');
    const btnClaim = document.getElementById('btnUpiClaim');
    const statusText = document.getElementById('upiPayerStatusText');

    if (qrContainer) {
      qrContainer.innerHTML = '';
      qrContainer.style.display = 'none';
    }

    hideAlert(alertBox);
    modal.classList.add('open');
    document.body.classList.add('modal-open');
    clearTimeout(upiPayerFocusTimeout);
    upiPayerFocusTimeout = setTimeout(() => {
      if (modal.classList.contains('open')) modal.querySelector('button')?.focus();
    }, 50);

    document.getElementById('closeUpiPayerBtn').onclick = () => {
      closeUpiPayerModal();
    };

    modal.onclick = (e) => {
      if (e.target === modal && !window.isPaymentRequestInFlight) {
        closeUpiPayerModal();
      }
    };

    if (intentData.status === 'pending') {
      statusText.textContent = "Complete your payment using any UPI app.";
      linkContainer.style.display = 'block';
      btnCancel.style.display = 'block';
      btnClaim.style.display = 'block';

      const upiLink = document.getElementById('upiDeepLink');
      const desktopMsg = document.getElementById('upiDesktopMessage');

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const fallbackContainer = document.getElementById('upiFallbackDetails');

      if (intentData.payeeName && intentData.payeeUpiId) {
        document.getElementById('upiFallbackName').textContent = intentData.payeeName;
        document.getElementById('upiFallbackId').textContent = intentData.payeeUpiId;
        document.getElementById('upiFallbackAmount').textContent = intentData.amount.toFixed(2);
        fallbackContainer.style.display = 'block';

        const btnCopy = document.getElementById('btnCopyUpi');
        if (btnCopy) {
          btnCopy.onclick = async () => {
            const textToCopy = intentData.payeeUpiId;
            if (!textToCopy) return;

            let success = false;
            if (navigator.clipboard && window.isSecureContext) {
              try {
                await navigator.clipboard.writeText(textToCopy);
                success = true;
              } catch (e) {
                success = false;
              }
            }
            if (!success) {
              try {
                const ta = document.createElement('textarea');
                ta.value = textToCopy;
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                success = document.execCommand('copy');
                document.body.removeChild(ta);
              } catch (e) {
                success = false;
              }
            }
            const origText = btnCopy.textContent;
            btnCopy.textContent = success ? 'Copied!' : 'Failed';
            setTimeout(() => { btnCopy.textContent = origText; }, 2000);
          };
        }
      } else {
        fallbackContainer.style.display = 'none';
      }

      if (isMobile) {
        upiLink.style.display = 'block';
        desktopMsg.style.display = 'none';
        if (qrContainer) qrContainer.style.display = 'none';
        if (intentData.upiUri) upiLink.href = intentData.upiUri;
      } else {
        upiLink.style.display = 'none';
        desktopMsg.style.display = 'block';
        if (qrContainer && intentData.upiUri) {
          try {
            if (typeof QRCode !== 'undefined') {
              new QRCode(qrContainer, {
                text: intentData.upiUri,
                width: 180,
                height: 180,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
              });
              qrContainer.style.display = 'inline-block';
              desktopMsg.textContent = 'Scan with any UPI app on your phone to pay.';
            } else {
              qrContainer.style.display = 'none';
              desktopMsg.textContent = 'Use the UPI details below to complete your transfer in any UPI app.';
            }
          } catch (qrErr) {
            console.warn('QR code generation failed:', qrErr);
            qrContainer.style.display = 'none';
            desktopMsg.textContent = 'Use the UPI details below to complete your transfer in any UPI app.';
          }
        }
      }

    } else if (intentData.status === 'payer_claimed') {
      statusText.textContent = "Payment claimed. Awaiting confirmation from the recipient.";
      linkContainer.style.display = 'none';
      if (qrContainer) qrContainer.style.display = 'none';
      document.getElementById('upiFallbackDetails').style.display = 'none';
      btnCancel.style.display = 'none';
      btnClaim.style.display = 'none';
      startStatusPolling(currentPayerIntentId || intentData.intentId || intentData._id);
    }

    btnClaim.onclick = async () => {
      try {
        window.isPaymentRequestInFlight = true;
        const res = await api('/payment/claim', {
          method: 'POST',
          body: JSON.stringify({ intentId: currentPayerIntentId })
        });
        openUpiPayerModal(res);
      } catch (err) {
        showAlert(alertBox, err.message);
      } finally {
        window.isPaymentRequestInFlight = false;
        if (!document.getElementById('upiPayerModal').classList.contains('open')) {
          window.isPaymentActive = false;
        }
      }
    };

    btnCancel.onclick = async () => {
      if (!confirm("Cancelling this payment intent does not reverse any money already sent through your UPI app. Are you sure you want to cancel?")) {
        return;
      }
      stopStatusPolling();
      const intentToCancel = currentPayerIntentId;
      btnCancel.disabled = true;
      const originalText = btnCancel.textContent;
      btnCancel.textContent = 'Cancelling...';
      try {
        window.isPaymentRequestInFlight = true;
        await api('/payment/cancel', {
          method: 'POST',
          body: JSON.stringify({ intentId: intentToCancel })
        });
        window.isPaymentRequestInFlight = false;
        window.isPaymentActive = false;
        closeUpiPayerModal();
        await initLoadAll(true).catch(() => window.location.reload());
      } catch (err) {
        window.isPaymentRequestInFlight = false;
        showAlert(alertBox, err.message);
      } finally {
        btnCancel.disabled = false;
        btnCancel.textContent = originalText;
        window.isPaymentRequestInFlight = false;
        if (!document.getElementById('upiPayerModal')?.classList.contains('open')) {
          window.isPaymentActive = false;
        }
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

      let upiRecipientModalLastFocus = document.activeElement;
      let upiRecipientFocusTimeout;
      currentRecipientIntentId = intent.intentId;
      const modal = document.getElementById('upiRecipientModal');
      const alertBox = document.getElementById('upiRecipientAlert');
      const statusText = document.getElementById('upiRecipientStatusText');

      hideAlert(alertBox);
      statusText.textContent = `${intent.payerName} claims they paid you ₹${intent.amount}. Please confirm if you received it.`;
      modal.classList.add('open');
      document.body.classList.add('modal-open');
      clearTimeout(upiRecipientFocusTimeout);
      upiRecipientFocusTimeout = setTimeout(() => {
        if (modal.classList.contains('open')) modal.querySelector('button')?.focus();
      }, 50);

      document.getElementById('closeUpiRecipientBtn').onclick = () => {
        modal.classList.remove('open');
        if (!document.querySelector('.modal-backdrop.open')) {
          document.body.classList.remove('modal-open');
        }
        clearTimeout(upiRecipientFocusTimeout);
        restoreFocusSafe(upiRecipientModalLastFocus);
      };

      modal.onclick = (e) => {
        if (e.target === modal) {
          document.getElementById('closeUpiRecipientBtn')?.click();
        }
      };

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

  // Expose handlers for testing
  window.startPayment = startPayment;
  window.startUpiPayment = startUpiPayment;
  window.openUpiPayerModal = openUpiPayerModal;
  window.closeUpiPayerModal = closeUpiPayerModal;
}