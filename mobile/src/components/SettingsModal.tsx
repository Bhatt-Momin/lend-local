import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from './themed-text';
import { Brand, Spacing, Surfaces } from '../constants/theme';

export interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  user: {
    name: string;
    email: string;
    upiId?: string | null;
  } | null;
  isRefreshingUser?: boolean;
  onRefreshUser?: () => void;
  onOpenUpiModal: (currentUpiId?: string | null) => void;
  onOpenServerModal: () => void;
  onLogout: () => void;
  isLoggingOut?: boolean;
}

export function SettingsModal({
  visible,
  onClose,
  user,
  isRefreshingUser = false,
  onRefreshUser,
  onOpenUpiModal,
  onOpenServerModal,
  onLogout,
  isLoggingOut = false,
}: SettingsModalProps) {
  if (!user) return null;

  const { upiDisplay, upiButtonLabel, upiStyle } = useMemo(() => {
    const upiId = user.upiId;
    if (upiId) {
      return {
        upiDisplay: upiId,
        upiButtonLabel: 'Edit',
        upiStyle: styles.upiActive,
      };
    }
    if (isRefreshingUser) {
      return {
        upiDisplay: 'Checking status...',
        upiButtonLabel: '...',
        upiStyle: styles.upiMuted,
      };
    }
    if (upiId === null) {
      return {
        upiDisplay: 'Not configured',
        upiButtonLabel: '+ Configure',
        upiStyle: styles.upiMuted,
      };
    }
    return {
      upiDisplay: 'Status unknown',
      upiButtonLabel: 'Retry',
      upiStyle: styles.upiMuted,
    };
  }, [user.upiId, isRefreshingUser]);

  const upiAccessibilityLabel = useMemo(() => {
    if (user.upiId) return `UPI ID: ${user.upiId}. Tap to edit.`;
    if (isRefreshingUser) return 'Checking UPI ID status.';
    if (user.upiId === null) return 'UPI ID not configured. Tap to configure.';
    return 'UPI ID status unknown. Tap to retry loading.';
  }, [user.upiId, isRefreshingUser]);

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
          accessibilityLabel="Close settings modal"
        />

        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.dialogHeader}>
            <ThemedText style={styles.dialogTitle}>Settings</ThemedText>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <ThemedText style={styles.closeBtnText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {/* User Profile Card */}
          <View style={styles.profileCard}>
            <View style={styles.avatarBadge}>
              <ThemedText style={styles.avatarText}>
                {user.name.charAt(0).toUpperCase()}
              </ThemedText>
            </View>
            <View style={styles.profileInfo}>
              <ThemedText style={styles.profileName} numberOfLines={1}>
                {user.name}
              </ThemedText>
              <ThemedText style={styles.profileEmail} numberOfLines={1}>
                {user.email}
              </ThemedText>
            </View>
          </View>

          {/* Settings Section: Payment & Receiving */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Payments</ThemedText>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <ThemedText style={styles.settingTitle}>Receiving UPI ID</ThemedText>
                <ThemedText
                  style={[styles.settingSub, upiStyle]}
                  numberOfLines={1}
                >
                  {upiDisplay}
                </ThemedText>
              </View>

              <TouchableOpacity
                onPress={() => {
                  if (isRefreshingUser) return;
                  if (user.upiId === undefined && onRefreshUser) {
                    onRefreshUser();
                  } else {
                    onOpenUpiModal(user.upiId);
                  }
                }}
                disabled={isRefreshingUser}
                style={styles.actionPillBtn}
                accessibilityRole="button"
                accessibilityLabel={upiAccessibilityLabel}
              >
                <ThemedText style={styles.actionPillText}>
                  {upiButtonLabel}
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Settings Section: Network / Server */}
          <View style={styles.section}>
            <ThemedText style={styles.sectionLabel}>Developer & Network</ThemedText>

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <ThemedText style={styles.settingTitle}>Server Connection</ThemedText>
                <ThemedText style={styles.settingSub} numberOfLines={1}>
                  API host & health status
                </ThemedText>
              </View>

              <TouchableOpacity
                onPress={onOpenServerModal}
                style={[styles.actionPillBtn, styles.actionPillBtnSecondary]}
                accessibilityRole="button"
                accessibilityLabel="Configure server connection"
              >
                <ThemedText style={styles.actionPillTextSecondary}>
                  Manage
                </ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Sign Out Action */}
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={onLogout}
            disabled={isLoggingOut}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Sign out of account"
          >
            {isLoggingOut ? (
              <ActivityIndicator size="small" color={Brand.negative} />
            ) : (
              <ThemedText style={styles.logoutBtnText}>Sign Out</ThemedText>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  dialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F0F4F8',
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: Spacing.one,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '700',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: 14,
    padding: Spacing.three,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  avatarBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#030507',
    fontSize: 18,
    fontWeight: '800',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  profileEmail: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  section: {
    gap: Spacing.one,
  },
  sectionLabel: {
    fontSize: 11,
    color: '#7A93A6',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
    marginBottom: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  settingInfo: {
    flex: 1,
    marginRight: Spacing.two,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
  },
  settingSub: {
    fontSize: 12,
    marginTop: 2,
  },
  upiActive: {
    color: Brand.primaryLight,
    fontWeight: '600',
  },
  upiMuted: {
    color: '#7A93A6',
    fontStyle: 'italic',
  },
  actionPillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Brand.primaryDim,
    borderWidth: 1,
    borderColor: Brand.primary,
  },
  actionPillText: {
    color: Brand.primaryLight,
    fontSize: 12,
    fontWeight: '700',
  },
  actionPillBtnSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: Surfaces.darkBorderBright,
  },
  actionPillTextSecondary: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Surfaces.darkBorder,
    marginVertical: Spacing.half,
  },
  logoutBtn: {
    paddingVertical: Spacing.two + 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: Brand.negativeDim,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  logoutBtnText: {
    color: Brand.negative,
    fontWeight: '700',
    fontSize: 14,
  },
});
