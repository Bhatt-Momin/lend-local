import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Brand, Spacing, Surfaces } from '../constants/theme';
import { notificationsApi } from '../services/notificationsApi';
import type { NotificationItem } from '../types/api';

export interface NotificationInboxModalProps {
  visible: boolean;
  onClose: () => void;
  onUnreadCountChange?: (count: number) => void;
}

export function NotificationInboxModal({
  visible,
  onClose,
  onUnreadCountChange,
}: NotificationInboxModalProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isMarkingAll, setIsMarkingAll] = useState<boolean>(false);

  const fetchNotifications = useCallback(
    async (showLoadingSpinner = true) => {
      if (showLoadingSpinner) {
        setIsLoading(true);
      }
      setError(null);

      try {
        const res = await notificationsApi.list({ limit: 40 });
        setNotifications(res.notifications || []);
        const count = res.unreadCount || 0;
        setUnreadCount(count);
        onUnreadCountChange?.(count);
      } catch (err: any) {
        console.error('Failed to load notifications:', err?.message);
        setError(err?.message || 'Could not load notifications');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [onUnreadCountChange]
  );

  useEffect(() => {
    if (visible) {
      fetchNotifications(true);
    }
  }, [visible, fetchNotifications]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchNotifications(false);
  };

  const handleMarkAsRead = async (item: NotificationItem) => {
    if (!item.isRead) {
      // Optimistic update
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((prev) => {
        const next = Math.max(0, prev - 1);
        onUnreadCountChange?.(next);
        return next;
      });

      try {
        const res = await notificationsApi.markAsRead(item.id);
        if (typeof res.unreadCount === 'number') {
          setUnreadCount(res.unreadCount);
          onUnreadCountChange?.(res.unreadCount);
        }
      } catch (err) {
        console.warn('Failed to mark notification as read on server:', err);
      }
    }

    // Navigation handling
    if (item.data?.groupId) {
      onClose();
      setTimeout(() => {
        const groupId = item.data?.groupId!;
        const intentId = item.data?.intentId || item.data?.paymentId;
        if (item.type === 'payment_claim' && intentId) {
          router.push({
            pathname: '/group/[id]',
            params: { id: groupId, claimIntentId: intentId },
          });
        } else {
          router.push(`/group/${groupId}`);
        }
      }, 120);
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0 || isMarkingAll) return;
    setIsMarkingAll(true);

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
    );
    setUnreadCount(0);
    onUnreadCountChange?.(0);

    try {
      await notificationsApi.markAllAsRead();
    } catch (err: any) {
      console.warn('Failed to mark all as read:', err?.message);
      // Re-sync on error
      fetchNotifications(false);
    } finally {
      setIsMarkingAll(false);
    }
  };

  const formatRelativeTime = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 7) return `${diffDays}d ago`;

      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const getNotificationIcon = (type: string): string => {
    switch (type) {
      case 'expense_added':
        return '💸';
      case 'expense_updated':
        return '✏️';
      case 'payment_received':
        return '💰';
      case 'payment_claim':
        return '📬';
      case 'payment_confirmed':
        return '✅';
      case 'payment_rejected':
        return '❌';
      default:
        return '🔔';
    }
  };

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const isUnread = !item.isRead;
    const timeAgo = formatRelativeTime(item.createdAt);
    const icon = getNotificationIcon(item.type);

    return (
      <TouchableOpacity
        style={[styles.itemContainer, isUnread && styles.itemUnread]}
        onPress={() => handleMarkAsRead(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}. ${item.body}. ${timeAgo}.${isUnread ? ' Unread.' : ''} Tap to view.`}
      >
        <View style={styles.iconCircle}>
          <ThemedText style={styles.iconText}>{icon}</ThemedText>
        </View>

        <View style={styles.itemContent}>
          <View style={styles.itemHeaderRow}>
            <ThemedText style={[styles.itemTitle, isUnread && styles.itemTitleUnread]} numberOfLines={1}>
              {item.title}
            </ThemedText>
            <ThemedText style={styles.itemTime}>{timeAgo}</ThemedText>
          </View>

          <ThemedText style={styles.itemBody} numberOfLines={2}>
            {item.body}
          </ThemedText>
        </View>

        {isUnread ? <View style={styles.unreadDot} /> : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close notifications modal"
        />

        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.dialogHeader}>
            <View style={styles.headerLeft}>
              <ThemedText style={styles.dialogTitle}>Notifications</ThemedText>
              {unreadCount > 0 ? (
                <View style={styles.unreadCountBadge}>
                  <ThemedText style={styles.unreadCountText}>{unreadCount} new</ThemedText>
                </View>
              ) : null}
            </View>

            <View style={styles.headerRight}>
              {unreadCount > 0 ? (
                <TouchableOpacity
                  onPress={handleMarkAllRead}
                  disabled={isMarkingAll}
                  style={styles.markAllBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Mark all notifications as read"
                >
                  <ThemedText style={styles.markAllBtnText}>
                    {isMarkingAll ? '...' : 'Mark all read'}
                  </ThemedText>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close notifications"
              >
                <ThemedText style={styles.closeBtnText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Body Content */}
          {isLoading ? (
            <View style={styles.stateContainer}>
              <ActivityIndicator size="large" color={Brand.primary} />
              <ThemedText style={styles.stateText}>Loading notifications...</ThemedText>
            </View>
          ) : error ? (
            <View style={styles.stateContainer}>
              <ThemedText style={styles.errorIcon}>⚠️</ThemedText>
              <ThemedText style={styles.errorTitle}>Couldn&apos;t load notifications</ThemedText>
              <ThemedText style={styles.errorSub}>{error}</ThemedText>
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchNotifications(true)}>
                <ThemedText style={styles.retryBtnText}>Retry</ThemedText>
              </TouchableOpacity>
            </View>
          ) : notifications.length === 0 ? (
            <View style={styles.stateContainer}>
              <ThemedText style={styles.emptyIcon}>✨</ThemedText>
              <ThemedText style={styles.emptyTitle}>No notifications yet</ThemedText>
              <ThemedText style={styles.emptySub}>
                You&apos;ll see updates here when group expenses are added or payments are confirmed.
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={notifications}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor={Brand.primary}
                  colors={[Brand.primary]}
                />
              }
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(3, 5, 7, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.three,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  dialog: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '82%',
    backgroundColor: Surfaces.darkCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.45,
        shadowRadius: 16,
      },
      android: {
        elevation: 10,
      },
    }),
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Surfaces.darkBorder,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F0F4F8',
    letterSpacing: -0.2,
  },
  unreadCountBadge: {
    backgroundColor: Brand.primaryDim,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  unreadCountText: {
    color: Brand.primaryLight,
    fontSize: 11,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  markAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: Surfaces.darkCardMid,
  },
  markAllBtnText: {
    color: Brand.primaryLight,
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Surfaces.darkCardMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
  },
  listContent: {
    paddingVertical: Spacing.one,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    backgroundColor: 'transparent',
  },
  itemUnread: {
    backgroundColor: 'rgba(16, 185, 129, 0.04)',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Surfaces.darkCardMid,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    marginTop: 2,
  },
  iconText: {
    fontSize: 18,
  },
  itemContent: {
    flex: 1,
    gap: 3,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#CBD5E1',
    flex: 1,
  },
  itemTitleUnread: {
    fontWeight: '700',
    color: '#F0F4F8',
  },
  itemTime: {
    fontSize: 11,
    color: '#64748B',
  },
  itemBody: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Brand.primary,
    marginTop: 6,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Surfaces.darkBorder,
  },
  stateContainer: {
    padding: Spacing.six,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    minHeight: 220,
  },
  stateText: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: Spacing.one,
  },
  emptyIcon: {
    fontSize: 36,
    marginBottom: Spacing.half,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  emptySub: {
    fontSize: 13,
    color: '#7A93A6',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: Spacing.half,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  errorSub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: Spacing.two,
    backgroundColor: Brand.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#030507',
    fontSize: 13,
    fontWeight: '700',
  },
});
