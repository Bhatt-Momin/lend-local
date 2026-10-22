import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef } from 'react';
import type { NotificationResponse } from 'expo-notifications';

import { useAuth } from '../context/AuthContext';
import {
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  getLastNotificationResponseAsync,
  registerForPushNotificationsAsync,
} from '../services/pushNotifications';

interface PendingNotification {
  response: NotificationResponse;
  intendedRecipientId: string | null;
}

/**
 * Derives a stable, deterministic identifier for a notification response to ensure reliable
 * deduplication between cold-start initial lookup and native event-listener delivery without
 * dropping distinct notifications.
 */
function getResponseIdentifier(response: NotificationResponse | null | undefined): string | null {
  if (!response) return null;
  const reqId = response.notification?.request?.identifier;
  if (reqId && typeof reqId === 'string' && reqId.trim()) {
    return reqId.trim();
  }
  const data = response.notification?.request?.content?.data;
  const notifId = data?.notificationId;
  const groupId = data?.groupId;
  const notifDate = response.notification?.date;
  if (notifId || groupId) {
    return `composite_${notifId || ''}_${groupId || ''}_${notifDate || ''}`;
  }
  return null;
}

/**
 * Handles native push notification registration and user interaction listeners.
 * Mounted within AuthProvider so it responds to authenticated user lifecycle transitions.
 */
