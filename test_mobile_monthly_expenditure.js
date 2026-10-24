/**
 * test_mobile_monthly_expenditure.js
 *
 * Verifies Native Mobile Monthly Expenditure Implementation:
 * 1. expensesApi.getMonthlyAnalytics client contract
 * 2. MonthlyAnalyticsResponse TypeScript types and interfaces
 * 3. MonthlyExpenditureModal component structure and invariants:
 *    - Date boundary enforcement (future months blocked)
 *    - December / January year rollover
 *    - Allocated expense share (primary metric)
 *    - Secondary metrics (personally paid, owed to others, owed to you)
 *    - Category breakdown & daily activity trend
 *    - Loading, error, and empty states
 * 4. HomeScreen (mobile/src/app/index.tsx) integration
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Mobile Monthly Expenditure Workstream Test Suite ---');

// 1. Inspect mobile/src/services/expensesApi.ts
console.log('1. Testing expensesApi.getMonthlyAnalytics contract...');
const expensesApiPath = path.join(__dirname, 'mobile', 'src', 'services', 'expensesApi.ts');
const expensesApiSrc = fs.readFileSync(expensesApiPath, 'utf8');

assert(expensesApiSrc.includes('getMonthlyAnalytics: async (year: number, month: number)'),
  'expensesApi must export getMonthlyAnalytics(year, month)');
assert(expensesApiSrc.includes('`/expenses/analytics/monthly?year=${year}&month=${month}`'),
  'getMonthlyAnalytics must query /expenses/analytics/monthly?year=...&month=...');
console.log('✅ expensesApi.getMonthlyAnalytics client contract verified.');

// 2. Inspect mobile/src/types/api.ts
console.log('2. Testing MonthlyAnalyticsResponse type definitions...');
const typesApiPath = path.join(__dirname, 'mobile', 'src', 'types', 'api.ts');
const typesApiSrc = fs.readFileSync(typesApiPath, 'utf8');

assert(typesApiSrc.includes('export interface MonthlyAnalyticsResponse'),
  'api.ts must export MonthlyAnalyticsResponse');
assert(typesApiSrc.includes('primaryMetric: {'),
  'MonthlyAnalyticsResponse must define primaryMetric');
assert(typesApiSrc.includes('secondaryMetrics: {'),
  'MonthlyAnalyticsResponse must define secondaryMetrics');
assert(typesApiSrc.includes('categoryBreakdown: MonthlyAnalyticsCategoryItem[]'),
  'MonthlyAnalyticsResponse must define categoryBreakdown');
assert(typesApiSrc.includes('dailyTrend: MonthlyAnalyticsDailyTrendItem[]'),
  'MonthlyAnalyticsResponse must define dailyTrend');
assert(typesApiSrc.includes('recentExpenses: MonthlyAnalyticsRecentExpenseItem[]'),
  'MonthlyAnalyticsResponse must define recentExpenses');
console.log('✅ MonthlyAnalyticsResponse type definitions verified.');

// 3. Inspect mobile/src/components/MonthlyExpenditureModal.tsx
console.log('3. Testing MonthlyExpenditureModal component invariants...');
const modalPath = path.join(__dirname, 'mobile', 'src', 'components', 'MonthlyExpenditureModal.tsx');
assert(fs.existsSync(modalPath), 'MonthlyExpenditureModal.tsx component must exist');
const modalSrc = fs.readFileSync(modalPath, 'utf8');

// Date boundary check
assert(modalSrc.includes('year > curYear || (year === curYear && month >= curMonth)'),
  'MonthlyExpenditureModal must lock navigation on current or future months');
assert(modalSrc.includes('isCurrentOrFutureMonth && styles.monthNavBtnDisabled'),
  'Next month button must display disabled styling on current or future months');

// December / January year rollover check
assert(modalSrc.includes('if (nextM < 1) {\n      nextM = 12;\n      nextY -= 1;\n    }'),
  'Prev month must roll back from January (1) to December (12) of previous year');
assert(modalSrc.includes('if (nextM > 12) {\n      nextM = 1;\n      nextY += 1;\n    }'),
  'Next month must roll forward from December (12) to January (1) of next year');

// Primary metric & secondary metrics
assert(modalSrc.includes('formatINR(data.primaryMetric?.amount || 0)'),
  'Must display formatted primary allocated expense share');
assert(modalSrc.includes('formatINR(data.secondaryMetrics?.personallyPaid || 0)'),
  'Must display personally paid secondary metric');
assert(modalSrc.includes('formatINR(data.secondaryMetrics?.netOwedToOthers || 0)'),
  'Must display net owed to others secondary metric');
assert(modalSrc.includes('formatINR(data.secondaryMetrics?.netOwedToUser || 0)'),
  'Must display net owed to user secondary metric');

// Category breakdown & Daily trend
assert(modalSrc.includes('data.categoryBreakdown.map'),
  'Must render category breakdown items');
assert(modalSrc.includes('data.dailyTrend.map'),
  'Must render daily activity trend bars');

// Loading & Error states
assert(modalSrc.includes('ActivityIndicator size="large" color={Brand.primary}'),
  'Must render loading indicator during data fetch');
assert(modalSrc.includes('styles.retryBtn'),
  'Must render retry button when fetch fails');
console.log('✅ MonthlyExpenditureModal component invariants verified.');

// 4. Inspect mobile/src/app/index.tsx integration
console.log('4. Testing HomeScreen dashboard integration...');
const homePath = path.join(__dirname, 'mobile', 'src', 'app', 'index.tsx');
const homeSrc = fs.readFileSync(homePath, 'utf8');

assert(homeSrc.includes("import { MonthlyExpenditureModal } from '../components/MonthlyExpenditureModal';"),
  'HomeScreen must import MonthlyExpenditureModal');
assert(homeSrc.includes('const [showMonthlyModal, setShowMonthlyModal] = useState(false);'),
  'HomeScreen must manage showMonthlyModal state');
assert(homeSrc.includes('styles.monthlyExpenditureCard'),
  'HomeScreen must render monthlyExpenditureCard affordance');
assert(homeSrc.includes('<MonthlyExpenditureModal'),
  'HomeScreen must mount MonthlyExpenditureModal');
assert(homeSrc.includes('visible={showMonthlyModal}'),
  'MonthlyExpenditureModal visible prop must bind to showMonthlyModal');
console.log('✅ HomeScreen dashboard integration verified.');

console.log('🎉 ALL Mobile Monthly Expenditure Tests Passed Successfully!');

