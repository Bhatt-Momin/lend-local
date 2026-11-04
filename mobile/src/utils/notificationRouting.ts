/**
 * notificationRouting.ts — Pure routing resolution helper for push notifications.
 *
 * Used by NotificationPushHandler.tsx and testable independently without JSX or React hooks.
 */

export interface NotificationPayloadData {
  groupId?: string | null;
  type?: string | null;
  [key: string]: any;
}

export interface NotificationResponseLike {
  notification?: {
    request?: {
      content?: {
        data?: NotificationPayloadData | null;
      };
    };
  };
}

/**
 * Resolves the navigation route for a notification response or payload data object.
 * Returns the target route string (e.g. `/group/${cleanGroupId}`) if valid, or null.
 */
export function getNotificationTargetRoute(
  responseOrData: NotificationResponseLike | NotificationPayloadData | null | undefined
): string | null {
  if (!responseOrData) return null;
  const data: NotificationPayloadData | null | undefined =
    'notification' in responseOrData && responseOrData.notification
      ? responseOrData.notification.request?.content?.data
      : (responseOrData as NotificationPayloadData);

  if (data && typeof data.groupId === 'string' && data.groupId.trim()) {
    return `/group/${data.groupId.trim()}`;
  }
  return null;
}
