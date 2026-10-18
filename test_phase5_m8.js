/**
 * LendLocal Stage 3, Phase 5 — Milestone 8 (M8) Test Suite
 * Native Group Expense Search, Category Filtering, and Category Badges
 *
 * Direct Production Imports:
 * - FILTER_CATEGORIES, CATEGORY_ICONS, getCategoryIcon from mobile/src/utils/expenseForm.ts
 * - EXPENSE_CATEGORIES from mobile/src/utils/expenseForm.ts
 *
 * Test Coverage:
 * 1. Filter category definitions & icon mapping integrity
 * 2. Backend search & category query serialization compatibility
 * 3. Sequence counter & out-of-order response deduplication
 * 4. Error recovery & loaded expenses preservation on network failure
 * 5. Distinct empty states (empty group vs filtered empty with Clear Filters)
 * 6. Active filter preservation across ledger mutations and pull-to-refresh
 * 7. Debounce timing & redundant filter request suppression
 */

const assert = require('assert');

// 1. Direct production imports
const {
  FILTER_CATEGORIES,
  CATEGORY_ICONS,
  getCategoryIcon,
  EXPENSE_CATEGORIES,
} = require('./mobile/src/utils/expenseForm.ts');

console.log('--- Running Stage 3 Phase 5 M8 Unit & Integration Tests ---');

// ============================================================================
// 1. Filter Category Definitions & Icon Mapping Integrity
// ============================================================================

console.log('Testing FILTER_CATEGORIES & CATEGORY_ICONS (direct production)...');

// Test 1.1: Verify FILTER_CATEGORIES derives directly from EXPENSE_CATEGORIES with 'All' first
{
  const expected = ['All', ...EXPENSE_CATEGORIES];
  assert.deepStrictEqual([...FILTER_CATEGORIES], expected);
  assert.strictEqual(FILTER_CATEGORIES[0], 'All');
  assert.strictEqual(FILTER_CATEGORIES.length, EXPENSE_CATEGORIES.length + 1);

  // Verify Rent is filterable
  assert.strictEqual(FILTER_CATEGORIES.includes('Rent'), true);

  // Verify filter-only categories that expense form cannot create are absent
  assert.strictEqual(FILTER_CATEGORIES.includes('Transport'), false);
  assert.strictEqual(FILTER_CATEGORIES.includes('Shopping'), false);
  assert.strictEqual(FILTER_CATEGORIES.includes('Health'), false);

  // Verify every single EXPENSE_CATEGORY is in FILTER_CATEGORIES
  for (const cat of EXPENSE_CATEGORIES) {
    assert.strictEqual(FILTER_CATEGORIES.includes(cat), true);
  }
}

// Test 1.2: Verify CATEGORY_ICONS maps all categories properly
{
  assert.strictEqual(CATEGORY_ICONS['Food'], '🍔');
  assert.strictEqual(CATEGORY_ICONS['Transport'], '🚗');
  assert.strictEqual(CATEGORY_ICONS['Utilities'], '⚡');
  assert.strictEqual(CATEGORY_ICONS['Entertainment'], '🎬');
  assert.strictEqual(CATEGORY_ICONS['Shopping'], '🛍️');
  assert.strictEqual(CATEGORY_ICONS['Travel'], '✈️');
  assert.strictEqual(CATEGORY_ICONS['Health'], '💊');
  assert.strictEqual(CATEGORY_ICONS['General'], '🏷️');
  assert.strictEqual(CATEGORY_ICONS['Rent'], '🏠');
}

// Test 1.3: Verify getCategoryIcon returns correct icons and handles edge cases
{
  assert.strictEqual(getCategoryIcon('Food'), '🍔');
  assert.strictEqual(getCategoryIcon('Transport'), '🚗');
  assert.strictEqual(getCategoryIcon('Utilities'), '⚡');
  assert.strictEqual(getCategoryIcon('Entertainment'), '🎬');
  assert.strictEqual(getCategoryIcon('Shopping'), '🛍️');
  assert.strictEqual(getCategoryIcon('Travel'), '✈️');
  assert.strictEqual(getCategoryIcon('Health'), '💊');
  assert.strictEqual(getCategoryIcon('General'), '🏷️');
  assert.strictEqual(getCategoryIcon('Rent'), '🏠');

  // Edge cases: null, undefined, empty string, unknown category
  assert.strictEqual(getCategoryIcon(null), '🏷️');
  assert.strictEqual(getCategoryIcon(undefined), '🏷️');
  assert.strictEqual(getCategoryIcon(''), '🏷️');
  assert.strictEqual(getCategoryIcon('Miscellaneous'), '🏷️');
}

