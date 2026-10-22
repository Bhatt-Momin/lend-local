import * as SplashScreen from 'expo-splash-screen';
import React, { createContext, useContext, useEffect, useState } from 'react';

import { authApi } from '../services/api';
import { getActiveApiBaseUrl, resetApiBaseUrl, setCustomApiBaseUrl } from '../services/config';
import {
  clearAllAuth,
  deleteAuthToken,
  deleteUserData,
  getAuthToken,
  getRegisteredPushToken,
  getUserData,
  saveAuthToken,
  saveUserData,
  UserProfile,
} from '../services/secureStore';
import { resetPushRegistrationState } from '../services/pushNotifications';
import type { UpdateUpiIdResponse } from '../types/api';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  isRefreshingUser: boolean;
  serverUrl: string;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUpiId: (upiId: string | null) => Promise<UpdateUpiIdResponse>;
  updateServerUrl: (url: string) => Promise<void>;
  resetToDefaultServerUrl: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshingUser, setIsRefreshingUser] = useState<boolean>(false);
  const [serverUrl, setServerUrl] = useState<string>('');

  const userRef = React.useRef<UserProfile | null>(null);
  const tokenRef = React.useRef<string | null>(null);
  const refreshingUserPromiseRef = React.useRef<Promise<void> | null>(null);
  const refreshingUserEpochRef = React.useRef<number>(0);
  const sessionEpochRef = React.useRef<number>(1);
  const storageQueueRef = React.useRef<Promise<any>>(Promise.resolve());

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  /**
   * Monotonically advances the session generation.
   * Authoritatively invalidates previous session operations (refresh, background hydration,
   * storage writes, and stale 401 callbacks).
   */
  const advanceSessionEpoch = React.useCallback((): number => {
    sessionEpochRef.current += 1;
    refreshingUserPromiseRef.current = null;
    setIsRefreshingUser(false);
    return sessionEpochRef.current;
  }, []);

  /**
   * Serializes credential storage mutations (saveAuthToken, saveUserData, clearAllAuth)
   * to guarantee that destructive deletions or writes from a prior session never interleave
   * or overwrite credentials from a newer session in SecureStore.
   */
  const executeStorageMutation = React.useCallback(
    <T,>(opEpoch: number, mutation: () => Promise<T>): Promise<T | null> => {
      if (sessionEpochRef.current !== opEpoch) {
        return Promise.resolve(null);
      }

      const nextPromise = storageQueueRef.current
        .catch(() => {})
        .then(async () => {
          if (sessionEpochRef.current !== opEpoch) {
            return null;
          }
          return await mutation();
        });

      storageQueueRef.current = nextPromise.catch(() => {});
      return nextPromise;
    },
    []
  );

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      const initEpoch = sessionEpochRef.current;
      try {
        // 1. Load active server URL
        const activeUrl = await getActiveApiBaseUrl();
        if (!isMounted || sessionEpochRef.current !== initEpoch) return;
        setServerUrl(activeUrl);

        // 2. Check for stored token and cached user
        const storedToken = await getAuthToken();
        const cachedUser = await getUserData();

        if (!isMounted || sessionEpochRef.current !== initEpoch) return;

        if (storedToken) {
          setToken(storedToken);
          tokenRef.current = storedToken;
          if (cachedUser) {
            setUser(cachedUser);
            userRef.current = cachedUser;
          }

          // 3. Verify token with backend
          try {
            const { user: freshUser } = await authApi.getMe(storedToken);
            if (!isMounted || sessionEpochRef.current !== initEpoch) return;
            if (freshUser) {
              setUser(freshUser);
              userRef.current = freshUser;
              await executeStorageMutation(initEpoch, () => saveUserData(freshUser));
            }
          } catch (err: any) {
            if (!isMounted || sessionEpochRef.current !== initEpoch) return;
            if (err?.status === 401) {
              // Token expired or invalid for this initial session
              console.log('Session expired, clearing credentials');
              const clearEpoch = advanceSessionEpoch();
              await executeStorageMutation(clearEpoch, () => clearAllAuth());
              if (isMounted && sessionEpochRef.current === clearEpoch) {
                setToken(null);
                tokenRef.current = null;
                setUser(null);
                userRef.current = null;
              }
            } else {
              console.warn('Backend verification network issue, using cached profile:', err?.message);
            }
          }
        }
      } catch (err) {
        console.error('Failed to restore authentication session:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
          try {
            await SplashScreen.hideAsync();
          } catch {
            // Ignore splash hide errors if already hidden
          }
        }
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, [advanceSessionEpoch, executeStorageMutation]);

  const login = React.useCallback(async (email: string, password: string): Promise<void> => {
    const opEpoch = advanceSessionEpoch();

    const res = await authApi.login({ email, password });
    if (sessionEpochRef.current !== opEpoch) return;

    await executeStorageMutation(opEpoch, () => saveAuthToken(res.token));
    if (sessionEpochRef.current !== opEpoch) return;

    setToken(res.token);
    tokenRef.current = res.token;

    // Hydrate authoritative user profile via GET /api/auth/me
    let profile: UserProfile = res.user;
    try {
      const { user: freshUser } = await authApi.getMe(res.token);
      if (freshUser && sessionEpochRef.current === opEpoch) {
        profile = freshUser;
      }
    } catch (hydrateErr: any) {
      console.warn('Post-login profile hydration from /auth/me failed, using login payload:', hydrateErr?.message);
    }

    if (sessionEpochRef.current !== opEpoch) return;

    await executeStorageMutation(opEpoch, () => saveUserData(profile));
    if (sessionEpochRef.current !== opEpoch) return;

    setUser(profile);
    userRef.current = profile;
  }, [advanceSessionEpoch, executeStorageMutation]);

  const register = React.useCallback(async (name: string, email: string, password: string): Promise<void> => {
    const opEpoch = advanceSessionEpoch();

    const res = await authApi.register({ name, email, password });
    if (sessionEpochRef.current !== opEpoch) return;

    await executeStorageMutation(opEpoch, () => saveAuthToken(res.token));
    if (sessionEpochRef.current !== opEpoch) return;

    setToken(res.token);
    tokenRef.current = res.token;

    let profile: UserProfile = res.user;
    try {
      const { user: freshUser } = await authApi.getMe(res.token);
      if (freshUser && sessionEpochRef.current === opEpoch) {
        profile = freshUser;
      }
    } catch (hydrateErr: any) {
      console.warn('Post-registration profile hydration from /auth/me failed, using register payload:', hydrateErr?.message);
    }

    if (sessionEpochRef.current !== opEpoch) return;

    await executeStorageMutation(opEpoch, () => saveUserData(profile));
    if (sessionEpochRef.current !== opEpoch) return;

    setUser(profile);
    userRef.current = profile;
  }, [advanceSessionEpoch, executeStorageMutation]);

  const logout = React.useCallback(async (): Promise<void> => {
    const logoutEpoch = advanceSessionEpoch();

    try {
      const storedPushToken = await getRegisteredPushToken();
      const currentToken = tokenRef.current || token || (await getAuthToken());
      if (storedPushToken && currentToken) {
        try {
          await authApi.removeFcmToken(storedPushToken, currentToken);
        } catch (revokeErr) {
          console.warn('Failed to revoke FCM token on logout (non-fatal):', revokeErr);
        }
      }
    } catch (e) {
      console.warn('Error retrieving push token for logout (non-fatal):', e);
    } finally {
      // Two-stage epoch validation:
      // 1. Guard storage wipe: ensure a newer session did not start during async FCM revocation.
      if (sessionEpochRef.current === logoutEpoch) {
        resetPushRegistrationState();
        await executeStorageMutation(logoutEpoch, () => clearAllAuth());
        // 2. Guard state wipe: ensure a newer login did not race during async clearAllAuth().
        if (sessionEpochRef.current === logoutEpoch) {
          setToken(null);
          tokenRef.current = null;
          setUser(null);
          userRef.current = null;
        }
      }
    }
  }, [token, advanceSessionEpoch, executeStorageMutation]);

  const refreshUser = React.useCallback((): Promise<void> => {
    const currentEpoch = sessionEpochRef.current;
    if (
      refreshingUserPromiseRef.current &&
      refreshingUserEpochRef.current === currentEpoch
    ) {
      return refreshingUserPromiseRef.current;
    }

    const promise = (async () => {
      const callEpoch = sessionEpochRef.current;
      try {
        const currentToken = tokenRef.current || (await getAuthToken());
        if (sessionEpochRef.current !== callEpoch || !currentToken) return;

        setIsRefreshingUser(true);
        const { user: freshUser } = await authApi.getMe(currentToken);

        if (sessionEpochRef.current !== callEpoch) return;

        if (freshUser) {
          if (sessionEpochRef.current === callEpoch) {
            setUser(freshUser);
            userRef.current = freshUser;
            await executeStorageMutation(callEpoch, () => saveUserData(freshUser));
          }
        }
      } catch (err: any) {
        if (sessionEpochRef.current !== callEpoch) return;

        if (err?.status === 401) {
          const clearEpoch = advanceSessionEpoch();
          await executeStorageMutation(clearEpoch, () => clearAllAuth());
          if (sessionEpochRef.current === clearEpoch) {
            setToken(null);
            tokenRef.current = null;
            setUser(null);
            userRef.current = null;
          }
        } else {
          console.warn('Failed to refresh user profile:', err?.message);
        }
      } finally {
        if (sessionEpochRef.current === callEpoch) {
          setIsRefreshingUser(false);
          refreshingUserPromiseRef.current = null;
        }
      }
    })();

    refreshingUserEpochRef.current = currentEpoch;
    refreshingUserPromiseRef.current = promise;
    return promise;
  }, [advanceSessionEpoch, executeStorageMutation]);

  const updateUpiId = React.useCallback(async (upiId: string | null): Promise<UpdateUpiIdResponse> => {
    const callEpoch = sessionEpochRef.current;
    try {
      const res = await authApi.updateUpiId({ upiId });

      if (sessionEpochRef.current !== callEpoch) {
        return res;
      }

      let updatedProfile: UserProfile | null = userRef.current
        ? { ...userRef.current, upiId: res.upiId }
        : null;

      setUser((prev) => {
        if (!prev || sessionEpochRef.current !== callEpoch) return null;
        const next = { ...prev, upiId: res.upiId };
        if (!updatedProfile) updatedProfile = next;
        return next;
      });

      if (updatedProfile && sessionEpochRef.current === callEpoch) {
        userRef.current = updatedProfile;
        try {
          await executeStorageMutation(callEpoch, () => saveUserData(updatedProfile!));
        } catch (storageErr) {
          console.warn('Failed to persist updated UPI profile to SecureStore:', storageErr);
        }
      }

      return res;
    } catch (err: any) {
      if (err?.status === 401 && sessionEpochRef.current === callEpoch) {
        const clearEpoch = advanceSessionEpoch();
        await executeStorageMutation(clearEpoch, () => clearAllAuth());
        if (sessionEpochRef.current === clearEpoch) {
          setToken(null);
          tokenRef.current = null;
          setUser(null);
          userRef.current = null;
        }
      }
      throw err;
    }
  }, [advanceSessionEpoch, executeStorageMutation]);

  const updateServerUrl = React.useCallback(async (url: string): Promise<void> => {
    await setCustomApiBaseUrl(url);
    const active = await getActiveApiBaseUrl();
    setServerUrl(active);
  }, []);

  const resetToDefaultServerUrl = React.useCallback(async (): Promise<void> => {
    await resetApiBaseUrl();
    const active = await getActiveApiBaseUrl();
    setServerUrl(active);
  }, []);

  const contextValue = React.useMemo<AuthContextType>(
    () => ({
      user,
      token,
      isLoading,
      isRefreshingUser,
      serverUrl,
      login,
      register,
      logout,
      refreshUser,
      updateUpiId,
      updateServerUrl,
      resetToDefaultServerUrl,
    }),
    [
      user,
      token,
      isLoading,
      isRefreshingUser,
      serverUrl,
      login,
      register,
      logout,
      refreshUser,
      updateUpiId,
      updateServerUrl,
      resetToDefaultServerUrl,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
