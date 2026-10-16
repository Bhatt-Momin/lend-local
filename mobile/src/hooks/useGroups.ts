import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { groupsApi } from '../services/api';
import type { GroupSummary } from '../types/api';

export interface UseGroupsOptions {
  onUnauthorized?: () => void | Promise<void>;
}

export interface UseGroupsResult {
  groups: GroupSummary[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetches the authenticated user's group list from GET /api/groups.
 * Displays authoritative `myBalance` / `settlements` as-is — no local ledger math.
 *
 * Session & Cache Safety:
 * - Automatically clears previous user's groups on sign out or when user identity changes.
 * - Handles HTTP 401 as an expired session by clearing credentials via logout.
 * - Keeps standard network and server errors visible with retry support.
 */
export function useGroups(
  enabled: boolean,
  options?: UseGroupsOptions
): UseGroupsResult {
  const { user, logout } = useAuth();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const onUnauthorizedRef = useRef(options?.onUnauthorized);
  onUnauthorizedRef.current = options?.onUnauthorized;
  const requestIdRef = useRef<number>(0);

  const handleUnauthorized = useCallback(async () => {
    setGroups([]);
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
      const currentRequestId = ++requestIdRef.current;
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      try {
        const res = await groupsApi.list();
        if (currentRequestId !== requestIdRef.current) return;
        setGroups(res.groups ?? []);
      } catch (err: any) {
        if (currentRequestId !== requestIdRef.current) return;
        if (err?.status === 401) {
          await handleUnauthorized();
          return;
        }
        setError(err?.message || 'Failed to load groups');
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [handleUnauthorized]
  );

  useEffect(() => {
    if (!enabled || !user) {
      // Invalidate any in-flight requests and clear state immediately
      requestIdRef.current += 1;
      setGroups([]);
      setError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      prevUserIdRef.current = null;
      return;
    }

    // Clear stale data immediately if switching user accounts
    if (prevUserIdRef.current !== user.id) {
      requestIdRef.current += 1;
      setGroups([]);
      setError(null);
      prevUserIdRef.current = user.id;
    }

    load(false);
  }, [enabled, user, load]);

  const refresh = useCallback(() => load(true), [load]);

  return { groups, isLoading, isRefreshing, error, refresh };
}
