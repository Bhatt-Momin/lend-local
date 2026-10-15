import { apiRequest } from './api';
import {
  ExpensesResponse,
  ExpenseDetailResponse,
  CreateExpensePayload,
  UpdateExpensePayload,
  DeleteExpenseResponse,
  ExpenseFilters,
} from '../types/api';

/**
 * Expenses API service for managing expenses and split allocations.
 * Centralizes all /api/expenses operations using the shared apiRequest client.
 */
export const expensesApi = {
  /**
   * Lists expenses for a group with optional filtering (search, category, payer, date range).
   * Caller must be an active member or historical participant.
   */
  list: async (groupId: string, filters?: ExpenseFilters): Promise<ExpensesResponse> => {
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
    const endpoint = queryString ? `/expenses/${groupId}?${queryString}` : `/expenses/${groupId}`;
    return apiRequest<ExpensesResponse>(endpoint);
  },

  /**
   * Adds a new expense to a group.
   *
   * Split Rules:
   * - Equal Split: participants array or defaults to all group members. The backend
   *   calculates integer paise division and allocates remainder paise deterministically.
   * - Custom Split: splits must be an array of { user: string, share: number }.
   *   The sum of shares converted to paise must strictly equal the total amount in paise.
   */
  create: async (payload: CreateExpensePayload): Promise<ExpenseDetailResponse> => {
    return apiRequest<ExpenseDetailResponse>('/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Updates an existing expense.
   * Permitted for the expense creator, original payer, or group creator.
   * Enforces the exact same paise arithmetic and membership rules as creation.
   */
  update: async (id: string, payload: UpdateExpensePayload): Promise<ExpenseDetailResponse> => {
    return apiRequest<ExpenseDetailResponse>(`/expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Deletes an expense.
   * Permitted for the expense creator, original payer, or group creator.
   */
  delete: async (id: string): Promise<DeleteExpenseResponse> => {
    return apiRequest<DeleteExpenseResponse>(`/expenses/${id}`, {
      method: 'DELETE',
    });
  },
};
