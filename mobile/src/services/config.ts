import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  HEALTH_CHECK_TIMEOUT_MS,
  normalizeApiBaseUrl,
  PRODUCTION_API_URL,
  resolveDefaultApiBaseUrl,
  validateApiBaseUrl,
} from '../utils/serverConfig';

export {
  HEALTH_CHECK_TIMEOUT_MS,
  normalizeApiBaseUrl,
  PRODUCTION_API_URL,
  resolveDefaultApiBaseUrl,
  validateApiBaseUrl,
};

const CUSTOM_API_URL_KEY = 'lendlocal_custom_api_url';

/**
 * Derives the default API URL based on runtime environment.
 * On physical devices running Expo Go, extracts the Metro host LAN IP
 * so the phone connects directly to the development machine.
 * In standalone production builds or when unresolvable, safely falls back
 * to the production backend URL (PRODUCTION_API_URL).
 */
export function getDefaultApiBaseUrl(): string {
  return resolveDefaultApiBaseUrl({
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    isDev: typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production',
    hostUri: Constants.expoConfig?.hostUri,
    platform: Platform.OS,
    isDevice: Device.isDevice,
  });
}

/**
 * Loads the active API base URL (custom override if set and valid, otherwise default).
 */
export async function getActiveApiBaseUrl(): Promise<string> {
  try {
    const custom = await SecureStore.getItemAsync(CUSTOM_API_URL_KEY);
    if (custom && custom.trim()) {
      const validation = validateApiBaseUrl(custom);
      if (validation.valid && validation.normalizedUrl) {
        return validation.normalizedUrl;
      }
    }
  } catch (err) {
    console.warn('Failed to load custom API URL from secure storage:', err);
  }
  return getDefaultApiBaseUrl();
}

/**
 * Saves a custom API base URL override after validation and normalization.
 */
export async function setCustomApiBaseUrl(url: string): Promise<string> {
  const validation = validateApiBaseUrl(url);
  if (!validation.valid || !validation.normalizedUrl) {
    throw new Error(validation.error || 'Invalid API URL');
  }
  await SecureStore.setItemAsync(CUSTOM_API_URL_KEY, validation.normalizedUrl);
  return validation.normalizedUrl;
}

/**
 * Clears the custom API base URL override and reverts to default.
 */
export async function resetApiBaseUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(CUSTOM_API_URL_KEY);
}
