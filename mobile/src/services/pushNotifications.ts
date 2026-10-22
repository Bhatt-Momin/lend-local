import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { authApi } from './api';
import {
  getRegisteredPushToken,
  saveRegisteredPushToken,
} from './secureStore';

// Configure foreground notification behavior once at module load
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let isRegistering = false;
let lastRegisteredToken: string | null = null;
let lastRegisteredAuthToken: string | null = null;

/**
 * Configure default notification channel required for Android 8.0+ (API 26+)
 */
export async function configureDefaultNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00D09C',
      sound: 'default',
    });
  } catch (err: any) {
    console.warn('[PushNotifications] Failed to create default notification channel:', err?.message || err);
  }
}

/**
 * Registers native Android FCM push token with backend for authenticated user.
 * Strictly uses getDevicePushTokenAsync() to obtain the native Google FCM token.
 */
export async function registerForPushNotificationsAsync(authToken: string): Promise<string | null> {
  if (!authToken) {
    return null;
  }

  // Native push is supported on physical Android devices
  if (Platform.OS !== 'android') {
    return null;
  }

  if (!Device.isDevice) {
    console.log('[PushNotifications] Push registration skipped (simulator or non-physical device)');
    return null;
  }

  if (isRegistering) {
    return null;
  }

  isRegistering = true;
  try {
    // 1. Create default Android notification channel
    await configureDefaultNotificationChannel();

    // 2. Check and request notification permissions (required for Android 13+ / API 33+)
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[PushNotifications] Push notification permission not granted');
      return null;
    }

    // 3. Obtain native device push token (FCM token on Android)
    const deviceTokenResult = await Notifications.getDevicePushTokenAsync();
    const token = deviceTokenResult?.data;

    if (!token || typeof token !== 'string') {
      console.warn('[PushNotifications] Invalid or missing native device token received');
      return null;
    }

    // 4. Guard against duplicate registration for the same session
    const storedToken = await getRegisteredPushToken();
    if (token === lastRegisteredToken && authToken === lastRegisteredAuthToken && storedToken === token) {
      return token;
    }

    // 5. Register with backend as platform: "android"
    await authApi.saveFcmToken(token, 'android', authToken);
    await saveRegisteredPushToken(token);

    lastRegisteredToken = token;
    lastRegisteredAuthToken = authToken;
    console.log('[PushNotifications] Native Android push token registered successfully');
    return token;
  } catch (err: any) {
    // Gracefully handle missing Google Play Services, network failure, etc. without logging secrets
    console.warn('[PushNotifications] Native push registration error (non-fatal):', err?.message || 'Unknown error');
    return null;
  } finally {
    isRegistering = false;
  }
}

/**
 * Reset in-memory registration tracker on logout
 */
export function resetPushRegistrationState(): void {
  lastRegisteredToken = null;
  lastRegisteredAuthToken = null;
  isRegistering = false;
}

/**
 * Add listener for notifications received while app is foregrounded
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Add listener for user interactions (taps) on notifications
 */
export function addNotificationResponseReceivedListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Retrieve initial notification response that opened the app (cold start)
 */
export async function getLastNotificationResponseAsync(): Promise<Notifications.NotificationResponse | null> {
  try {
    return await Notifications.getLastNotificationResponseAsync();
  } catch (err: any) {
    console.warn('[PushNotifications] Failed to get last notification response:', err?.message || err);
    return null;
  }
}
