/**
 * LendLocal Domain Types and API Contracts
 *
 * Source-verified against backend routes (backend/routes/{groups,expenses,balances,auth}.js),
 * Mongoose models (backend/models/{User,Group,Expense,payment}.js),
 * and accounting helpers (backend/utils/helpers.js).
 *
 * FINANCIAL ACCURACY RULES:
 * 1. All balance and ledger calculations are performed authoritatively by the backend.
 *    The mobile client must never calculate net balances or pairwise debt simplification locally.
 * 2. All monetary amounts are in INR (Rupees) with at most two decimal places.
 * 3. In custom splits, the sum of shares converted to integer paise (Math.round(share * 100))
 *    must strictly equal the total expense amount in paise.
 * 4. User and member objects may have omitted or empty-string email addresses when viewed by
 *    departed historical participants for privacy protection.
 */

// ============================================================================
// COMMON & PARTICIPANT TYPES
// ============================================================================

export interface ApiUserSummary {
  id: string;
  name: string;
  email?: string;
}

export interface SettlementParticipant {
  id: string;
  userId: string;
  name: string;
}

export interface SettlementDebt {
  from: SettlementParticipant;
  to: SettlementParticipant;
  amount: number;
}

// ============================================================================
// GROUPS DOMAIN CONTRACTS
// ============================================================================

export interface GroupMember {
  id: string;
  name: string;
  /**
   * Email is omitted in GET /api/groups or set to empty string "" in GET /api/groups/:id
   * when the viewing user is a departed historical participant.
   */
  email?: string;
}

export interface GroupCreator {
  _id?: string;
  id?: string;
  name: string;
  email?: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  members: GroupMember[];
  createdBy: GroupCreator;
  /**
   * Net balance of the current authenticated user in this group in INR.
   * Positive = user is owed money (creditor).
   * Negative = user owes money (debtor).
   */
  myBalance: number;
  settlements: SettlementDebt[];
  expenseCount: number;
  updatedAt: string;
  createdAt: string;
  isActiveMember: boolean;
  hasOutstandingBalance: boolean;
}

export interface GroupsResponse {
  groups: GroupSummary[];
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string;
  members: GroupMember[];
  createdBy: GroupCreator;
  updatedAt: string;
  createdAt: string;
  isActiveMember: boolean;
}

export interface GroupDetailResponse {
  group: GroupDetail;
}

export interface CreateGroupPayload {
  name: string;
  description?: string;
  /**
   * Optional array of emails of registered LendLocal users to add as members.
   * Creator is automatically added as the first member.
   */
  memberEmails?: string[];
}

export interface CreateGroupResponse {
  group: {
    id: string;
    name: string;
    description: string;
    members: GroupMember[];
    createdBy: GroupCreator;
  };
}

export interface AddMemberPayload {
  email: string;
}

export interface AddMemberResponse {
  message: string;
  member: {
    id: string;
    name: string;
    email: string;
  };
}

export interface LeaveGroupResponse {
  message: string;
}

export interface RenameGroupPayload {
  name: string;
}

export interface RenameGroupResponse {
  message: string;
  group: {
    id: string;
    name: string;
    description: string;
    updatedAt: string;
  };
}

export interface DeleteGroupResponse {
  message: string;
}

// ============================================================================
// EXPENSES DOMAIN CONTRACTS
// ============================================================================

export interface ExpenseSplitAllocation {
  user: {
    id: string | null;
    name: string | null;
    email?: string | null;
  };
  share: number;
}

export interface ExpensePayer {
  id: string | null;
  name: string | null;
  email?: string | null;
}

export interface ExpenseItem {
  id: string;
  description: string;
  amount: number;
  category: string;
  splitType: 'equal' | 'custom';
  date: string;
  paidBy: ExpensePayer;
  createdBy?: string | null;
  splits: ExpenseSplitAllocation[];
  createdAt?: string;
}

export interface ExpensesResponse {
  expenses: ExpenseItem[];
}

export interface ExpenseFilters {
  search?: string;
  category?: string;
  payer?: string;
  startDate?: string;
  endDate?: string;
}

export interface CustomSplitShareInput {
  user: string;
  share: number;
}

export interface CreateExpensePayload {
  groupId: string;
  description: string;
  amount: number;
  paidBy?: string;
  splitType?: 'equal' | 'custom';
  splits?: Array<string | { user: string; share?: number }>;
  category?: string;
  date?: string | Date;
}

export interface UpdateExpensePayload {
  description: string;
  amount: number;
  paidBy?: string;
  splitType?: 'equal' | 'custom';
  splits?: Array<string | { user: string; share?: number }>;
  category?: string;
  date?: string | Date;
}

export interface ExpenseDetailResponse {
  expense: ExpenseItem;
}

export interface DeleteExpenseResponse {
  message: string;
}

// ============================================================================
// BALANCES & LEDGER DOMAIN CONTRACTS
// ============================================================================

export interface BalanceEntry {
  userId: string;
  name: string;
  /**
   * Net balance in INR.
   * Positive = creditor (should receive money).
   * Negative = debtor (owes money).
   */
  net: number;
}

export interface GroupBalancesResponse {
  groupId: string;
  groupName: string;
  totalSpent: number;
  expenseCount: number;
  balances: BalanceEntry[];
  settlements: SettlementDebt[];
}

// ============================================================================
// PAYMENTS & DIRECT UPI DOMAIN CONTRACTS
// ============================================================================

export type PaymentMethod = 'razorpay' | 'upi_direct';

export type PaymentStatus =
  | 'pending'
  | 'payer_claimed'
  | 'recipient_confirmed'
  | 'recipient_rejected'
  | 'cancelled'
  | 'paid'
  | 'failed'
  | 'reversed';

export interface CreateUpiIntentPayload {
  groupId: string;
  toUserId: string;
  amount: number;
}

export interface UpiIntentResponse {
  intentId: string;
  upiUri: string;
  payeeName: string;
  payeeUpiId: string;
  amount: number;
  status: PaymentStatus;
}

export interface IntentActionPayload {
  intentId: string;
}

export interface IntentActionResponse {
  message: string;
  intentId: string;
  status: PaymentStatus;
  amount: number;
  notificationSent?: boolean;
}

export interface PaymentIntentItem {
  intentId: string;
  groupId: string;
  from: string | { _id: string; name: string };
  to: string | { _id: string; name: string };
  payerName: string;
  payeeName: string;
  amount: number;
  status: PaymentStatus;
  payeeUpiId?: string | null;
  upiUri: string | null;
  createdAt: string;
  claimedAt: string | null;
}

export interface ActiveIntentsResponse {
  intents: PaymentIntentItem[];
}

export interface IntentStatusResponse {
  intentId: string;
  status: PaymentStatus;
}

export interface ServerConfigResponse {
  razorpayEnabled: boolean;
}

export interface UpdateUpiIdPayload {
  upiId: string | null;
}

export interface UpdateUpiIdResponse {
  message: string;
  upiId: string | null;
}