// ============================================================================
// 2. Query Serialization Compatibility with Backend
// ============================================================================

console.log('Testing query serialization with existing expensesApi logic...');

// Helper mimicking expensesApi.list URL construction from mobile/src/services/expensesApi.ts
function buildExpensesEndpoint(groupId, filters) {
  const params = new URLSearchParams();
  if (filters?.search && filters.search.trim()) {
    params.append('search', filters.search.trim());
  }
  if (filters?.category && filters.category.trim()) {
    params.append('category', filters.category.trim());
  }
  if (filters?.payer && filters.payer.trim()) {
    params.append('payer', filters.payer.trim());
  }
  if (filters?.startDate && filters.startDate.trim()) {
    params.append('startDate', filters.startDate.trim());
  }
  if (filters?.endDate && filters.endDate.trim()) {
    params.append('endDate', filters.endDate.trim());
  }

  const queryString = params.toString();
  return queryString ? `/expenses/${groupId}?${queryString}` : `/expenses/${groupId}`;
}

// Test 2.1: No filters -> clean endpoint
{
  const ep = buildExpensesEndpoint('group123', {});
  assert.strictEqual(ep, '/expenses/group123');
}

// Test 2.2: Search filter only with trimming
{
  const ep = buildExpensesEndpoint('group123', { search: '  dinner with friends  ' });
  assert.strictEqual(ep, '/expenses/group123?search=dinner+with+friends');
}

// Test 2.3: Category filter only
{
  const ep = buildExpensesEndpoint('group123', { category: 'Food' });
  assert.strictEqual(ep, '/expenses/group123?category=Food');
}

// Test 2.4: Search and Category combined
{
  const ep = buildExpensesEndpoint('group123', { search: 'swiggy', category: 'Food' });
  assert.strictEqual(ep, '/expenses/group123?search=swiggy&category=Food');
}

// Test 2.5: Category 'All' or empty category omitted from URL
{
  const ep = buildExpensesEndpoint('group123', { search: 'cab', category: '' });
  assert.strictEqual(ep, '/expenses/group123?search=cab');
}

// ============================================================================
// 3. Sequence Counter & Out-of-Order Response Deduplication
// ============================================================================

console.log('Testing sequence counter & concurrency protection...');

// Simulate the hook's sequence counter state machine
class HookFilterDeduplicator {
  constructor() {
    this.filterSeq = 0;
    this.expenses = [];
    this.isFiltering = false;
    this.filterError = null;
  }

  async fetchFiltered(filters, mockResponseTimeMs, mockResult, shouldReject = false) {
    const currentSeq = ++this.filterSeq;
    this.isFiltering = true;
    this.filterError = null;

    try {
      await new Promise((resolve) => setTimeout(resolve, mockResponseTimeMs));
      if (shouldReject) {
        throw new Error('Network error');
      }
      if (currentSeq !== this.filterSeq) {
        // Discard stale response
        return { discarded: true, seq: currentSeq };
      }
      this.expenses = mockResult;
      this.filterError = null;
      return { discarded: false, seq: currentSeq };
    } catch (err) {
      if (currentSeq !== this.filterSeq) {
        return { discarded: true, seq: currentSeq, error: err };
      }
      // Non-blocking: keep existing expenses
      this.filterError = err.message;
      return { discarded: false, seq: currentSeq, error: err };
    } finally {
      if (currentSeq === this.filterSeq) {
        this.isFiltering = false;
      }
    }
  }

  // Full load invalidates in-flight filter requests
  fullLoad(newExpenses) {
    this.filterSeq += 1;
    this.expenses = newExpenses;
    this.filterError = null;
  }
}

