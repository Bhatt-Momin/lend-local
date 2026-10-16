import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { MaxContentWidth, Spacing } from '../constants/theme';
import type { ExpenseItem, GroupDetail } from '../types/api';
import { canDeleteExpense, canEditExpense, hasDepartedSplitParticipants } from '../utils/expenseForm';
import { formatINR } from '../utils/format';

export interface ExpenseDetailModalProps {
  visible: boolean;
  onClose: () => void;
  expense: ExpenseItem | null;
  group: GroupDetail | null;
  currentUserId?: string | null;
  onEditPress: (expense: ExpenseItem) => void;
  onDeleteExpense: (expenseId: string) => Promise<any>;
  isMutating?: boolean;
}

export function ExpenseDetailModal({
  visible,
  onClose,
  expense,
  group,
  currentUserId,
  onEditPress,
  onDeleteExpense,
  isMutating = false,
}: ExpenseDetailModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  // Group creator ID normalization
  const groupCreatorId = useMemo(() => {
    if (!group?.createdBy) return null;
    return (
      group.createdBy.id ??
      group.createdBy._id ??
      (typeof group.createdBy === 'string' ? group.createdBy : null)
    );
  }, [group?.createdBy]);

  // Authorization checks
  const canEdit = useMemo(() => {
    if (!expense || !group) return false;
    return canEditExpense(expense, {
      currentUserId,
      groupCreatorId,
      isActiveMember: group.isActiveMember,
    });
  }, [expense, group, currentUserId, groupCreatorId]);

  const canDelete = useMemo(() => {
    if (!expense || !group) return false;
    return canDeleteExpense(expense, {
      currentUserId,
      groupCreatorId,
      isActiveMember: group.isActiveMember,
    });
  }, [expense, group, currentUserId, groupCreatorId]);

  // Detect if any split participant is no longer an active member
  const memberIds = useMemo(() => group?.members.map((m) => m.id) ?? [], [group?.members]);
  const hasDepartedParticipants = useMemo(() => {
    if (!expense || !group) return false;
    return hasDepartedSplitParticipants(expense.splits, memberIds);
  }, [expense, group, memberIds]);

  // Creator display resolution
  const creatorDisplay = useMemo(() => {
    if (!expense?.createdBy) {
      return 'Not recorded (legacy expense)';
    }
    const creatorMember = group?.members.find((m) => m.id === expense.createdBy);
    const isMe = currentUserId && expense.createdBy === currentUserId;
    if (creatorMember) {
      return `${creatorMember.name}${isMe ? ' (You)' : ''}`;
    }
    return isMe ? 'You' : 'Previous member';
  }, [expense?.createdBy, group?.members, currentUserId]);

  // Payer display resolution
  const payerDisplay = useMemo(() => {
    if (!expense?.paidBy) return 'Unknown payer';
    const name = expense.paidBy.name || 'Member';
    const isMe = currentUserId && expense.paidBy.id === currentUserId;
    return `${name}${isMe ? ' (You)' : ''}`;
  }, [expense?.paidBy, currentUserId]);

  const formattedDate = useMemo(() => {
    if (!expense?.date) return 'Recently';
    const d = new Date(expense.date);
    if (isNaN(d.getTime())) return 'Recently';
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [expense?.date]);

  const isBusy = isDeleting || isMutating;

  const handleDeletePress = () => {
    if (!expense || isBusy) return;

    Alert.alert(
      'Delete Expense',
      `Are you sure you want to delete "${expense.description}" (${formatINR(expense.amount)})? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await onDeleteExpense(expense.id);
              onClose();
            } catch (err: any) {
              if (err?.isRefreshFailure) {
                onClose();
                Alert.alert(
                  'Expense Deleted',
                  'The expense was deleted on the server, but refreshing the screen failed. Please pull down to refresh.'
                );
                return;
              }
              Alert.alert('Delete Failed', err?.message || 'Could not delete expense');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  if (!expense) return null;

  const isCustomSplit = expense.splitType === 'custom';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={isBusy ? undefined : onClose}
    >
      <ThemedView type="background" style={styles.modalContainer}>
        <SafeAreaView style={styles.safeArea}>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText style={styles.headerTitle}>Expense Details</ThemedText>
            <TouchableOpacity
              onPress={onClose}
              disabled={isBusy}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close expense details"
            >
              <ThemedText style={styles.closeBtnText}>Done</ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Main Expense Banner */}
            <ThemedView type="backgroundElement" style={styles.bannerCard}>
              <View style={styles.categoryBadge}>
                <ThemedText type="smallBold" style={styles.categoryBadgeText}>
                  {expense.category || 'General'}
                </ThemedText>
              </View>

              <ThemedText style={styles.expenseTitle}>{expense.description}</ThemedText>
              <ThemedText style={styles.expenseAmount}>{formatINR(expense.amount)}</ThemedText>

              <View style={styles.dateRow}>
                <ThemedText type="small" style={styles.dateText}>
                  📅 {formattedDate}
                </ThemedText>
              </View>
            </ThemedView>

            {/* Metadata Info Card */}
            <ThemedView type="backgroundElement" style={styles.infoCard}>
              <View style={styles.infoRow}>
                <ThemedText type="smallBold" style={styles.infoLabel}>
                  Paid By
                </ThemedText>
                <View style={styles.infoValueWrap}>
                  <ThemedText type="smallBold" style={styles.infoValue}>
                    {payerDisplay}
                  </ThemedText>
                  {expense.paidBy?.email ? (
                    <ThemedText type="small" style={styles.infoSubValue}>
                      {expense.paidBy.email}
                    </ThemedText>
                  ) : null}
                </View>
              </View>

              <View style={styles.separator} />

              <View style={styles.infoRow}>
                <ThemedText type="smallBold" style={styles.infoLabel}>
                  Created By
                </ThemedText>
                <ThemedText type="small" style={styles.infoValue}>
                  {creatorDisplay}
                </ThemedText>
              </View>

              <View style={styles.separator} />

              <View style={styles.infoRow}>
                <ThemedText type="smallBold" style={styles.infoLabel}>
                  Split Method
                </ThemedText>
                <ThemedText type="small" style={styles.infoValue}>
                  {isCustomSplit ? 'Custom Split' : 'Equal Split'}
                </ThemedText>
              </View>
            </ThemedView>

            {/* Split Breakdown */}
            <ThemedView type="backgroundElement" style={styles.splitsCard}>
              <View style={styles.splitsHeaderRow}>
                <ThemedText type="smallBold" style={styles.splitsTitle}>
                  Participants & Shares
                </ThemedText>
                <ThemedText type="small" style={styles.splitsCount}>
                  {expense.splits?.length || 0} members
                </ThemedText>
              </View>

              {!expense.splits || expense.splits.length === 0 ? (
                <ThemedText type="small" style={styles.emptySplitsText}>
                  No participant breakdown recorded for this expense.
                </ThemedText>
              ) : (
                <View style={styles.splitsList}>
                  {expense.splits.map((s, idx) => {
                    const uId = s.user?.id || (typeof s.user === 'string' ? s.user : null);
                    const memberMatch = uId ? group?.members.find((m) => m.id === uId) : null;
                    const name = s.user?.name || memberMatch?.name || 'Member';
                    const isMe = currentUserId && uId === currentUserId;

                    return (
                      <View key={uId || `split_${idx}`} style={styles.splitRow}>
                        <View style={styles.splitUserWrap}>
                          <ThemedText type="smallBold" style={styles.splitUserName}>
                            {name}{isMe ? ' (You)' : ''}
                          </ThemedText>
                          {s.user?.email ? (
                            <ThemedText type="small" style={styles.splitUserEmail}>
                              {s.user.email}
                            </ThemedText>
                          ) : null}
                        </View>
                        <ThemedText type="smallBold" style={styles.splitShareAmount}>
                          {typeof s.share === 'number' ? formatINR(s.share) : '—'}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              )}
            </ThemedView>

            {/* Departed Member Notice */}
            {canEdit && hasDepartedParticipants ? (
              <ThemedView type="backgroundElement" style={styles.unsupportedCard}>
                <ThemedText type="smallBold" style={styles.unsupportedTitle}>
                  ⚠️ Departed Member Notice
                </ThemedText>
                <ThemedText type="small" style={styles.unsupportedText}>
                  This expense includes participants who are no longer active group members. Because all split participants must be current members, this expense cannot be edited.
                </ThemedText>
              </ThemedView>
            ) : null}

            {/* Action Buttons */}
            <View style={styles.actionsWrap}>
              {canEdit ? (
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    styles.editBtn,
                    (hasDepartedParticipants || isBusy) && styles.btnDisabled,
                  ]}
                  onPress={() => {
                    if (hasDepartedParticipants || isBusy) return;
                    onClose();
                    onEditPress(expense);
                  }}
                  disabled={hasDepartedParticipants || isBusy}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Edit expense"
                >
                  <ThemedText style={styles.editBtnText}>Edit Expense</ThemedText>
                </TouchableOpacity>
              ) : null}

              {canDelete ? (
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    styles.deleteBtn,
                    isBusy && styles.btnDisabled,
                  ]}
                  onPress={handleDeletePress}
                  disabled={isBusy}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Delete expense"
                >
                  {isDeleting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <ThemedText style={styles.deleteBtnText}>Delete Expense</ThemedText>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>
        </SafeAreaView>
      </ThemedView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  closeBtnText: {
    fontSize: 16,
    color: '#38BDF8',
    fontWeight: '600',
  },
  scrollContent: {
    padding: Spacing.four,
    paddingBottom: Spacing.six,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  bannerCard: {
    padding: Spacing.four,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    gap: Spacing.two,
  },
  categoryBadge: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  categoryBadgeText: {
    fontSize: 12,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  expenseTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F8FAFC',
    textAlign: 'center',
  },
  expenseAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#38BDF8',
  },
  dateRow: {
    marginTop: 2,
  },
  dateText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  infoCard: {
    padding: Spacing.four,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: Spacing.three,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    color: '#94A3B8',
  },
  infoValueWrap: {
    alignItems: 'flex-end',
  },
  infoValue: {
    fontSize: 14,
    color: '#F8FAFC',
  },
  infoSubValue: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#334155',
  },
  splitsCard: {
    padding: Spacing.four,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    gap: Spacing.three,
  },
  splitsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  splitsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  splitsCount: {
    fontSize: 13,
    color: '#94A3B8',
  },
  emptySplitsText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: Spacing.two,
  },
  splitsList: {
    gap: Spacing.two,
  },
  splitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1E293B',
  },
  splitUserWrap: {
    flex: 1,
    paddingRight: Spacing.two,
  },
  splitUserName: {
    fontSize: 14,
    color: '#F8FAFC',
  },
  splitUserEmail: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  splitShareAmount: {
    fontSize: 14,
    color: '#E2E8F0',
  },
  unsupportedCard: {
    padding: Spacing.three,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F59E0B',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    gap: 4,
  },
  unsupportedTitle: {
    color: '#F59E0B',
    fontSize: 13,
  },
  unsupportedText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
  },
  actionsWrap: {
    marginTop: Spacing.two,
    gap: Spacing.three,
  },
  actionBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtn: {
    backgroundColor: '#0284C7',
  },
  editBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  deleteBtn: {
    backgroundColor: '#DC2626',
  },
  deleteBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
