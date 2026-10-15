import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const CUSTOM_API_URL_KEY = 'lendlocal_custom_api_url';

/**
 * Derives the default API URL based on runtime environment.
 * On physical devices running Expo Go, extracts the Metro host LAN IP
 * so the phone connects directly to the development machine.
 */
export function getDefaultApiBaseUrl(): string {
  // 1. Explicit environment variable
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  }

  // 2. Physical device running Expo Go — detect dev machine host IP
  if (Device.isDevice && Constants.expoConfig?.hostUri) {
    const host = Constants.expoConfig.hostUri.split(':')[0];
    if (host) {
      return `http://${host}:3000/api`;
    }
  }

  // 3. Android Emulator
  if (Platform.OS === 'android' && !Device.isDevice) {
    return 'http://10.0.2.2:3000/api';
  }

  // 4. iOS Simulator & Web
  return 'http://localhost:3000/api';
}

/**
 * Loads the active API base URL (custom override if set, otherwise default).
 */
export async function getActiveApiBaseUrl(): Promise<string> {
  try {
    const custom = await SecureStore.getItemAsync(CUSTOM_API_URL_KEY);
    if (custom && custom.trim()) {
      return custom.trim().replace(/\/+$/, '');
    }
  } catch (err) {
    console.warn('Failed to load custom API URL from secure storage:', err);
  }
  return getDefaultApiBaseUrl();
}

/**
 * Saves a custom API base URL override.
 */
export async function setCustomApiBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  await SecureStore.setItemAsync(CUSTOM_API_URL_KEY, trimmed);
}

/**
 * Clears the custom API base URL override and reverts to default.
 */
export async function resetApiBaseUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(CUSTOM_API_URL_KEY);
}
