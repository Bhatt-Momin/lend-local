import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { BottomTabInset, Brand, MaxContentWidth, Spacing, Surfaces } from '../../../constants/theme';
import { useAuth } from '../../../context/AuthContext';
import { useGroupDetail } from '../../../hooks/useGroupDetail';
import { paymentApi } from '../../../services/paymentApi';
import type { ExpenseItem, PaymentIntentItem, SettlementDebt } from '../../../types/api';
import { MONGO_ID_REGEX } from '../../../utils/deepLink';
import { FILTER_CATEGORIES, getCategoryIcon } from '../../../utils/expenseForm';
import { BALANCE_COLORS, formatINR, getBalanceLabel, getBalanceTone } from '../../../utils/format';

type TabType = 'expenses' | 'balances' | 'members';

export default function GroupDetailScreen() {
  const router = useRouter();
  const { id, claimIntentId } = useLocalSearchParams<{ id: string; claimIntentId?: string | string[] }>();
  const groupId = String(id ?? '');
  const rawClaimIntentId = Array.isArray(claimIntentId) ? claimIntentId[0] : claimIntentId;
  const targetClaimIntentId =
    rawClaimIntentId && MONGO_ID_REGEX.test(rawClaimIntentId) ? rawClaimIntentId : undefined;
  const openedModalIntentIdsRef = React.useRef<Set<string>>(new Set());
  const alertedIntentIdsRef = React.useRef<Set<string>>(new Set());

  const { user } = useAuth();
  const {
    group,
    expenses,
    balances,
    activeIntents,
    activeIntentsVerified,
    activeIntentsError,
    isLoading,
    isRefreshing,
    isMutating,
    error,
    refreshError,
    myNetBalance,
    isCreator,
    isActiveMember,
    filters,
    isFilteringExpenses,
    filterError,
    setFilters,
    clearFilters,
    retryFilter,
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
  const [searchInput, setSearchInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
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

  // Debounce search text input (300ms) and coordinate with category filter
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchInput.trim();
      const cat = selectedCategory === 'All' ? undefined : selectedCategory;
      const currentSearch = filters.search || '';
      const currentCat = filters.category || undefined;

      if (trimmed !== currentSearch || cat !== currentCat) {
        setFilters({
          search: trimmed || undefined,
          category: cat,
        });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, selectedCategory, filters.search, filters.category, setFilters]);

  // Deep-link intent resolution and modal launch
  useEffect(() => {
    if (!targetClaimIntentId) return;

    // A. Initial load finished with a fatal group-level error
    if (!isLoading && !group && error) {
      if (!alertedIntentIdsRef.current.has(targetClaimIntentId)) {
        alertedIntentIdsRef.current.add(targetClaimIntentId);
        Alert.alert(
          'Payment Status Unverified',
          'Could not load group to verify payment claim. Please check your connection and retry.'
        );
      }
      return;
    }

    // B. Group is loaded
    if (!isLoading && group) {
      // 1. Look for matching active intent
      const matchedIntent = activeIntents.find((i) => i.intentId === targetClaimIntentId);

      if (matchedIntent) {
        if (!openedModalIntentIdsRef.current.has(targetClaimIntentId)) {
          openedModalIntentIdsRef.current.add(targetClaimIntentId);

          const intentFromId = String(
            typeof matchedIntent.from === 'object' && matchedIntent.from
              ? (matchedIntent.from as any)._id || (matchedIntent.from as any).id
              : matchedIntent.from
          );
          const intentToId = String(
            typeof matchedIntent.to === 'object' && matchedIntent.to
              ? (matchedIntent.to as any)._id || (matchedIntent.to as any).id
              : matchedIntent.to
          );

          const existingSettlement = balances?.settlements?.find((s) => {
            const fromId = String(s.from?.userId ?? s.from?.id ?? '');
            const toId = String(s.to?.userId ?? s.to?.id ?? '');
            return fromId === intentFromId && toId === intentToId;
          });

          const settlementToUse: SettlementDebt = existingSettlement || {
            from: {
              id: intentFromId,
              userId: intentFromId,
              name: matchedIntent.payerName || 'Payer',
            },
            to: {
              id: intentToId,
              userId: intentToId,
              name: matchedIntent.payeeName || 'Recipient',
            },
            amount: matchedIntent.amount,
          };

          setActiveTab('balances');
          setSelectedSettlement(settlementToUse);
          setSelectedIntent(matchedIntent);
        }
        return;
      }

      // 2. If intent not found in activeIntents, check verification state
      if (
        openedModalIntentIdsRef.current.has(targetClaimIntentId) ||
        alertedIntentIdsRef.current.has(targetClaimIntentId)
      ) {
        return;
      }

      if (activeIntentsVerified) {
        alertedIntentIdsRef.current.add(targetClaimIntentId);

        paymentApi
          .getStatus(targetClaimIntentId)
          .then((statusRes) => {
            const statusLabel =
              statusRes.status === 'recipient_confirmed'
                ? 'confirmed'
                : statusRes.status === 'recipient_rejected'
                ? 'rejected'
                : statusRes.status === 'cancelled'
                ? 'cancelled'
                : statusRes.status;
            Alert.alert(
              'Payment Status',
              `This payment claim is in status "${statusLabel}" and no longer requires confirmation.`
            );
          })
          .catch((err: any) => {
            let msg = 'Could not verify payment claim status. Please check your connection and pull down to refresh.';
            if (err?.status === 404) {
              msg = 'Payment intent not found or does not exist.';
            } else if (err?.status === 403) {
              msg = 'You are not authorized to view this payment claim.';
            }
            Alert.alert('Payment Notice', msg);
          });
      } else {
        // Active intents failed to verify or load
        alertedIntentIdsRef.current.add(targetClaimIntentId);
        Alert.alert(
          'Payment Status Unverified',
          'Could not verify active payment claim status. Please check your connection and pull down to refresh.'
        );
      }
    }
  }, [
    isLoading,
    group,
    error,
    targetClaimIntentId,
    activeIntents,
    activeIntentsVerified,
    balances,
  ]);

  const handleSelectCategory = (cat: string) => {
    if (cat === selectedCategory) return;
    setSelectedCategory(cat);
    const trimmed = searchInput.trim();
    const categoryParam = cat === 'All' ? undefined : cat;
    setFilters({
      search: trimmed || undefined,
      category: categoryParam,
    });
  };

  const handleClearSearch = () => {
    setSearchInput('');
    const categoryParam = selectedCategory === 'All' ? undefined : selectedCategory;
    setFilters({
      search: undefined,
      category: categoryParam,
    });
  };

  const handleResetAllFilters = () => {
    setSearchInput('');
    setSelectedCategory('All');
    clearFilters();
  };

  const isFilterActive = Boolean(
    (filters.search && filters.search.trim().length > 0) ||
    (filters.category && filters.category.trim().length > 0) ||
    searchInput.trim().length > 0 ||
    selectedCategory !== 'All'
  );

  // User balance hero styling
  const tone = getBalanceTone(myNetBalance);
  const balanceColor = BALANCE_COLORS[tone];
  const balanceText = getBalanceLabel(myNetBalance);

  const currentUserId = String(user?.id ?? '');

  // M5: Count active incoming payment claims awaiting verification by the authenticated recipient
  const unconfirmedClaimsCount = useMemo(() => {
    if (!currentUserId || !activeIntents || activeIntents.length === 0) return 0;
    const seenIntentIds = new Set<string>();

    return activeIntents.filter((intent) => {
      if (!intent || intent.status !== 'payer_claimed') return false;

      const toId = String(
        typeof intent.to === 'object' && intent.to
          ? (intent.to as any)._id || (intent.to as any).id
          : intent.to
      );

      // Must be intended for current user (recipient)
      if (toId !== currentUserId) return false;

      // De-duplicate any multiple appearances of the same intentId
      const intentId = String(intent.intentId || '');
      if (intentId && seenIntentIds.has(intentId)) return false;
      if (intentId) seenIntentIds.add(intentId);

      return true;
    }).length;
  }, [activeIntents, currentUserId]);

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
        <ActivityIndicator size="large" color={Brand.primary} />
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

  const balanceToneBorder =
    myNetBalance >= 0.01
      ? styles.heroCardOwed
      : myNetBalance <= -0.01
      ? styles.heroCardOwe
      : styles.heroCardSettled;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={Brand.primary} />}
          keyboardShouldPersistTaps="handled"
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

          {/* Stale data indication on refresh failure */}
          {refreshError ? (
            <View style={styles.staleDataBanner}>
              <ThemedText style={styles.staleDataText}>
                ⚠️ Balances may be out of date ({refreshError}). Pull down to refresh.
              </ThemedText>
            </View>
          ) : !activeIntentsVerified && activeIntentsError ? (
            <View style={styles.staleDataBanner}>
              <ThemedText style={styles.staleDataText}>
                ⚠️ Payment status could not be verified ({activeIntentsError}). Pull down to refresh before initiating payments.
              </ThemedText>
            </View>
          ) : null}

          {/* Balance Hero Card */}
          <ThemedView type="backgroundElement" style={[styles.balanceHeroCard, balanceToneBorder]}>
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
              accessibilityRole="tab"
              accessibilityLabel={
                unconfirmedClaimsCount > 0
                  ? `Balances and Debts, ${unconfirmedClaimsCount} claim${unconfirmedClaimsCount === 1 ? '' : 's'} awaiting review`
                  : 'Balances and Debts'
              }
            >
              <View style={styles.tabItemContent}>
                <ThemedText style={[styles.tabText, activeTab === 'balances' && styles.tabTextActive]}>
                  Balances & Debts
                </ThemedText>
                {unconfirmedClaimsCount > 0 ? (
                  <View style={styles.tabBadge}>
                    <ThemedText style={styles.tabBadgeText}>
                      {unconfirmedClaimsCount}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
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
              {/* Search Bar */}
              <View style={styles.searchBarContainer}>
                <View style={styles.searchInputWrapper}>
                  <ThemedText style={styles.searchIcon}>🔍</ThemedText>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search expenses..."
                    placeholderTextColor="#94A3B8"
                    value={searchInput}
                    onChangeText={setSearchInput}
                    returnKeyType="search"
                    onSubmitEditing={Keyboard.dismiss}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Search expenses"
                    accessibilityHint="Filters expenses by description"
                  />
                  {isFilteringExpenses ? (
                    <ActivityIndicator size="small" color={Brand.primary} style={styles.searchSpinner} />
                  ) : searchInput.length > 0 ? (
                    <TouchableOpacity
                      onPress={handleClearSearch}
                      style={styles.clearSearchBtn}
                      accessibilityLabel="Clear search input"
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <ThemedText style={styles.clearSearchText}>✕</ThemedText>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              {/* Horizontal Category Filter Chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterChipsScroll}
                keyboardShouldPersistTaps="handled"
                style={styles.filterChipsContainer}
              >
                {FILTER_CATEGORIES.map((cat) => {
                  const isSelected = selectedCategory === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.filterChip, isSelected && styles.filterChipActive]}
                      onPress={() => handleSelectCategory(cat)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter by ${cat}`}
                      accessibilityState={{ selected: isSelected }}
                    >
                      <ThemedText
                        type="small"
                        style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}
                      >
                        {cat !== 'All' ? `${getCategoryIcon(cat)} ` : ''}{cat}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Filter Error Banner */}
              {filterError ? (
                <View style={styles.filterErrorBanner}>
                  <ThemedText style={styles.filterErrorText}>
                    ⚠️ Could not update search results ({filterError}).
                  </ThemedText>
                  <TouchableOpacity onPress={retryFilter} style={styles.filterRetryBtn} activeOpacity={0.7}>
                    <ThemedText style={styles.filterRetryText}>Retry</ThemedText>
                  </TouchableOpacity>
                </View>
              ) : null}

              {/* Empty state or list */}
              {expenses.length === 0 ? (
                isFilterActive ? (
                  <ThemedView type="backgroundElement" style={styles.emptyCard}>
                    <ThemedText style={styles.emptyIcon}>🔍</ThemedText>
                    <ThemedText type="smallBold">No matching expenses</ThemedText>
                    <ThemedText type="small" style={styles.emptySub}>
                      No expenses match your search or filter criteria.
                    </ThemedText>
                    <TouchableOpacity
                      style={[styles.btn, styles.outlineBtn, { marginTop: Spacing.two }]}
                      onPress={handleResetAllFilters}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Clear all filters"
                    >
                      <ThemedText style={styles.outlineBtnText}>Clear Filters</ThemedText>
                    </TouchableOpacity>
                  </ThemedView>
                ) : (
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
                )
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
                              <View style={styles.expenseMetaRow}>
                                <View style={styles.categoryBadge}>
                                  <ThemedText style={styles.categoryBadgeText}>
                                    {getCategoryIcon(expense.category)} {expense.category || 'General'}
                                  </ThemedText>
                                </View>
                                <ThemedText type="small" style={styles.expenseSub} numberOfLines={1}>
                                  · {payerName} paid · {formattedDate}
                                </ThemedText>
                              </View>
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
                {!activeIntentsVerified && activeIntentsError ? (
                  <View style={styles.unverifiedIntentsCard}>
                    <ThemedText style={styles.unverifiedIntentsText}>
                      ⚠️ Active payments and claims could not be verified ({activeIntentsError}). Pending claims and payment statuses may be missing. Pull down to refresh.
                    </ThemedText>
                  </View>
                ) : null}
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
                              activeIntentsVerified ? (
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
                              ) : (
                                <TouchableOpacity
                                  style={[styles.settlementPayBtn, styles.settlementUnverifiedBtn]}
                                  onPress={() => {
                                    Alert.alert(
                                      'Active Payment Status Unverified',
                                      'Could not verify existing payments or pending claims. Please refresh before initiating a payment to prevent duplicate payments.',
                                      [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: 'Retry', onPress: () => refresh(false) },
                                      ]
                                    );
                                  }}
                                  activeOpacity={0.8}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Check payment status for ${toName}`}
                                >
                                  <ThemedText style={[styles.settlementPayBtnText, styles.settlementUnverifiedBtnText]}>
                                    Check Status
                                  </ThemedText>
                                </TouchableOpacity>
                              )
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
          onIntentUpdated={() => refresh(true)}
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
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  backText: { color: Brand.primaryLight, fontSize: 13, fontWeight: '700' },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  historyBadge: {
    backgroundColor: Brand.warningDim,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  historyText: { color: Brand.warning, fontSize: 11, fontWeight: '700' },
  menuBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  menuBtnText: { color: '#F0F4F8', fontSize: 14, fontWeight: '700' },
  titleSection: {
    gap: 4,
  },
  groupName: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  groupDesc: { opacity: 0.75, lineHeight: 18 },
  balanceHeroCard: {
    padding: Spacing.four,
    borderRadius: 18,
    gap: Spacing.two,
    borderWidth: 1,
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
  },
  heroCardOwed: {
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderLeftWidth: 4,
    borderLeftColor: Brand.primary,
  },
  heroCardOwe: {
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderLeftWidth: 4,
    borderLeftColor: Brand.negative,
  },
  heroCardSettled: {
    borderColor: Surfaces.darkBorder,
    borderLeftWidth: 4,
    borderLeftColor: Surfaces.darkBorderBright,
  },
  balanceHeroLabel: { opacity: 0.7, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  balanceHeroAmount: { fontSize: 24, fontWeight: '800' },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: 12,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  statLabel: { opacity: 0.65, fontSize: 11, fontWeight: '500' },
  statValue: { fontSize: 14, fontWeight: '700', color: '#F0F4F8' },
  actionBar: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  primaryBtn: { backgroundColor: Brand.primary },
  primaryBtnText: { color: '#030507', fontWeight: '700', fontSize: 14 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: Brand.primary,
    backgroundColor: Brand.primaryDim,
  },
  outlineBtnText: { color: Brand.primaryLight, fontWeight: '700', fontSize: 14 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Surfaces.darkCard,
    borderRadius: 14,
    padding: 4,
    marginTop: Spacing.one,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  tabItem: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  tabItemActive: {
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorderBright,
  },
  tabItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  tabBadge: {
    backgroundColor: Brand.info,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  tabText: {
    fontSize: 12,
    opacity: 0.7,
  },
  tabTextActive: {
    opacity: 1,
    fontWeight: '700',
    color: Brand.primaryLight,
  },
  tabContent: {
    gap: Spacing.two,
  },
  emptyCard: {
    padding: Spacing.four,
    borderRadius: 16,
    alignItems: 'center',
    gap: Spacing.one,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  emptySub: { opacity: 0.7, textAlign: 'center' },
  expenseList: { gap: Spacing.two },
  expenseCard: {
    padding: Spacing.three,
    borderRadius: 14,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  expenseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  expenseInfo: { flex: 1 },
  expenseDesc: { fontSize: 15, fontWeight: '600' },
  expenseSub: { opacity: 0.65, fontSize: 12, marginTop: 2 },
  expenseAmountWrap: { alignItems: 'flex-end' },
  expenseAmount: { fontSize: 15, fontWeight: '700' },
  expenseSplitType: { opacity: 0.5, fontSize: 11, marginTop: 2 },
  sectionCard: {
    padding: Spacing.three,
    borderRadius: 16,
    gap: Spacing.two,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  linkText: { color: Brand.primaryLight, fontSize: 13, fontWeight: '600' },
  settledText: { color: Brand.positive, paddingVertical: Spacing.one, fontWeight: '600' },
  settlementList: { gap: Spacing.one },
  settlementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Surfaces.darkBorder,
  },
  settlementLabel: { opacity: 0.85, flex: 1 },
  settlementLabelHighlight: { fontWeight: '600', opacity: 1 },
  settlementAmount: { fontSize: 14, fontWeight: '700' },
  amountOwe: { color: Brand.negative },
  amountOwed: { color: Brand.positive },
  settlementRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  settlementPayBtn: {
    backgroundColor: Brand.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settlementPayBtnText: {
    color: '#030507',
    fontWeight: '700',
    fontSize: 12,
  },
  settlementAmountWrap: {
    alignItems: 'flex-end',
    gap: 2,
  },
  settlementStatusChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusChipPending: {
    backgroundColor: Brand.warningDim,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderWidth: 1,
  },
  statusChipClaimed: {
    backgroundColor: Brand.infoDim,
    borderColor: 'rgba(2, 132, 199, 0.4)',
    borderWidth: 1,
  },
  settlementStatusChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F8FAFC',
    textTransform: 'uppercase',
  },
  settlementPendingBtn: {
    backgroundColor: Brand.warning,
  },
  settlementClaimedBtn: {
    backgroundColor: Brand.info,
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
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { color: '#F0F4F8', fontSize: 15, fontWeight: '700' },
  memberDetails: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  memberName: { fontSize: 14, fontWeight: '600' },
  creatorBadge: {
    backgroundColor: Brand.primaryDim,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1.5,
  },
  creatorBadgeText: { color: Brand.primaryLight, fontSize: 10, fontWeight: '700' },
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
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.two,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalDescription: { opacity: 0.75, fontSize: 13, lineHeight: 18 },
  modalErrorCard: {
    backgroundColor: Brand.negativeDim,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: Spacing.one,
    padding: Spacing.two,
  },
  modalErrorText: { color: Brand.negative, fontSize: 12 },
  modalInput: {
    backgroundColor: Surfaces.darkCardMid,
    color: '#F8FAFC',
    borderColor: Surfaces.darkBorder,
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
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  modalCancelBtn: {
    backgroundColor: Surfaces.darkCardMid,
  },
  modalCancelText: { color: '#F8FAFC', fontWeight: '600' },
  modalSubmitBtn: {
    backgroundColor: Brand.primary,
  },
  modalSubmitText: { color: '#030507', fontWeight: '700' },
  actionsMenuCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 18,
    padding: Spacing.three,
    gap: Spacing.one,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  actionsMenuTitle: {
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Surfaces.darkBorder,
    marginBottom: Spacing.one,
  },
  actionMenuItem: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: 8,
  },
  actionMenuText: { fontSize: 15, color: '#F8FAFC' },
  actionMenuTextDestructive: { fontSize: 15, color: Brand.negative, fontWeight: '600' },
  actionMenuClose: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Surfaces.darkBorder,
  },
  actionMenuCloseText: { color: '#94A3B8', fontSize: 14 },
  staleDataBanner: {
    backgroundColor: Brand.warningDim,
    borderWidth: 1,
    borderColor: Brand.warning,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  staleDataText: {
    color: Brand.warning,
    fontSize: 13,
    fontWeight: '500',
  },
  settlementUnverifiedBtn: {
    backgroundColor: '#64748B',
  },
  settlementUnverifiedBtnText: {
    color: '#F8FAFC',
  },
  unverifiedIntentsCard: {
    backgroundColor: Brand.warningDim,
    borderWidth: 1,
    borderColor: Brand.warning,
    borderRadius: 10,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  unverifiedIntentsText: {
    color: Brand.warning,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  searchBarContainer: {
    marginBottom: Spacing.two,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    minHeight: 44,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: Spacing.one,
    opacity: 0.7,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#F8FAFC',
    paddingVertical: 8,
  },
  searchSpinner: {
    marginLeft: Spacing.one,
  },
  clearSearchBtn: {
    padding: 4,
    marginLeft: Spacing.half,
  },
  clearSearchText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: 'bold',
  },
  filterChipsContainer: {
    marginBottom: Spacing.two,
  },
  filterChipsScroll: {
    flexDirection: 'row',
    gap: Spacing.one,
    paddingRight: Spacing.two,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: Brand.primaryDim,
    borderColor: Brand.primary,
  },
  filterChipText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: Brand.primaryLight,
    fontWeight: '700',
  },
  filterErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Brand.warningDim,
    borderRadius: 8,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.two,
    borderWidth: 1,
    borderColor: Brand.warning,
  },
  filterErrorText: {
    flex: 1,
    fontSize: 12,
    color: Brand.warning,
    marginRight: Spacing.one,
  },
  filterRetryBtn: {
    backgroundColor: Brand.warning,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  filterRetryText: {
    fontSize: 12,
    color: '#030507',
    fontWeight: 'bold',
  },
  expenseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  categoryBadge: {
    backgroundColor: Brand.primaryDim,
    borderColor: 'rgba(16, 185, 129, 0.28)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  categoryBadgeText: {
    color: Brand.primaryLight,
    fontSize: 11,
    fontWeight: '600',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: Spacing.one,
    textAlign: 'center',
  },
});
