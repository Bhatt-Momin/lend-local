import * as SplashScreen from 'expo-splash-screen';
import React, { createContext, useContext, useEffect, useState } from 'react';

import { authApi } from '../services/api';
import { getActiveApiBaseUrl, resetApiBaseUrl, setCustomApiBaseUrl } from '../services/config';
import {
  clearAllAuth,
  deleteAuthToken,
  deleteUserData,
  getAuthToken,
  getUserData,
  saveAuthToken,
  saveUserData,
  UserProfile,
} from '../services/secureStore';
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
  const refreshingUserPromiseRef = React.useRef<Promise<void> | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      try {
        // 1. Load active server URL
        const activeUrl = await getActiveApiBaseUrl();
        if (isMounted) setServerUrl(activeUrl);

        // 2. Check for stored token and cached user
        const storedToken = await getAuthToken();
        const cachedUser = await getUserData();

        if (storedToken) {
          if (isMounted) {
            setToken(storedToken);
            if (cachedUser) {
              setUser(cachedUser);
              userRef.current = cachedUser;
            }
          }

          // 3. Verify token with backend
          try {
            const { user: freshUser } = await authApi.getMe(storedToken);
            if (isMounted && freshUser) {
              setUser(freshUser);
              userRef.current = freshUser;
              await saveUserData(freshUser);
            }
          } catch (err: any) {
            if (err?.status === 401) {
              // Token expired or invalid
              console.log('Session expired, clearing credentials');
              await clearAllAuth();
              if (isMounted) {
                setToken(null);
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
  }, []);

  const login = React.useCallback(async (email: string, password: string): Promise<void> => {
    const res = await authApi.login({ email, password });
    await saveAuthToken(res.token);
    setToken(res.token);

    // Hydrate authoritative user profile via GET /api/auth/me
    let profile: UserProfile = res.user;
    try {
      const { user: freshUser } = await authApi.getMe(res.token);
      if (freshUser) {
        profile = freshUser;
      }
    } catch (hydrateErr: any) {
      console.warn('Post-login profile hydration from /auth/me failed, using login payload:', hydrateErr?.message);
    }

    await saveUserData(profile);
    setUser(profile);
    userRef.current = profile;
  }, []);

  const register = React.useCallback(async (name: string, email: string, password: string): Promise<void> => {
    const res = await authApi.register({ name, email, password });
    await saveAuthToken(res.token);
    setToken(res.token);

    let profile: UserProfile = res.user;
    try {
      const { user: freshUser } = await authApi.getMe(res.token);
      if (freshUser) {
        profile = freshUser;
      }
    } catch (hydrateErr: any) {
      console.warn('Post-registration profile hydration from /auth/me failed, using register payload:', hydrateErr?.message);
    }

    await saveUserData(profile);
    setUser(profile);
    userRef.current = profile;
  }, []);

  const logout = React.useCallback(async (): Promise<void> => {
    await clearAllAuth();
    setToken(null);
    setUser(null);
    userRef.current = null;
  }, []);

  const refreshUser = React.useCallback((): Promise<void> => {
    if (refreshingUserPromiseRef.current) {
      return refreshingUserPromiseRef.current;
    }

    const promise = (async () => {
      try {
        const currentToken = await getAuthToken();
        if (!currentToken) return;

        setIsRefreshingUser(true);
        const { user: freshUser } = await authApi.getMe(currentToken);
        if (freshUser) {
          setUser(freshUser);
          userRef.current = freshUser;
          await saveUserData(freshUser);
        }
      } catch (err: any) {
        if (err?.status === 401) {
          await clearAllAuth();
          setToken(null);
          setUser(null);
          userRef.current = null;
        } else {
          console.warn('Failed to refresh user profile:', err?.message);
        }
      } finally {
        setIsRefreshingUser(false);
        refreshingUserPromiseRef.current = null;
      }
    })();

    refreshingUserPromiseRef.current = promise;
    return promise;
  }, []);

  const updateUpiId = React.useCallback(async (upiId: string | null): Promise<UpdateUpiIdResponse> => {
    try {
      const res = await authApi.updateUpiId({ upiId });

      let updatedProfile: UserProfile | null = userRef.current
        ? { ...userRef.current, upiId: res.upiId }
        : null;

      setUser((prev) => {
        if (!prev) return null;
        const next = { ...prev, upiId: res.upiId };
        if (!updatedProfile) updatedProfile = next;
        return next;
      });

      if (updatedProfile) {
        userRef.current = updatedProfile;
        try {
          await saveUserData(updatedProfile);
        } catch (storageErr) {
          console.warn('Failed to persist updated UPI profile to SecureStore:', storageErr);
        }
      }

      return res;
    } catch (err: any) {
      if (err?.status === 401) {
        await clearAllAuth();
        setToken(null);
        setUser(null);
        userRef.current = null;
      }
      throw err;
    }
  }, []);

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
