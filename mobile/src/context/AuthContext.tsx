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

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  serverUrl: string;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateServerUrl: (url: string) => Promise<void>;
  resetToDefaultServerUrl: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [serverUrl, setServerUrl] = useState<string>('');

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
            if (cachedUser) setUser(cachedUser);
          }

          // 3. Verify token with backend
          try {
            const { user: freshUser } = await authApi.getMe(storedToken);
            if (isMounted) {
              setUser(freshUser);
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
    await saveUserData(res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = React.useCallback(async (name: string, email: string, password: string): Promise<void> => {
    const res = await authApi.register({ name, email, password });
    await saveAuthToken(res.token);
    await saveUserData(res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = React.useCallback(async (): Promise<void> => {
    await clearAllAuth();
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = React.useCallback(async (): Promise<void> => {
    const currentToken = await getAuthToken();
    if (!currentToken) return;
    try {
      const { user: freshUser } = await authApi.getMe(currentToken);
      setUser(freshUser);
      await saveUserData(freshUser);
    } catch (err: any) {
      if (err?.status === 401) {
        await clearAllAuth();
        setToken(null);
        setUser(null);
      }
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
      serverUrl,
      login,
      register,
      logout,
      refreshUser,
      updateServerUrl,
      resetToDefaultServerUrl,
    }),
    [
      user,
      token,
      isLoading,
      serverUrl,
      login,
      register,
      logout,
      refreshUser,
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
