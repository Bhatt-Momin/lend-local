import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { balancesApi, expensesApi, groupsApi, paymentApi } from '../services/api';
import type {
  AddMemberResponse,
  CreateExpensePayload,
  DeleteExpenseResponse,
  ExpenseDetailResponse,
  ExpenseItem,
  GroupBalancesResponse,
  GroupDetail,
  PaymentIntentItem,
  RenameGroupResponse,
  UpdateExpensePayload,
} from '../types/api';
import {
  MutationRefreshError,
  executeMutationWithGuardedRefresh,
} from '../utils/expenseForm';

export { MutationRefreshError, executeMutationWithGuardedRefresh };

export interface UseGroupDetailOptions {
  onUnauthorized?: () => void | Promise<void>;
}

export interface UseGroupDetailResult {
  group: GroupDetail | null;
  expenses: ExpenseItem[];
  balances: GroupBalancesResponse | null;
  activeIntents: PaymentIntentItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  isMutating: boolean;
  error: string | null;
  refreshError: string | null;
  myNetBalance: number;
  isCreator: boolean;
  isActiveMember: boolean;
  refresh: (throwOnError?: boolean) => Promise<void>;
  addMember: (email: string) => Promise<AddMemberResponse>;
  renameGroup: (name: string) => Promise<RenameGroupResponse>;
  leaveGroup: () => Promise<void>;
  deleteGroup: () => Promise<void>;
  createExpense: (payload: Omit<CreateExpensePayload, 'groupId'> & { groupId?: string }) => Promise<ExpenseDetailResponse>;
  updateExpense: (id: string, payload: UpdateExpensePayload) => Promise<ExpenseDetailResponse>;
  deleteExpense: (id: string) => Promise<DeleteExpenseResponse>;
}

/**
 * Coordinated data hook for the Group Detail screen.
 * Fetches group metadata, recent expenses, and authoritative ledger balances.
 *
 * Session & Request Safety:
 * - Generates unique request IDs to prevent stale async responses from overwriting current state.
 * - Handles HTTP 401 by clearing session and state atomically.
 * - Clears previous group/user state immediately when the group ID or authenticated user changes.
 */