export function NotificationPushHandler(): null {
  const router = useRouter();
  const { token, user, isLoading } = useAuth();
  const registeredAuthTokenRef = useRef<string | null>(null);

  // Synchronously update authRef during render to eliminate post-render stale-ref races
  const authRef = useRef({ token, user, isLoading });
  authRef.current = { token, user, isLoading };

  // Keep a stable ref to router so navigation callbacks can execute safely
  const routerRef = useRef(router);
  routerRef.current = router;

  // Track the previous user ID to detect explicit logout and account switch transitions
  const currentUserId = user?.id ?? (user as any)?._id ?? null;
  const prevUserIdRef = useRef<string | null>(currentUserId);

  // Track pending cold-start notification response waiting for session restoration
  const pendingResponseRef = useRef<PendingNotification | null>(null);
  // Track last processed notification response identifier to prevent duplicate routing
  const lastProcessedResponseIdRef = useRef<string | null>(null);
  // Ensure cold-start notification lookup runs at most once across effect re-runs
  const hasCheckedColdStartRef = useRef<boolean>(false);

  // Synchronous account-transition detection during render:
  // Immediately purge pending notifications and deduplication caches upon logout or account switch
  if (prevUserIdRef.current !== null && currentUserId === null) {
    pendingResponseRef.current = null;
    lastProcessedResponseIdRef.current = null;
    prevUserIdRef.current = null;
  } else if (prevUserIdRef.current !== null && currentUserId !== null && prevUserIdRef.current !== currentUserId) {
    pendingResponseRef.current = null;
    lastProcessedResponseIdRef.current = null;
    prevUserIdRef.current = currentUserId;
  } else if (currentUserId !== null && prevUserIdRef.current === null) {
    prevUserIdRef.current = currentUserId;
  }

  // 1. Register for push notifications when an authenticated session is active
  useEffect(() => {
    if (!token || !user) {
      registeredAuthTokenRef.current = null;
      return;
    }

    // Prevent duplicate registrations for the same auth token in this session
    if (registeredAuthTokenRef.current === token) {
      return;
    }

    let isMounted = true;

    async function registerDevice() {
      try {
        const registered = await registerForPushNotificationsAsync(token!);
        if (isMounted && registered) {
          registeredAuthTokenRef.current = token;
        }
      } catch (err) {
        console.warn('[NotificationPushHandler] Registration error (non-fatal):', err);
      }
    }

    registerDevice();

    return () => {
      isMounted = false;
    };
  }, [token, user]);

  // Central routing execution for a tapped notification response.
  const handleNotificationResponse = useCallback(
    (response: NotificationResponse) => {
      const responseId = getResponseIdentifier(response);
      const { token: currentToken, user: currentUser, isLoading: currentLoading } = authRef.current;

      // Guard against duplicate event processing for the same notification response
      if (responseId && lastProcessedResponseIdRef.current === responseId) {
        console.log('[NotificationPushHandler] Duplicate notification response ignored:', responseId);
        return;
      }

      // If auth session is still restoring (cold start), queue for post-load processing
      if (currentLoading) {
        if (responseId && getResponseIdentifier(pendingResponseRef.current?.response) === responseId) {
          return;
        }
        console.log('[NotificationPushHandler] Auth session is restoring; queueing notification response');
        const data = response.notification?.request?.content?.data;
        const targetRecipientId = (data?.recipientId || data?.recipient || data?.userId || data?.targetUserId) as
          | string
          | undefined;
        pendingResponseRef.current = {
          response,
          intendedRecipientId:
            targetRecipientId && typeof targetRecipientId === 'string' ? targetRecipientId.trim() : null,
        };
        return;
      }

      // If user is unauthenticated or logged out, safely ignore and clear pending
      if (!currentToken || !currentUser) {
        console.log('[NotificationPushHandler] Ignored notification tap: user is logged out / unauthenticated');
        pendingResponseRef.current = null;
        return;
      }

      const data = response.notification?.request?.content?.data;
      console.log('[NotificationPushHandler] Notification response received with data keys:', Object.keys(data || {}));

      // Account switch defense: Check recipient targeting if present in payload
      const targetRecipientId = (data?.recipientId || data?.recipient || data?.userId || data?.targetUserId) as
        | string
        | undefined;
      const currentUserId = currentUser.id || (currentUser as any)._id;
      if (
        targetRecipientId &&
        typeof targetRecipientId === 'string' &&
        currentUserId &&
        targetRecipientId.trim() !== currentUserId
      ) {
        console.warn('[NotificationPushHandler] Notification recipient mismatch (intended for another user); ignoring tap');
        pendingResponseRef.current = null;
        return;
      }

      // Mark response as processed immediately before executing navigation
      if (responseId) {
        lastProcessedResponseIdRef.current = responseId;
      }

      // Navigate safely if notification payload contains a valid groupId
      if (data && typeof data.groupId === 'string' && data.groupId.trim()) {
        const cleanGroupId = data.groupId.trim();
        try {
          router.push(`/group/${cleanGroupId}`);
        } catch (navErr) {
          console.warn('[NotificationPushHandler] Navigation to group failed:', navErr);
        }
      } else {
        // Limitation: If payload lacks groupId or target destination, keep user safely in current screen
        console.log('[NotificationPushHandler] Notification payload lacks target groupId; remaining on current screen');
      }
    },
    [router]
  );

  // 2. Set up notification receipt and tap listeners with clean teardown
  useEffect(() => {
    // Listener for notifications received while app is in foreground
    const receivedSubscription = addNotificationReceivedListener((notification) => {
      // In-app inbox and notification delivery logging
      const title = notification.request.content.title;
      console.log('[NotificationPushHandler] Push notification received in foreground:', title || 'untitled');
    });

    // Listener for user response (tap) on a notification
    const responseSubscription = addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response);
    });

    return () => {
      receivedSubscription.remove();
      responseSubscription.remove();
      pendingResponseRef.current = null;
    };
  }, [handleNotificationResponse]);

  // 3. Cold start: Check initial notification response on startup (guarded against re-execution)
  useEffect(() => {
    if (hasCheckedColdStartRef.current) {
      return;
    }
    hasCheckedColdStartRef.current = true;

    let isMounted = true;

    async function checkInitialNotificationResponse() {
      try {
        const initialResponse = await getLastNotificationResponseAsync();
        if (isMounted && initialResponse) {
          handleNotificationResponse(initialResponse);
        }
      } catch (err) {
        console.warn('[NotificationPushHandler] Failed to retrieve initial notification response:', err);
      }
    }

    checkInitialNotificationResponse();

    return () => {
      isMounted = false;
    };
  }, [handleNotificationResponse]);

  // 4. Session lifecycle management:
  // - Handles explicit logout and account switch transitions (resets deduplication and pending queues)
  // - Resumes cold-start pending response once session is restored for the intended user
  useEffect(() => {
    const currentId = user?.id ?? (user as any)?._id ?? null;

    // Detect explicit logout: previously authenticated user is now null
    if (prevUserIdRef.current !== null && !currentId) {
      console.log('[NotificationPushHandler] User logged out; clearing pending notification and deduplication state');
      pendingResponseRef.current = null;
      lastProcessedResponseIdRef.current = null;
      prevUserIdRef.current = null;
      return;
    }

    // Detect account switch: authenticated user changed to a different user
    if (prevUserIdRef.current !== null && currentId !== null && prevUserIdRef.current !== currentId) {
      console.log('[NotificationPushHandler] Account switch detected; clearing pending notification and deduplication state');
      pendingResponseRef.current = null;
      lastProcessedResponseIdRef.current = null;
      prevUserIdRef.current = currentId;
    } else if (currentId !== null) {
      prevUserIdRef.current = currentId;
    }

    if (isLoading) {
      return;
    }

    // If logged out or unauthenticated, clear any pending notification tap
    if (!token || !user) {
      pendingResponseRef.current = null;
      return;
    }

    // If authenticated and a cold-start tap was queued, verify recipient and execute
    if (pendingResponseRef.current) {
      const { response: pending, intendedRecipientId } = pendingResponseRef.current;
      pendingResponseRef.current = null;

      const activeId = user.id || (user as any)._id;
      if (intendedRecipientId && activeId && intendedRecipientId !== activeId) {
        console.warn('[NotificationPushHandler] Pending notification was targeted at another recipient; discarding');
        return;
      }

      handleNotificationResponse(pending);
    }
  }, [isLoading, token, user, handleNotificationResponse]);

  return null;
}
