import { apiRequest } from './client';
import { GroupBalancesResponse } from '../types/api';

/**
 * Balances API service for fetching the authoritative group ledger.
 * Centralizes /api/balances operations using the shared apiRequest client.
 */
export const balancesApi = {
  /**
   * Retrieves the authoritative net balances and pairwise direct settlements for a group.
   *
   * FINANCIAL INTEGRITY RULE:
   * All balance and debt calculations are derived authoritatively by the backend ledger
   * using exact integer paise arithmetic. The mobile client displays these balances and settlements
   * directly and must never recalculate or adjust debts locally.
   *
   * Caller must be an active member or historical participant.
   * Departed members receive privacy-filtered views containing only debts involving themselves.
   */
  get: async (groupId: string): Promise<GroupBalancesResponse> => {
    return apiRequest<GroupBalancesResponse>(`/balances/${groupId}`);
  },
};