export function useGroupDetail(
  groupId: string,
  enabled: boolean,
  options?: UseGroupDetailOptions
): UseGroupDetailResult {
  const { user, logout } = useAuth();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [balances, setBalances] = useState<GroupBalancesResponse | null>(null);
  const [activeIntents, setActiveIntents] = useState<PaymentIntentItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const prevGroupIdRef = useRef<string | null>(groupId);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const requestIdRef = useRef<number>(0);
  const isMutatingRef = useRef<boolean>(false);
  const hasLoadedRef = useRef<boolean>(false);
  const lastActiveIntentsRef = useRef<PaymentIntentItem[] | null>(null);
  const onUnauthorizedRef = useRef(options?.onUnauthorized);
  onUnauthorizedRef.current = options?.onUnauthorized;

  const handleUnauthorized = useCallback(async () => {
    isMutatingRef.current = false;
    hasLoadedRef.current = false;
    lastActiveIntentsRef.current = null;
    setGroup(null);
    setExpenses([]);
    setBalances(null);
    setActiveIntents([]);
    setError(null);
    setRefreshError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    setIsMutating(false);
    if (onUnauthorizedRef.current) {
      await onUnauthorizedRef.current();
    } else {
      await logout();
    }
  }, [logout]);

  const load = useCallback(
    async (isRefresh = false, throwOnError = false) => {
      if (!groupId) return;
      const currentRequestId = ++requestIdRef.current;

      if (isRefresh) {
        setIsRefreshing(true);
      } else if (!hasLoadedRef.current) {
        setIsLoading(true);
      }

      try {
        let activeIntentsFetchSucceeded = false;
        let fetchedActiveIntents: PaymentIntentItem[] = [];

        const activeIntentsPromise = paymentApi
          .getActiveIntents(groupId)
          .then((res) => {
            activeIntentsFetchSucceeded = true;
            fetchedActiveIntents = res?.intents ?? [];
            return res;
          })
          .catch((err: any) => {
            // Do not mask 401 unauthorized
            if (err?.status === 401) {
              throw err;
            }
            if (throwOnError) {
              throw err;
            }
            return null;
          });

        const [groupRes, expensesRes, balancesRes] = await Promise.all([
          groupsApi.getById(groupId),
          expensesApi.list(groupId),
          balancesApi.get(groupId),
          activeIntentsPromise,
        ]);

        if (currentRequestId !== requestIdRef.current) return;

        setGroup(groupRes.group);
        setExpenses(expensesRes.expenses ?? []);
        setBalances(balancesRes);

        if (activeIntentsFetchSucceeded) {
          lastActiveIntentsRef.current = fetchedActiveIntents;
          setActiveIntents(fetchedActiveIntents);
        } else if (lastActiveIntentsRef.current !== null) {
          // Preserve the last successfully fetched active intents
          setActiveIntents(lastActiveIntentsRef.current);
        } else {
          // On initial load, keep the existing empty initial state
          setActiveIntents([]);
        }

        setError(null);
        setRefreshError(null);
        hasLoadedRef.current = true;
      } catch (err: any) {
        if (currentRequestId !== requestIdRef.current) {
          if (throwOnError) throw err;
          return;
        }

        if (err?.status === 401) {
          await handleUnauthorized();
          if (throwOnError) throw err;
          return;
        }

        if (!hasLoadedRef.current) {
          setError(err?.message || 'Failed to load group details');
        } else {
          setRefreshError(err?.message || 'Failed to refresh group details');
        }

        if (throwOnError) throw err;
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [groupId, handleUnauthorized]
  );

  useEffect(() => {
    if (!enabled || !user || !groupId) {
      requestIdRef.current += 1;
      hasLoadedRef.current = false;
      lastActiveIntentsRef.current = null;
      setGroup(null);
      setExpenses([]);
      setBalances(null);
      setActiveIntents([]);
      setError(null);
      setRefreshError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      setIsMutating(false);
      isMutatingRef.current = false;
      prevGroupIdRef.current = null;
      prevUserIdRef.current = null;
      return;
    }

    if (prevGroupIdRef.current !== groupId || prevUserIdRef.current !== user.id) {
      requestIdRef.current += 1;
      hasLoadedRef.current = false;
      lastActiveIntentsRef.current = null;
      setGroup(null);
      setExpenses([]);
      setBalances(null);
      setActiveIntents([]);
      setError(null);
      setRefreshError(null);
      setIsMutating(false);
      isMutatingRef.current = false;
      prevGroupIdRef.current = groupId;
      prevUserIdRef.current = user.id;
    }

    load(false);
  }, [enabled, user, groupId, load]);

  const refresh = useCallback(
    (throwOnError: boolean = false) => load(true, typeof throwOnError === 'boolean' ? throwOnError : false),
    [load]
  );

  const addMember = useCallback(
    async (email: string): Promise<AddMemberResponse> => {
      return executeMutationWithGuardedRefresh(
        () => groupsApi.addMember(groupId, { email }),
        () => load(true, true),
        handleUnauthorized,
        setIsMutating,
        'Member added, but updating group details failed. Please pull to refresh.',
        isMutatingRef
      );
    },
    [groupId, handleUnauthorized, load]
  );

  const renameGroup = useCallback(
    async (name: string): Promise<RenameGroupResponse> => {
      return executeMutationWithGuardedRefresh(
        async () => {
          const res = await groupsApi.rename(groupId, { name });
          setGroup((prev) => (prev ? { ...prev, name: res.group.name, updatedAt: res.group.updatedAt } : null));
          return res;
        },
        () => load(true, true),
        handleUnauthorized,
        setIsMutating,
        'Group renamed, but updating group details failed. Please pull to refresh.',
        isMutatingRef
      );
    },
    [groupId, handleUnauthorized, load]
  );

  const leaveGroup = useCallback(async (): Promise<void> => {
    if (isMutatingRef.current) {
      const err: any = new Error('A mutation is already in progress');
      err.code = 'MUTATION_IN_PROGRESS';
      throw err;
    }
    isMutatingRef.current = true;
    setIsMutating(true);
    try {
      await groupsApi.leave(groupId);
    } catch (err: any) {
      if (err?.status === 401) {
        await handleUnauthorized();
      }
      throw err;
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
    }
  }, [groupId, handleUnauthorized]);

  const deleteGroup = useCallback(async (): Promise<void> => {
    if (isMutatingRef.current) {
      const err: any = new Error('A mutation is already in progress');
      err.code = 'MUTATION_IN_PROGRESS';
      throw err;
    }
    isMutatingRef.current = true;
    setIsMutating(true);
    try {
      await groupsApi.delete(groupId);
    } catch (err: any) {
      if (err?.status === 401) {
        await handleUnauthorized();
      }
      throw err;
    } finally {
      isMutatingRef.current = false;
      setIsMutating(false);
    }
  }, [groupId, handleUnauthorized]);

  const createExpense = useCallback(
    async (payload: Omit<CreateExpensePayload, 'groupId'> & { groupId?: string }): Promise<ExpenseDetailResponse> => {
      return executeMutationWithGuardedRefresh(
        () =>
          expensesApi.create({
            ...payload,
            groupId: payload.groupId || groupId,
          }),
        () => load(true, true),
        handleUnauthorized,
        setIsMutating,
        'Expense saved, but updating group ledger failed. Please pull to refresh.',
        isMutatingRef
      );
    },
    [groupId, handleUnauthorized, load]
  );

  const updateExpense = useCallback(
    async (id: string, payload: UpdateExpensePayload): Promise<ExpenseDetailResponse> => {
      return executeMutationWithGuardedRefresh(
        () => expensesApi.update(id, payload),
        () => load(true, true),
        handleUnauthorized,
        setIsMutating,
        'Expense updated, but updating group ledger failed. Please pull to refresh.',
        isMutatingRef
      );
    },
    [handleUnauthorized, load]
  );

  const deleteExpense = useCallback(
    async (id: string): Promise<DeleteExpenseResponse> => {
      return executeMutationWithGuardedRefresh(
        () => expensesApi.delete(id),
        () => load(true, true),
        handleUnauthorized,
        setIsMutating,
        'Expense deleted, but updating group ledger failed. Please pull to refresh.',
        isMutatingRef
      );
    },
    [handleUnauthorized, load]
  );

  const myNetBalance = useMemo(() => {
    if (!balances?.balances || !user?.id) return 0;
    const entry = balances.balances.find((b) => b.userId === user.id);
    return entry ? entry.net : 0;
  }, [balances, user?.id]);

  const isCreator = useMemo(() => {
    if (!group?.createdBy || !user?.id) return false;
    const creatorId = String(group.createdBy.id ?? group.createdBy._id ?? '');
    return creatorId.length > 0 && creatorId === String(user.id);
  }, [group?.createdBy, user?.id]);

  const isActiveMember = group?.isActiveMember ?? false;

  return {
    group,
    expenses,
    balances,
    activeIntents,
    isLoading,
    isRefreshing,
    isMutating,
    error,
    refreshError,
    myNetBalance,
    isCreator,
    isActiveMember,
    refresh,
    addMember,
    renameGroup,
    leaveGroup,
    deleteGroup,
    createExpense,
    updateExpense,
    deleteExpense,
  };
}