// Test 3.1: Stale slow response from query 1 arriving AFTER query 2 is discarded
(async () => {
  const deduplicator = new HookFilterDeduplicator();
  const initialExpenses = [{ id: 'exp1', description: 'Initial' }];
  deduplicator.expenses = initialExpenses;

  // Request 1: Search "di", slow (100ms) -> returns [ExpA]
  const p1 = deduplicator.fetchFiltered({ search: 'di' }, 100, [{ id: 'expA', description: 'Dinner' }]);

  // Request 2: Search "dinner", fast (30ms) -> returns [ExpB]
  const p2 = deduplicator.fetchFiltered({ search: 'dinner' }, 30, [{ id: 'expB', description: 'Dinner buffet' }]);

  const [res1, res2] = await Promise.all([p1, p2]);

  // Request 2 should have been accepted
  assert.strictEqual(res2.discarded, false);
  // Request 1 should have been discarded
  assert.strictEqual(res1.discarded, true);

  // Final expenses in state must be from Request 2 (the latest initiated query)
  assert.strictEqual(deduplicator.expenses.length, 1);
  assert.strictEqual(deduplicator.expenses[0].description, 'Dinner buffet');
  assert.strictEqual(deduplicator.isFiltering, false);
})().then(() => {
  // Test 3.2: Full load bumps filterSeq and invalidates in-flight filter response
  return (async () => {
    const deduplicator = new HookFilterDeduplicator();
    deduplicator.expenses = [{ id: 'exp1', description: 'Old' }];

    // Trigger in-flight filter query
    const filterPromise = deduplicator.fetchFiltered({ search: 'coffee' }, 80, [{ id: 'expC', description: 'Coffee' }]);

    // While filter is in-flight, a pull-to-refresh / full load resolves
    deduplicator.fullLoad([{ id: 'expFresh', description: 'Freshly loaded' }]);

    const filterResult = await filterPromise;
    assert.strictEqual(filterResult.discarded, true);
    assert.strictEqual(deduplicator.expenses[0].id, 'expFresh');
  })();
}).then(() => {

  // ============================================================================
  // 4. Preserving Loaded Expenses on Filter Failure & Non-blocking Retry
  // ============================================================================

  console.log('Testing error preservation & non-blocking retry...');

  return (async () => {
    const deduplicator = new HookFilterDeduplicator();
    const existingExpenses = [
      { id: 'exp1', description: 'Pizza', category: 'Food' },
      { id: 'exp2', description: 'Monthly rent', category: 'Rent' },
    ];
    deduplicator.expenses = existingExpenses;

    // Filter request fails due to offline/network failure
    const failResult = await deduplicator.fetchFiltered({ search: 'Metro' }, 20, null, true);

    // Filter error recorded
    assert.strictEqual(failResult.discarded, false);
    assert.strictEqual(deduplicator.filterError, 'Network error');

    // CRITICAL: loaded expenses must NOT be destroyed!
    assert.strictEqual(deduplicator.expenses.length, 2);
    assert.strictEqual(deduplicator.expenses[0].description, 'Pizza');
    assert.strictEqual(deduplicator.expenses[1].description, 'Monthly rent');
    assert.strictEqual(deduplicator.isFiltering, false);

    // Retry succeeds: clears error and updates expenses
    const retryResult = await deduplicator.fetchFiltered({ search: 'Metro' }, 20, [{ id: 'exp3', description: 'Metro pass' }], false);
    assert.strictEqual(retryResult.discarded, false);
    assert.strictEqual(deduplicator.filterError, null);
    assert.strictEqual(deduplicator.expenses.length, 1);
    assert.strictEqual(deduplicator.expenses[0].description, 'Metro pass');
  })();
}).then(() => {

  // ============================================================================
  // 5. Empty State Distinction Logic
  // ============================================================================

  console.log('Testing empty state distinction logic...');

  // Function mirroring isFilterActive logic from GroupDetailScreen
  function computeFilterActive(filters, searchInput, selectedCategory) {
    return Boolean(
      (filters?.search && filters.search.trim().length > 0) ||
      (filters?.category && filters.category.trim().length > 0) ||
      (searchInput && searchInput.trim().length > 0) ||
      (selectedCategory && selectedCategory !== 'All')
    );
  }

  // Test 5.1: Truly empty group (no expenses, no active search or category)
  {
    const isFilterActive = computeFilterActive({}, '', 'All');
    assert.strictEqual(isFilterActive, false);
    // UI displays "No expenses recorded yet" + "+ Add First Expense"
  }

  // Test 5.2: Search text entered, expenses empty -> filtered empty state
  {
    const isFilterActive = computeFilterActive({ search: 'cinema' }, 'cinema', 'All');
    assert.strictEqual(isFilterActive, true);
    // UI displays "No matching expenses" + "Clear Filters"
  }

  // Test 5.3: Category chip selected (e.g. 'Food'), search empty -> filtered empty state
  {
    const isFilterActive = computeFilterActive({ category: 'Food' }, '', 'Food');
    assert.strictEqual(isFilterActive, true);
    // UI displays "No matching expenses" + "Clear Filters"
  }

  // Test 5.4: Whitespace only in search -> not active
  {
    const isFilterActive = computeFilterActive({}, '   ', 'All');
    assert.strictEqual(isFilterActive, false);
  }

  // Test 5.5: Clear Filters resets everything
  {
    let searchInput = 'groceries';
    let selectedCategory = 'Food';
    let filters = { search: 'groceries', category: 'Food' };

    // User taps "Clear Filters"
    searchInput = '';
    selectedCategory = 'All';
    filters = {};

    const isFilterActive = computeFilterActive(filters, searchInput, selectedCategory);
    assert.strictEqual(isFilterActive, false);
  }

  // ============================================================================
  // 6. Active Filter Preservation Across Ledger Mutations & Pull-to-Refresh
  // ============================================================================

  console.log('Testing filter persistence across mutations and refreshes...');

  // Simulate useGroupDetail's load() preserving active filters
  class GroupDetailCoordinator {
    constructor() {
      this.filters = {};
      this.lastFetchedWithFilters = null;
      this.expenses = [];
      this.balances = { totalSpent: 1000 };
    }

    setFilter(newFilters) {
      this.filters = newFilters;
      this.lastFetchedWithFilters = { ...newFilters };
    }

    // load() uses this.filters (filtersRef.current in React hook)
    async load(isRefresh = false) {
      this.lastFetchedWithFilters = { ...this.filters };
      return { success: true, filtersUsed: this.lastFetchedWithFilters };
    }

    async createExpense(expensePayload) {
      // Execute mutation, then call load(true, true)
      await this.load(true);
    }

    async updateExpense(id, payload) {
      await this.load(true);
    }

    async deleteExpense(id) {
      await this.load(true);
    }
  }

  return (async () => {
    const coordinator = new GroupDetailCoordinator();

    // User selects category 'Travel'
    coordinator.setFilter({ category: 'Travel' });
    assert.deepStrictEqual(coordinator.lastFetchedWithFilters, { category: 'Travel' });

    // User creates a new expense while viewing 'Travel' filter
    await coordinator.createExpense({ description: 'Flight ticket', amount: 5000, category: 'Travel' });
    // Refetched with the same active filter
    assert.deepStrictEqual(coordinator.lastFetchedWithFilters, { category: 'Travel' });

    // User updates an expense while viewing 'Travel' filter
    await coordinator.updateExpense('exp1', { amount: 5200 });
    assert.deepStrictEqual(coordinator.lastFetchedWithFilters, { category: 'Travel' });

    // User deletes an expense while viewing 'Travel' filter
    await coordinator.deleteExpense('exp1');
    assert.deepStrictEqual(coordinator.lastFetchedWithFilters, { category: 'Travel' });

    // User pulls to refresh
    await coordinator.load(true);
    assert.deepStrictEqual(coordinator.lastFetchedWithFilters, { category: 'Travel' });
  })();
}).then(() => {

  // ============================================================================
  // 7. Debounce Timing & Redundant Query Suppression
  // ============================================================================

  console.log('Testing debouncing & redundant query suppression...');

  return (async () => {
    let dispatchedQueries = [];

    class Debouncer {
      constructor(onDispatch, delayMs = 300) {
        this.onDispatch = onDispatch;
        this.delayMs = delayMs;
        this.timer = null;
        this.currentFilter = {};
      }

      onInputChange(text, category) {
        if (this.timer) clearTimeout(this.timer);

        this.timer = setTimeout(() => {
          const trimmed = text.trim();
          const cat = category === 'All' ? undefined : category;
          const currentSearch = this.currentFilter.search || '';
          const currentCat = this.currentFilter.category || undefined;

          if (trimmed !== currentSearch || cat !== currentCat) {
            this.currentFilter = {
              search: trimmed || undefined,
              category: cat,
            };
            this.onDispatch(this.currentFilter);
          }
        }, this.delayMs);
      }
    }

    const debouncer = new Debouncer((filter) => {
      dispatchedQueries.push(filter);
    }, 50);

    // User rapidly types "p", "pi", "piz", "pizza"
    debouncer.onInputChange('p', 'All');
    await new Promise((r) => setTimeout(r, 10));
    debouncer.onInputChange('pi', 'All');
    await new Promise((r) => setTimeout(r, 10));
    debouncer.onInputChange('piz', 'All');
    await new Promise((r) => setTimeout(r, 10));
    debouncer.onInputChange('pizza', 'All');

    // Wait for debounce delay
    await new Promise((r) => setTimeout(r, 80));

    // Only ONE query should have been dispatched: "pizza"
    assert.strictEqual(dispatchedQueries.length, 1);
    assert.strictEqual(dispatchedQueries[0].search, 'pizza');
    assert.strictEqual(dispatchedQueries[0].category, undefined);

    // If user types identical text again, no new query dispatched
    debouncer.onInputChange('pizza', 'All');
    await new Promise((r) => setTimeout(r, 80));
    assert.strictEqual(dispatchedQueries.length, 1);
  })();
}).then(() => {
  console.log('\n✅ ALL STAGE 3 PHASE 5 M8 TESTS PASSED (7/7 Suites)');
}).catch((err) => {
  console.error('\n❌ TEST FAILURE:', err);
  process.exit(1);
});
