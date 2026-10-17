import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '../../../components/themed-text';
import { ThemedView } from '../../../components/themed-view';
import { ExpenseModal } from '../../../components/ExpenseModal';
import { ExpenseDetailModal } from '../../../components/ExpenseDetailModal';
import { PaymentModal } from '../../../components/PaymentModal';
import { BottomTabInset, MaxContentWidth, Spacing } from '../../../constants/theme';
import { useAuth } from '../../../context/AuthContext';
import { useGroupDetail } from '../../../hooks/useGroupDetail';
import type { ExpenseItem, PaymentIntentItem, SettlementDebt } from '../../../types/api';
import { BALANCE_COLORS, formatINR, getBalanceLabel, getBalanceTone } from '../../../utils/format';

type TabType = 'expenses' | 'balances' | 'members';

export default function GroupDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = String(id ?? '');

  const { user } = useAuth();
  const {
    group,
    expenses,
    balances,
    activeIntents,
    isLoading,
    isRefreshing,
    isMutating,
    error,
    myNetBalance,
    isCreator,
    isActiveMember,
    refresh,
    addMember,
    renameGroup,
    leaveGroup,
    deleteGroup,
    createExpense,
    updateExpense,
    deleteExpense,
  } = useGroupDetail(groupId, !!groupId && !!user);

  const [activeTab, setActiveTab] = useState<TabType>('expenses');
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showAddExpenseModal, setShowAddExpenseModal] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseItem | null>(null);
  const [expenseToEdit, setExpenseToEdit] = useState<ExpenseItem | null>(null);
  const [selectedSettlement, setSelectedSettlement] = useState<SettlementDebt | null>(null);
  const [selectedIntent, setSelectedIntent] = useState<PaymentIntentItem | null>(null);
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  const [memberEmailInput, setMemberEmailInput] = useState('');
  const [renameInput, setRenameInput] = useState('');

  const [isSubmittingMember, setIsSubmittingMember] = useState(false);
  const [isSubmittingRename, setIsSubmittingRename] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [modalError, setModalError] = useState<string | null>(null);

  // User balance hero styling
  const tone = getBalanceTone(myNetBalance);
  const balanceColor = BALANCE_COLORS[tone];
  const balanceText = getBalanceLabel(myNetBalance);

  const handleOpenAddMember = () => {
    setMemberEmailInput('');
    setModalError(null);
    setShowActionsMenu(false);
    setShowAddMemberModal(true);
  };

  const handleOpenRename = () => {
    setRenameInput(group?.name ?? '');
    setModalError(null);
    setShowActionsMenu(false);
    setShowRenameModal(true);
  };

  const handleAddMemberSubmit = async () => {
    if (isSubmittingMember) return;
    const trimmed = memberEmailInput.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setModalError('Please enter a valid email address');
      return;
    }

    setIsSubmittingMember(true);
    setModalError(null);
    try {
      const res = await addMember(trimmed);
      setShowAddMemberModal(false);
      Alert.alert('Member Added', `${res.member.name} (${res.member.email}) has been added to the group.`);
    } catch (err: any) {
      setModalError(err?.message || 'Failed to add member');
    } finally {
      setIsSubmittingMember(false);
    }
  };

  const handleRenameSubmit = async () => {
    if (isSubmittingRename) return;
    const trimmed = renameInput.trim();
    if (!trimmed) {
      setModalError('Group name is required');
      return;
    }
    if (trimmed.length > 100) {
      setModalError('Group name must be 100 characters or less');
      return;
    }

    setIsSubmittingRename(true);
    setModalError(null);
    try {
      await renameGroup(trimmed);
      setShowRenameModal(false);
      Alert.alert('Renamed', 'Group name updated successfully.');
    } catch (err: any) {
      setModalError(err?.message || 'Failed to rename group');
    } finally {
      setIsSubmittingRename(false);
    }
  };

  const handleLeaveConfirm = () => {
    setShowActionsMenu(false);
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group? You can only leave if you have no unsettled direct debts.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave Group',
          style: 'destructive',
          onPress: async () => {
            if (isLeaving) return;
            setIsLeaving(true);
            try {
              await leaveGroup();
              Alert.alert('Left Group', 'You have left the group successfully.');
              router.replace('/');
            } catch (err: any) {
              Alert.alert('Cannot Leave Group', err?.message || 'Failed to leave group');
            } finally {
              setIsLeaving(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteConfirm = () => {
    setShowActionsMenu(false);
    Alert.alert(
      'Delete Group',
      'Are you sure you want to permanently delete this group and all its records? This requires all member balances to be fully settled.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Group',
          style: 'destructive',
          onPress: async () => {
            if (isDeleting) return;
            setIsDeleting(true);
            try {
              await deleteGroup();
              Alert.alert('Group Deleted', 'The group and all associated records have been permanently deleted.');
              router.replace('/');
            } catch (err: any) {
              Alert.alert('Cannot Delete Group', err?.message || 'Failed to delete group');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const handleAddExpensePress = () => {
    setExpenseToEdit(null);
    setShowAddExpenseModal(true);
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <ThemedText style={styles.loadingText}>Loading group details...</ThemedText>
      </ThemedView>
    );
  }

  if (error || !group) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.errorContainer}>
            <ThemedText type="smallBold" style={styles.errorTitle}>
              Couldn&apos;t load group
            </ThemedText>
            <ThemedText type="small" style={styles.errorSub}>
              {error || 'Group not found or access denied'}
            </ThemedText>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => refresh()} activeOpacity={0.8}>
              <ThemedText style={styles.primaryBtnText}>Retry</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.outlineBtn} onPress={() => router.back()} activeOpacity={0.8}>
              <ThemedText style={styles.outlineBtnText}>Back to Dashboard</ThemedText>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor="#2563EB" />}
        >
          {/* Header Bar */}
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back">
              <ThemedText style={styles.backText}>‹ Dashboard</ThemedText>
            </TouchableOpacity>

            <View style={styles.headerRightActions}>
              {!isActiveMember ? (
                <View style={styles.historyBadge}>
                  <ThemedText style={styles.historyText}>History</ThemedText>
                </View>
              ) : null}

              {/* Actions Menu button */}
              {(isActiveMember || isCreator) ? (
                <TouchableOpacity
                  onPress={() => setShowActionsMenu(true)}
                  style={styles.menuBtn}
                  accessibilityLabel="Group settings and actions"
                >
                  <ThemedText style={styles.menuBtnText}>•••</ThemedText>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Group Title Section */}
          <View style={styles.titleSection}>
            <ThemedText type="title" style={styles.groupName}>
              {group.name}
            </ThemedText>
            {group.description ? (
              <ThemedText type="small" style={styles.groupDesc}>
                {group.description}
              </ThemedText>
            ) : null}
          </View>

          {/* Balance Hero Card */}
          <ThemedView type="backgroundElement" style={styles.balanceHeroCard}>
            <ThemedText type="small" style={styles.balanceHeroLabel}>
              Your Balance
            </ThemedText>
            <ThemedText type="title" style={[styles.balanceHeroAmount, { color: balanceColor }]}>
              {balanceText}
            </ThemedText>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <ThemedText type="small" style={styles.statLabel}>
                  Total Spent
                </ThemedText>
                <ThemedText type="smallBold" style={styles.statValue}>
                  {formatINR(balances?.totalSpent ?? 0)}
                </ThemedText>
              </View>
              <View style={styles.statBox}>
                <ThemedText type="small" style={styles.statLabel}>
                  Expenses
                </ThemedText>
                <ThemedText type="smallBold" style={styles.statValue}>
                  {balances?.expenseCount ?? expenses.length}
                </ThemedText>
              </View>
              <View style={styles.statBox}>
                <ThemedText type="small" style={styles.statLabel}>
                  Members
                </ThemedText>
                <ThemedText type="smallBold" style={styles.statValue}>
                  {group.members.length}
                </ThemedText>
              </View>
            </View>
          </ThemedView>

          {/* Action Row */}
          <View style={styles.actionBar}>
            {isActiveMember ? (
              <TouchableOpacity
                style={[styles.btn, styles.primaryBtn]}
                onPress={handleAddExpensePress}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.primaryBtnText}>+ Add Expense</ThemedText>
              </TouchableOpacity>
            ) : null}

            {isActiveMember ? (
              <TouchableOpacity
                style={[styles.btn, styles.outlineBtn]}
                onPress={handleOpenAddMember}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.outlineBtnText}>+ Add Member</ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Segmented Tab Selector */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'expenses' && styles.tabItemActive]}
              onPress={() => setActiveTab('expenses')}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.tabText, activeTab === 'expenses' && styles.tabTextActive]}>
                Expenses ({expenses.length})
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'balances' && styles.tabItemActive]}
              onPress={() => setActiveTab('balances')}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.tabText, activeTab === 'balances' && styles.tabTextActive]}>
                Balances & Debts
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabItem, activeTab === 'members' && styles.tabItemActive]}
              onPress={() => setActiveTab('members')}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.tabText, activeTab === 'members' && styles.tabTextActive]}>
                Members ({group.members.length})
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* TAB 1: EXPENSES */}
          {activeTab === 'expenses' ? (
            <View style={styles.tabContent}>
              {expenses.length === 0 ? (
                <ThemedView type="backgroundElement" style={styles.emptyCard}>
                  <ThemedText type="smallBold">No expenses recorded yet</ThemedText>
                  <ThemedText type="small" style={styles.emptySub}>
                    Tap + Add Expense above to record the first expense for this group.
                  </ThemedText>
                  {isActiveMember ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.primaryBtn, { marginTop: Spacing.two }]}
                      onPress={handleAddExpensePress}
                      activeOpacity={0.8}
                    >
                      <ThemedText style={styles.primaryBtnText}>+ Add First Expense</ThemedText>
                    </TouchableOpacity>
                  ) : null}
                </ThemedView>
              ) : (
                <View style={styles.expenseList}>
                  {expenses.map((expense) => {
                    const payerName = expense.paidBy?.name || 'Someone';
                    const formattedDate = expense.date
                      ? new Date(expense.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })
                      : 'Recently';

                    return (
                      <TouchableOpacity
                        key={expense.id}
                        onPress={() => setSelectedExpense(expense)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Expense: ${expense.description}, ${formatINR(expense.amount)}`}
                      >
                        <ThemedView type="backgroundElement" style={styles.expenseCard}>
                          <View style={styles.expenseRow}>
                            <View style={styles.expenseInfo}>
                              <ThemedText type="smallBold" style={styles.expenseDesc} numberOfLines={1}>
                                {expense.description}
                              </ThemedText>
                              <ThemedText type="small" style={styles.expenseSub}>
                                {payerName} paid · {formattedDate}
                              </ThemedText>
                            </View>
                            <View style={styles.expenseAmountWrap}>
                              <ThemedText type="smallBold" style={styles.expenseAmount}>
                                {formatINR(expense.amount)}
                              </ThemedText>
                              <ThemedText type="small" style={styles.expenseSplitType}>
                                {expense.splitType === 'custom' ? 'Custom' : 'Equal split'}
                              </ThemedText>
                            </View>
                          </View>
                        </ThemedView>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* TAB 2: BALANCES & PAIRWISE SETTLEMENTS */}
          {activeTab === 'balances' ? (
            <View style={styles.tabContent}>
              {/* Pairwise settlements ("Who owes whom") */}
              <ThemedView type="backgroundElement" style={styles.sectionCard}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Who Owes Whom
                </ThemedText>
                {!balances?.settlements || balances.settlements.length === 0 ? (
                  <ThemedText type="small" style={styles.settledText}>
                    ✨ All settled up! No outstanding debts in this group.
                  </ThemedText>
                ) : (
                  <View style={styles.settlementList}>
                    {balances.settlements.map((s, idx) => {
                      const fromId = String(s.from?.userId ?? s.from?.id ?? '');
                      const toId = String(s.to?.userId ?? s.to?.id ?? '');
                      const currentUserId = String(user?.id ?? '');
                      const isPayerMe = Boolean(currentUserId && fromId === currentUserId);
                      const isReceiverMe = Boolean(currentUserId && toId === currentUserId);
                      const canPay = isPayerMe && isActiveMember;
                      const fromName = s.from?.name || 'Someone';
                      const toName = s.to?.name || 'Someone';

                      let label = `${fromName} owes ${toName}`;
                      if (isPayerMe) label = `You owe ${toName}`;
                      else if (isReceiverMe) label = `${fromName} owes you`;

                      // Match active direct UPI intent for this pairwise settlement
                      const debtActiveIntent = activeIntents?.find((intent) => {
                        const iFrom = String(
                          typeof intent.from === 'object' && intent.from
                            ? (intent.from as any)._id || (intent.from as any).id
                            : intent.from
                        );
                        const iTo = String(
                          typeof intent.to === 'object' && intent.to
                            ? (intent.to as any)._id || (intent.to as any).id
                            : intent.to
                        );
                        return iFrom === fromId && iTo === toId;
                      });

                      return (
                        <View key={`${fromId}-${toId}-${idx}`} style={styles.settlementRow}>
                          <ThemedText
                            type="small"
                            style={[
                              styles.settlementLabel,
                              (isPayerMe || isReceiverMe) && styles.settlementLabelHighlight,
                            ]}
                          >
                            {label}
                          </ThemedText>
                          <View style={styles.settlementRight}>
                            <View style={styles.settlementAmountWrap}>
                              <ThemedText
                                type="smallBold"
                                style={[
                                  styles.settlementAmount,
                                  isPayerMe && styles.amountOwe,
                                  isReceiverMe && styles.amountOwed,
                                ]}
                              >
                                {formatINR(s.amount)}
                              </ThemedText>
                              {debtActiveIntent ? (
                                <View
                                  style={[
                                    styles.settlementStatusChip,
                                    debtActiveIntent.status === 'payer_claimed'
                                      ? styles.statusChipClaimed
                                      : styles.statusChipPending,
                                  ]}
                                >
                                  <ThemedText style={styles.settlementStatusChipText}>
                                    {debtActiveIntent.status === 'payer_claimed'
                                      ? 'Claimed'
                                      : 'Pending'}
                                  </ThemedText>
                                </View>
                              ) : null}
                            </View>

                            {debtActiveIntent ? (
                              <TouchableOpacity
                                style={[
                                  styles.settlementPayBtn,
                                  debtActiveIntent.status === 'payer_claimed'
                                    ? styles.settlementClaimedBtn
                                    : styles.settlementPendingBtn,
                                ]}
                                onPress={() => {
                                  setSelectedSettlement(s);
                                  setSelectedIntent(debtActiveIntent);
                                }}
                                activeOpacity={0.8}
                                accessibilityRole="button"
                                accessibilityLabel={
                                  isReceiverMe && debtActiveIntent.status === 'payer_claimed'
                                    ? `Review payment from ${fromName}`
                                    : isPayerMe
                                    ? `Manage payment status for ${toName}`
                                    : `Payment status for ${fromName}`
                                }
                              >
                                <ThemedText style={styles.settlementPayBtnText}>
                                  {isPayerMe
                                    ? 'Manage'
                                    : isReceiverMe && debtActiveIntent.status === 'payer_claimed'
                                    ? 'Review'
                                    : 'Status'}
                                </ThemedText>
                              </TouchableOpacity>
                            ) : canPay ? (
                              <TouchableOpacity
                                style={styles.settlementPayBtn}
                                onPress={() => {
                                  setSelectedSettlement(s);
                                  setSelectedIntent(null);
                                }}
                                activeOpacity={0.8}
                                accessibilityRole="button"
                                accessibilityLabel={`Pay ${toName} ${formatINR(s.amount)}`}
                              >
                                <ThemedText style={styles.settlementPayBtnText}>Pay</ThemedText>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </ThemedView>

              {/* Member net balance list */}
              <ThemedView type="backgroundElement" style={styles.sectionCard}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Member Balances
                </ThemedText>
                {!balances?.balances || balances.balances.length === 0 ? (
                  <ThemedText type="small" style={styles.emptySub}>
                    No member balances available.
                  </ThemedText>
                ) : (
                  <View style={styles.memberBalanceList}>
                    {balances.balances.map((b) => {
                      const isMe = user?.id && b.userId === user.id;
                      const bTone = getBalanceTone(b.net);
                      const bColor = BALANCE_COLORS[bTone];
                      const bText = getBalanceLabel(b.net);

                      return (
                        <View key={b.userId} style={styles.memberBalanceRow}>
                          <View style={styles.memberBalanceInfo}>
                            <ThemedText type="smallBold" style={styles.memberBalanceName}>
                              {b.name} {isMe ? '(You)' : ''}
                            </ThemedText>
                          </View>
                          <ThemedText type="smallBold" style={[styles.memberBalanceValue, { color: bColor }]}>
                            {bText}
                          </ThemedText>
                        </View>
                      );
                    })}
                  </View>
                )}
              </ThemedView>
            </View>
          ) : null}

          {/* TAB 3: MEMBERS */}
          {activeTab === 'members' ? (
            <View style={styles.tabContent}>
              <ThemedView type="backgroundElement" style={styles.sectionCard}>
                <View style={styles.cardHeaderRow}>
                  <ThemedText type="smallBold" style={styles.sectionTitle}>
                    Group Members ({group.members.length})
                  </ThemedText>
                  {isActiveMember ? (
                    <TouchableOpacity onPress={handleOpenAddMember}>
                      <ThemedText type="smallBold" style={styles.linkText}>
                        + Add Member
                      </ThemedText>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.membersList}>
                  {group.members.map((member) => {
                    const isMemberCreator =
                      group.createdBy &&
                      String(group.createdBy.id ?? group.createdBy._id ?? '') === String(member.id);
                    const hasEmail = Boolean(member.email?.trim());

                    return (
                      <View key={member.id} style={styles.memberItemRow}>
                        <View style={styles.memberAvatar}>
                          <ThemedText style={styles.memberAvatarText}>
                            {member.name.charAt(0).toUpperCase()}
                          </ThemedText>
                        </View>
                        <View style={styles.memberDetails}>
                          <View style={styles.memberNameRow}>
                            <ThemedText type="smallBold" style={styles.memberName}>
                              {member.name}
                            </ThemedText>
                            {isMemberCreator ? (
                              <View style={styles.creatorBadge}>
                                <ThemedText style={styles.creatorBadgeText}>Creator</ThemedText>
                              </View>
                            ) : null}
                          </View>
                          {hasEmail ? (
                            <ThemedText type="small" style={styles.memberEmail} numberOfLines={1}>
                              {member.email?.trim()}
                            </ThemedText>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </ThemedView>
            </View>
          ) : null}
        </ScrollView>

        {/* MODAL 1: ADD MEMBER */}
        <Modal
          visible={showAddMemberModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowAddMemberModal(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.modalCard}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                Add Member
              </ThemedText>
              <ThemedText type="small" style={styles.modalDescription}>
                Enter the email address of the person you want to add. They must have a registered LendLocal account.
              </ThemedText>

              {modalError ? (
                <View style={styles.modalErrorCard}>
                  <ThemedText style={styles.modalErrorText}>⚠️ {modalError}</ThemedText>
                </View>
              ) : null}

              <TextInput
                style={styles.modalInput}
                value={memberEmailInput}
                onChangeText={(val) => {
                  setMemberEmailInput(val);
                  if (modalError) setModalError(null);
                }}
                placeholder="registered.user@example.com"
                placeholderTextColor="#64748B"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmittingMember}
                autoFocus
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalCancelBtn]}
                  onPress={() => setShowAddMemberModal(false)}
                  disabled={isSubmittingMember}
                >
                  <ThemedText style={styles.modalCancelText}>Cancel</ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalSubmitBtn]}
                  onPress={handleAddMemberSubmit}
                  disabled={isSubmittingMember || !memberEmailInput.trim()}
                >
                  {isSubmittingMember ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <ThemedText style={styles.modalSubmitText}>Add</ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* MODAL 2: RENAME GROUP */}
        <Modal
          visible={showRenameModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowRenameModal(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView type="backgroundElement" style={styles.modalCard}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                Rename Group
              </ThemedText>

              {modalError ? (
                <View style={styles.modalErrorCard}>
                  <ThemedText style={styles.modalErrorText}>⚠️ {modalError}</ThemedText>
                </View>
              ) : null}

              <TextInput
                style={styles.modalInput}
                value={renameInput}
                onChangeText={(val) => {
                  setRenameInput(val);
                  if (modalError) setModalError(null);
                }}
                maxLength={100}
                editable={!isSubmittingRename}
                autoFocus
              />

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalCancelBtn]}
                  onPress={() => setShowRenameModal(false)}
                  disabled={isSubmittingRename}
                >
                  <ThemedText style={styles.modalCancelText}>Cancel</ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalSubmitBtn]}
                  onPress={handleRenameSubmit}
                  disabled={isSubmittingRename || !renameInput.trim()}
                >
                  {isSubmittingRename ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <ThemedText style={styles.modalSubmitText}>Save</ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            </ThemedView>
          </View>
        </Modal>

        {/* MODAL 3: ACTIONS MENU (Leave / Delete / Rename) */}
        <Modal
          visible={showActionsMenu}
          transparent
          animationType="fade"
          onRequestClose={() => setShowActionsMenu(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowActionsMenu(false)}
          >
            <ThemedView type="backgroundElement" style={styles.actionsMenuCard}>
              <ThemedText type="smallBold" style={styles.actionsMenuTitle}>
                Group Options
              </ThemedText>

              {isCreator ? (
                <TouchableOpacity style={styles.actionMenuItem} onPress={handleOpenRename}>
                  <ThemedText style={styles.actionMenuText}>✏️ Rename Group</ThemedText>
                </TouchableOpacity>
              ) : null}

              {isActiveMember ? (
                <TouchableOpacity style={styles.actionMenuItem} onPress={handleOpenAddMember}>
                  <ThemedText style={styles.actionMenuText}>👤 Add Member</ThemedText>
                </TouchableOpacity>
              ) : null}

              {/* Non-creator active member can leave */}
              {!isCreator && isActiveMember ? (
                <TouchableOpacity style={styles.actionMenuItem} onPress={handleLeaveConfirm} disabled={isLeaving}>
                  <ThemedText style={styles.actionMenuTextDestructive}>🚪 Leave Group</ThemedText>
                </TouchableOpacity>
              ) : null}

              {/* Creator can delete */}
              {isCreator ? (
                <TouchableOpacity style={styles.actionMenuItem} onPress={handleDeleteConfirm} disabled={isDeleting}>
                  <ThemedText style={styles.actionMenuTextDestructive}>🗑️ Delete Group</ThemedText>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={styles.actionMenuClose} onPress={() => setShowActionsMenu(false)}>
                <ThemedText style={styles.actionMenuCloseText}>Cancel</ThemedText>
              </TouchableOpacity>
            </ThemedView>
          </TouchableOpacity>
        </Modal>

        {/* MODAL 4: ADD / EDIT EXPENSE */}
        {group ? (
          <ExpenseModal
            visible={showAddExpenseModal}
            onClose={() => {
              setShowAddExpenseModal(false);
              setExpenseToEdit(null);
            }}
            group={group}
            currentUserId={user?.id}
            onSubmit={createExpense}
            onUpdate={updateExpense}
            isMutating={isMutating}
            expenseToEdit={expenseToEdit}
          />
        ) : null}

        {/* MODAL 5: EXPENSE DETAILS */}
        <ExpenseDetailModal
          visible={Boolean(selectedExpense)}
          onClose={() => setSelectedExpense(null)}
          expense={selectedExpense}
          group={group}
          currentUserId={user?.id}
          onEditPress={(exp) => {
            setSelectedExpense(null);
            setExpenseToEdit(exp);
            setShowAddExpenseModal(true);
          }}
          onDeleteExpense={deleteExpense}
          isMutating={isMutating}
        />

        {/* MODAL 6: DIRECT UPI PAYMENT & INTENT STATUS */}
        <PaymentModal
          visible={Boolean(selectedSettlement)}
          onClose={() => {
            setSelectedSettlement(null);
            setSelectedIntent(null);
          }}
          groupId={groupId}
          settlement={selectedSettlement}
          currentUserId={user?.id}
          existingIntent={selectedIntent}
          onIntentUpdated={refresh}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  loadingText: { opacity: 0.8, fontSize: 15 },
  errorContainer: {
    padding: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: Spacing.two,
  },
  errorTitle: { fontSize: 18 },
  errorSub: { opacity: 0.7, textAlign: 'center', marginBottom: Spacing.two },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.one,
  },
  backBtn: { paddingVertical: Spacing.one },
  backText: { color: '#3B82F6', fontSize: 15, fontWeight: '600' },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  historyBadge: {
    backgroundColor: '#F59E0B22',
    borderColor: '#F59E0B66',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  historyText: { color: '#F59E0B', fontSize: 11, fontWeight: '700' },
  menuBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    backgroundColor: '#1E293B',
    borderRadius: Spacing.one,
  },
  menuBtnText: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  titleSection: {
    gap: 4,
  },
  groupName: { fontSize: 24, fontWeight: '700' },
  groupDesc: { opacity: 0.75, lineHeight: 18 },
  balanceHeroCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#3B82F633',
  },
  balanceHeroLabel: { opacity: 0.7 },
  balanceHeroAmount: { fontSize: 22, fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#0F172A22',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    marginTop: Spacing.one,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statLabel: { opacity: 0.65, fontSize: 11 },
  statValue: { fontSize: 14 },
  actionBar: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryBtn: { backgroundColor: '#2563EB' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn: { borderWidth: 1, borderColor: '#2563EB' },
  outlineBtnText: { color: '#3B82F6', fontWeight: '700', fontSize: 14 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A1A',
    borderRadius: Spacing.two,
    padding: 3,
    marginTop: Spacing.one,
  },
  tabItem: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.one,
  },
  tabItemActive: {
    backgroundColor: '#1E293B',
  },
  tabText: {
    fontSize: 12,
    opacity: 0.7,
  },
  tabTextActive: {
    opacity: 1,
    fontWeight: '700',
    color: '#3B82F6',
  },
  tabContent: {
    gap: Spacing.two,
  },
  emptyCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  emptySub: { opacity: 0.7, textAlign: 'center' },
  expenseList: { gap: Spacing.two },
  expenseCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  expenseInfo: { flex: 1 },
  expenseDesc: { fontSize: 15 },
  expenseSub: { opacity: 0.65, fontSize: 12, marginTop: 2 },
  expenseAmountWrap: { alignItems: 'flex-end' },
  expenseAmount: { fontSize: 15 },
  expenseSplitType: { opacity: 0.5, fontSize: 11, marginTop: 2 },
  sectionCard: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  sectionTitle: { fontSize: 15 },
  linkText: { color: '#3B82F6', fontSize: 13 },
  settledText: { color: '#10B981', paddingVertical: Spacing.one },
  settlementList: { gap: Spacing.one },
  settlementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  settlementLabel: { opacity: 0.85, flex: 1 },
  settlementLabelHighlight: { fontWeight: '600', opacity: 1 },
  settlementAmount: { fontSize: 14 },
  amountOwe: { color: '#EF4444' },
  amountOwed: { color: '#10B981' },
  settlementRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  settlementPayBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Spacing.one,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settlementPayBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  settlementAmountWrap: {
    alignItems: 'flex-end',
    gap: 2,
  },
  settlementStatusChip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  statusChipPending: {
    backgroundColor: '#F59E0B22',
    borderColor: '#F59E0B66',
    borderWidth: 1,
  },
  statusChipClaimed: {
    backgroundColor: '#0284C722',
    borderColor: '#0284C766',
    borderWidth: 1,
  },
  settlementStatusChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F8FAFC',
    textTransform: 'uppercase',
  },
  settlementPendingBtn: {
    backgroundColor: '#F59E0B',
  },
  settlementClaimedBtn: {
    backgroundColor: '#0284C7',
  },
  memberBalanceList: { gap: Spacing.one },
  memberBalanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  memberBalanceInfo: { flex: 1 },
  memberBalanceName: { fontSize: 14 },
  memberBalanceValue: { fontSize: 13 },
  membersList: { gap: Spacing.two },
  memberItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.half,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  memberDetails: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  memberName: { fontSize: 14 },
  creatorBadge: {
    backgroundColor: '#2563EB22',
    borderColor: '#2563EB66',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  creatorBadgeText: { color: '#3B82F6', fontSize: 10, fontWeight: '700' },
  memberEmail: { opacity: 0.65, fontSize: 12, marginTop: 2 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  modalTitle: { fontSize: 17 },
  modalDescription: { opacity: 0.75, fontSize: 13, lineHeight: 18 },
  modalErrorCard: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
    borderRadius: Spacing.one,
    padding: Spacing.two,
  },
  modalErrorText: { color: '#EF4444', fontSize: 12 },
  modalInput: {
    backgroundColor: '#0F172A40',
    color: '#F8FAFC',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 46,
    marginVertical: Spacing.one,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  modalCancelBtn: {
    backgroundColor: '#334155',
  },
  modalCancelText: { color: '#F8FAFC', fontWeight: '600' },
  modalSubmitBtn: {
    backgroundColor: '#2563EB',
  },
  modalSubmitText: { color: '#fff', fontWeight: '700' },
  actionsMenuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  actionsMenuTitle: {
    fontSize: 15,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
    marginBottom: Spacing.one,
  },
  actionMenuItem: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.one,
  },
  actionMenuText: { fontSize: 15, color: '#F8FAFC' },
  actionMenuTextDestructive: { fontSize: 15, color: '#EF4444', fontWeight: '600' },
  actionMenuClose: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#334155',
  },
  actionMenuCloseText: { color: '#94A3B8', fontSize: 14 },
});
