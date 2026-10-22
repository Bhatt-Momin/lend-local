import { apiRequest } from './client';
import type {
  MarkAllNotificationsReadResponse,
  MarkNotificationReadResponse,
  NotificationsListResponse,
} from '../types/api';

export const notificationsApi = {
  /**
   * Fetch authenticated user's notification inbox.
   */
  list: async (
    options: { unreadOnly?: boolean; limit?: number } = {}
  ): Promise<NotificationsListResponse> => {
    const params = new URLSearchParams();
    if (options.unreadOnly) params.append('unreadOnly', 'true');
    if (options.limit) params.append('limit', String(options.limit));

    const query = params.toString();
    const endpoint = query ? `/notifications?${query}` : '/notifications';

    return apiRequest<NotificationsListResponse>(endpoint, {
      method: 'GET',
    });
  },

  /**
   * Mark a single notification as read.
   */
  markAsRead: async (id: string): Promise<MarkNotificationReadResponse> => {
    return apiRequest<MarkNotificationReadResponse>(`/notifications/${id}/read`, {
      method: 'PATCH',
    });
  },

  /**
   * Mark all unread notifications as read.
   */
  markAllAsRead: async (): Promise<MarkAllNotificationsReadResponse> => {
    return apiRequest<MarkAllNotificationsReadResponse>('/notifications/read-all', {
      method: 'PATCH',
    });
  },
};
