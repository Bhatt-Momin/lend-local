import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { balancesApi, expensesApi, groupsApi } from '../services/api';
import type {
  AddMemberResponse,
  ExpenseItem,
  GroupBalancesResponse,
  GroupDetail,
  RenameGroupResponse,
} from '../types/api';

export interface UseGroupDetailOptions {
  onUnauthorized?: () => void | Promise<void>;
}

export interface UseGroupDetailResult {
  group: GroupDetail | null;
  expenses: ExpenseItem[];
  balances: GroupBalancesResponse | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  myNetBalance: number;
  isCreator: boolean;
  isActiveMember: boolean;
  refresh: () => Promise<void>;
  addMember: (email: string) => Promise<AddMemberResponse>;
  renameGroup: (name: string) => Promise<RenameGroupResponse>;
  leaveGroup: () => Promise<void>;
  deleteGroup: () => Promise<void>;
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
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const prevGroupIdRef = useRef<string | null>(groupId);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const requestIdRef = useRef<number>(0);
  const onUnauthorizedRef = useRef(options?.onUnauthorized);
  onUnauthorizedRef.current = options?.onUnauthorized;

  const handleUnauthorized = useCallback(async () => {
    setGroup(null);
    setExpenses([]);
    setBalances(null);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (onUnauthorizedRef.current) {
      await onUnauthorizedRef.current();
    } else {
      await logout();
    }
  }, [logout]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!groupId) return;
      const currentRequestId = ++requestIdRef.current;

      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const [groupRes, expensesRes, balancesRes] = await Promise.all([
          groupsApi.getById(groupId),
          expensesApi.list(groupId),
          balancesApi.get(groupId),
        ]);

        if (currentRequestId !== requestIdRef.current) return;

        setGroup(groupRes.group);
        setExpenses(expensesRes.expenses ?? []);
        setBalances(balancesRes);
      } catch (err: any) {
        if (currentRequestId !== requestIdRef.current) return;

        if (err?.status === 401) {
          await handleUnauthorized();
          return;
        }

        setError(err?.message || 'Failed to load group details');
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
      setGroup(null);
      setExpenses([]);
      setBalances(null);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      prevGroupIdRef.current = null;
      prevUserIdRef.current = null;
      return;
    }

    if (prevGroupIdRef.current !== groupId || prevUserIdRef.current !== user.id) {
      requestIdRef.current += 1;
      setGroup(null);
      setExpenses([]);
      setBalances(null);
      setError(null);
      prevGroupIdRef.current = groupId;
      prevUserIdRef.current = user.id;
    }

    load(false);
  }, [enabled, user, groupId, load]);

  const refresh = useCallback(() => load(true), [load]);

  const addMember = useCallback(
    async (email: string): Promise<AddMemberResponse> => {
      const res = await groupsApi.addMember(groupId, { email });
      // Refresh to ensure updated memberCount, members list, and ledger
      await load(true);
      return res;
    },
    [groupId, load]
  );

  const renameGroup = useCallback(
    async (name: string): Promise<RenameGroupResponse> => {
      const res = await groupsApi.rename(groupId, { name });
      // Update local state with confirmed name from server
      setGroup((prev) => (prev ? { ...prev, name: res.group.name, updatedAt: res.group.updatedAt } : null));
      await load(true);
      return res;
    },
    [groupId, load]
  );

  const leaveGroup = useCallback(async (): Promise<void> => {
    await groupsApi.leave(groupId);
  }, [groupId]);

  const deleteGroup = useCallback(async (): Promise<void> => {
    await groupsApi.delete(groupId);
  }, [groupId]);

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
    isLoading,
    isRefreshing,
    error,
    myNetBalance,
    isCreator,
    isActiveMember,
    refresh,
    addMember,
    renameGroup,
    leaveGroup,
    deleteGroup,
  };
}
