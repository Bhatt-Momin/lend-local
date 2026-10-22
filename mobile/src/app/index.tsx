import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GroupCard } from '../components/GroupCard';
import { NotificationInboxModal } from '../components/NotificationInboxModal';
import { ServerConfigModal } from '../components/ServerConfigModal';
import { SettingsModal } from '../components/SettingsModal';
import { UpiConfigModal } from '../components/UpiConfigModal';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { BottomTabInset, Brand, MaxContentWidth, Spacing, Surfaces } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useGroups } from '../hooks/useGroups';
import { notificationsApi } from '../services/notificationsApi';
import type { GroupSummary } from '../types/api';
import { formatINR } from '../utils/format';

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading, isRefreshingUser, logout, refreshUser } = useAuth();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [editingUpiId, setEditingUpiId] = useState<string | null | undefined>(undefined);
  const [returnToSettings, setReturnToSettings] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'groups' | 'activity'>('overview');

  const groupsEnabled = !!user && !isLoading;
  const { groups, isLoading: groupsLoading, isRefreshing, error: groupsError, refresh, refreshOnFocus } =
    useGroups(groupsEnabled, { onUnauthorized: logout });

  const notificationsRequestIdRef = useRef<number>(0);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
  const userRef = useRef(user);
  userRef.current = user;

  // Reset notification count immediately on logout or account switch
  useEffect(() => {
    const currentUserId = user?.id ?? null;
    if (prevUserIdRef.current !== currentUserId) {
      notificationsRequestIdRef.current += 1;
      setUnreadNotificationsCount(0);
      prevUserIdRef.current = currentUserId;
    }
  }, [user?.id]);

  const fetchUnreadNotifications = useCallback(async () => {
    const currentUserId = user?.id;
    if (!currentUserId) return;

    const currentRequestId = ++notificationsRequestIdRef.current;
    try {
      const res = await notificationsApi.list({ limit: 1 });
      // Guard against stale responses across account changes or superseded requests
      if (
        currentRequestId === notificationsRequestIdRef.current &&
        userRef.current?.id === currentUserId
      ) {
        setUnreadNotificationsCount(res.unreadCount || 0);
      }
    } catch {
      // Non-blocking background fetch
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      if (groupsEnabled) {
        refreshOnFocus();
        refreshUser().catch((err) => {
          console.warn('Dashboard focus user refresh failed:', err?.message);
        });
        fetchUnreadNotifications();
      }
    }, [groupsEnabled, refreshOnFocus, refreshUser, fetchUnreadNotifications])
  );

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([refresh(), refreshUser(), fetchUnreadNotifications()]);
  }, [refresh, refreshUser, fetchUnreadNotifications]);

  /**
   * Authoritative totals calculation:
   * Aggregates positive balances (owed to user) and negative balances (user owes)
   * across all returned groups for the authenticated user.
   * Both share the exact same user scope.
   *
   * Balance threshold note (0.01 INR = 1 paise):
   * 1 paise is the minimum transacted currency unit in INR. Floating-point remainders
   * below 0.01 (< 1 paise) can result from division across split participants and are
   * treated as settled to match backend ledger conventions (Math.abs(myBalance) < 0.01)
   * and avoid displaying phantom sub-cent balances.
   */
  const totals = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;
    for (const g of groups) {
      if (g.myBalance >= 0.01) {
        owedToMe += g.myBalance;
      } else if (g.myBalance <= -0.01) {
        iOwe += Math.abs(g.myBalance);
      }
    }
    const netBalance = owedToMe - iOwe;
    return { owedToMe, iOwe, netBalance };
  }, [groups]);

  /**
   * Prominent Net Balance presentation derivation:
   * Positive: +₹X.XX (emerald)
   * Negative: −₹X.XX (rose)
   * Settled: ₹0.00 (neutral)
   */
  const netPresentation = useMemo(() => {
    const { netBalance } = totals;
    if (netBalance >= 0.01) {
      return {
        formatted: `+${formatINR(netBalance)}`,
        badge: 'Owed to you',
        explanation: 'You are owed more than you owe across your groups.',
        amountColor: Brand.positive,
        badgeStyle: styles.netBadgeOwed,
        badgeTextStyle: styles.netBadgeTextOwed,
        cardBorder: styles.netCardOwed,
      };
    }
    if (netBalance <= -0.01) {
      return {
        formatted: `−${formatINR(Math.abs(netBalance))}`,
        badge: 'You owe',
        explanation: 'You owe more than you are owed across your groups.',
        amountColor: Brand.negative,
        badgeStyle: styles.netBadgeOwe,
        badgeTextStyle: styles.netBadgeTextOwe,
        cardBorder: styles.netCardOwe,
      };
    }
    return {
      formatted: '₹0.00',
      badge: 'Settled',
      explanation: 'All group balances are settled up.',
      amountColor: '#F0F4F8',
      badgeStyle: styles.netBadgeSettled,
      badgeTextStyle: styles.netBadgeTextSettled,
      cardBorder: styles.netCardSettled,
    };
  }, [totals]);

  /**
   * Friendly, human greeting based on time of day
   */
  const greeting = useMemo(() => {
    if (!user) return 'Welcome to LendLocal';
    const hour = new Date().getHours();
    const firstName = user.name.split(' ')[0] || user.name;
    if (hour < 12) return `Good morning, ${firstName} 👋`;
    if (hour < 17) return `Good afternoon, ${firstName} 👋`;
    return `Good evening, ${firstName} 👋`;
  }, [user]);

  const greetingSubtitle = useMemo(() => {
    if (totals.netBalance >= 0.01) return "You're in the green across your groups.";
    if (totals.netBalance <= -0.01) return 'You have a few balances to settle.';
    return "You're all settled up.";
  }, [totals.netBalance]);

  /**
   * Real pending actions derived from active settlements across groups
   */
  const pendingActions = useMemo(() => {
    if (!user) return [];
    const actions: Array<{
      id: string;
      groupId: string;
      groupName: string;
      type: 'owe' | 'owed';
      counterpartyName: string;
      amount: number;
    }> = [];

    for (const g of groups) {
      if (!Array.isArray(g.settlements)) continue;
      for (const s of g.settlements) {
        if (s.from.id === user.id) {
          actions.push({
            id: `${g.id}_owe_${s.to.id}`,
            groupId: g.id,
            groupName: g.name,
            type: 'owe',
            counterpartyName: s.to.name,
            amount: s.amount,
          });
        } else if (s.to.id === user.id) {
          actions.push({
            id: `${g.id}_owed_${s.from.id}`,
            groupId: g.id,
            groupName: g.name,
            type: 'owed',
            counterpartyName: s.from.name,
            amount: s.amount,
          });
        }
      }
    }
    return actions;
  }, [groups, user]);

  /**
   * Real recent activity: groups sorted by most recent update timestamp
   */
  const recentGroupActivity = useMemo(() => {
    return [...groups]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .slice(0, 6);
  }, [groups]);

  const handleOpenServerFromSettings = useCallback(() => {
    setShowSettingsModal(false);
    setTimeout(() => setShowServerModal(true), 150);
  }, []);

  const handleOpenUpiFromSettings = useCallback((currentUpiId?: string | null) => {
    setEditingUpiId(currentUpiId !== undefined ? currentUpiId : user?.upiId);
    setShowSettingsModal(false);
    setReturnToSettings(true);
    setTimeout(() => setShowUpiModal(true), 150);
  }, [user?.upiId]);

  const handleCloseUpiModal = useCallback(() => {
    setShowUpiModal(false);
    if (returnToSettings) {
      setReturnToSettings(false);
      setTimeout(() => setShowSettingsModal(true), 150);
    }
  }, [returnToSettings]);

  const handleUpiSuccess = useCallback((newUpiId: string | null) => {
    setEditingUpiId(newUpiId);
  }, []);

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out of your LendLocal account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              setShowSettingsModal(false);
              await logout();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to sign out');
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  const handleGroupPress = (group: GroupSummary) => {
    router.push(`/group/${group.id}`);
  };

  const handleCreateGroup = () => {
    router.push('/group/new');
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Brand.primary} />
        <ThemedText style={styles.loadingText}>Restoring session...</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            user ? (
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Brand.primary} />
            ) : undefined
          }
        >
          {user ? (
            <>
              {/* Friendly Top Header Bar */}
              <View style={styles.topHeaderBar}>
                <View style={styles.brandRow}>
                  <Image
                    source={require('@/assets/images/icon-192.png')}
                    style={styles.headerLogo}
                    resizeMode="contain"
                    accessibilityLabel="LendLocal Logo"
                  />
                  <View style={styles.greetingTextWrap}>
                    <ThemedText style={styles.greetingTitle} numberOfLines={1}>
                      {greeting}
                    </ThemedText>
                    <ThemedText style={styles.greetingSub} numberOfLines={1}>
                      {greetingSubtitle}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.headerActions}>
                  {/* Notification Bell Affordance — Opens In-App Inbox */}
                  <TouchableOpacity
                    style={styles.headerIconBtn}
                    onPress={() => setShowNotificationsModal(true)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Notifications${unreadNotificationsCount ? `, ${unreadNotificationsCount} unread` : ''}`}
                  >
                    <ThemedText style={styles.headerIcon}>🔔</ThemedText>
                    {unreadNotificationsCount > 0 ? (
                      <View style={styles.bellBadge}>
                        <ThemedText style={styles.bellBadgeText}>{unreadNotificationsCount}</ThemedText>
                      </View>
                    ) : null}
                  </TouchableOpacity>

                  {/* Settings Gear */}
                  <TouchableOpacity
                    style={styles.settingsGearBtn}
                    onPress={() => setShowSettingsModal(true)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Open settings and profile"
                  >
                    <ThemedText style={styles.settingsGearIcon}>⚙️</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Navigation Segment Tabs */}
              <View style={styles.navTabsRow}>
                <TouchableOpacity
                  style={[styles.navTab, activeTab === 'overview' && styles.navTabActive]}
                  onPress={() => setActiveTab('overview')}
                  activeOpacity={0.8}
                >
                  <ThemedText style={[styles.navTabText, activeTab === 'overview' && styles.navTabTextActive]}>
                    Overview
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.navTab, activeTab === 'groups' && styles.navTabActive]}
                  onPress={() => setActiveTab('groups')}
                  activeOpacity={0.8}
                >
                  <ThemedText style={[styles.navTabText, activeTab === 'groups' && styles.navTabTextActive]}>
                    Groups ({groups.length})
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.navTab, activeTab === 'activity' && styles.navTabActive]}
                  onPress={() => setActiveTab('activity')}
                  activeOpacity={0.8}
                >
                  <ThemedText style={[styles.navTabText, activeTab === 'activity' && styles.navTabTextActive]}>
                    Recents {pendingActions.length ? `(${pendingActions.length})` : ''}
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.navTab}
                  onPress={() => setShowSettingsModal(true)}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.navTabText}>
                    Profile
                  </ThemedText>
                </TouchableOpacity>
              </View>

              {activeTab === 'overview' || activeTab === 'groups' ? (
                /* Prominent Net Overall Balance Card with Zero-Clipping Layout */
                <ThemedView
                  type="backgroundElement"
                  style={[styles.netBalanceCard, netPresentation.cardBorder]}
                >
                  <View style={styles.netCardHeaderRow}>
                    <ThemedText style={styles.netCardLabel}>
                      Net Balance
                    </ThemedText>
                    <View style={[styles.netBadge, netPresentation.badgeStyle]}>
                      <ThemedText style={[styles.netBadgeText, netPresentation.badgeTextStyle]}>
                        {netPresentation.badge}
                      </ThemedText>
                    </View>
                  </View>

                  {groupsLoading && groups.length === 0 ? (
                    <View style={styles.netLoadingRow}>
                      <ActivityIndicator size="small" color={Brand.primary} />
                      <ThemedText style={styles.netLoadingText}>Calculating balances...</ThemedText>
                    </View>
                  ) : (
                    <View style={styles.netAmountContainer}>
                      <ThemedText style={[styles.netCardAmount, { color: netPresentation.amountColor }]}>
                        {netPresentation.formatted}
                      </ThemedText>

                      <ThemedText style={styles.netCardExplanation}>
                        {netPresentation.explanation}
                      </ThemedText>
                    </View>
                  )}

                  <View style={styles.netCardDivider} />

                  {/* Secondary Component Totals */}
                  <View style={styles.secondaryTotalsRow}>
                    <View style={styles.secondaryCol}>
                      <View style={styles.secondaryLabelRow}>
                        <View style={[styles.dotIndicator, { backgroundColor: Brand.positive }]} />
                        <ThemedText style={styles.secondaryLabel}>Owed to you</ThemedText>
                      </View>
                      <ThemedText style={styles.secondaryValueOwed}>
                        {formatINR(totals.owedToMe)}
                      </ThemedText>
                    </View>

                    <View style={styles.secondaryVerticalDivider} />

                    <View style={styles.secondaryCol}>
                      <View style={styles.secondaryLabelRow}>
                        <View style={[styles.dotIndicator, { backgroundColor: Brand.negative }]} />
                        <ThemedText style={styles.secondaryLabel}>You owe</ThemedText>
                      </View>
                      <ThemedText style={styles.secondaryValueOwe}>
                        {formatINR(totals.iOwe)}
                      </ThemedText>
                    </View>
                  </View>
                </ThemedView>
              ) : null}

              {/* Needs Your Attention Section — Displayed ONLY when real pending actions exist */}
              {pendingActions.length > 0 && (activeTab === 'overview' || activeTab === 'activity') ? (
                <View style={styles.attentionSection}>
                  <View style={styles.attentionHeaderRow}>
                    <View style={styles.attentionTitleWrap}>
                      <ThemedText style={styles.attentionIcon}>⚠️</ThemedText>
                      <ThemedText style={styles.attentionTitle}>Needs your attention</ThemedText>
                    </View>
                    <View style={styles.attentionCountBadge}>
                      <ThemedText style={styles.attentionCountText}>
                        {pendingActions.length} action{pendingActions.length === 1 ? '' : 's'}
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.attentionCard}>
                    {pendingActions.map((action, idx) => (
                      <TouchableOpacity
                        key={action.id}
                        style={[
                          styles.attentionItemRow,
                          idx < pendingActions.length - 1 && styles.itemSeparator,
                        ]}
                        onPress={() => router.push(`/group/${action.groupId}`)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`${action.type === 'owe' ? 'Pay' : 'Incoming from'} ${action.counterpartyName} ${formatINR(action.amount)} in ${action.groupName}`}
                      >
                        <View style={styles.attentionItemLeft}>
                          <View
                            style={[
                              styles.actionDot,
                              { backgroundColor: action.type === 'owe' ? Brand.negative : Brand.positive },
                            ]}
                          />
                          <View style={styles.actionTextWrap}>
                            <ThemedText style={styles.actionMainText}>
                              {action.type === 'owe' ? (
                                <>Pay <ThemedText style={styles.boldWhite}>{action.counterpartyName}</ThemedText></>
                              ) : (
                                <><ThemedText style={styles.boldWhite}>{action.counterpartyName}</ThemedText> owes you</>
                              )}
                            </ThemedText>
                            <ThemedText style={styles.actionGroupMeta}>
                              in {action.groupName}
                            </ThemedText>
                          </View>
                        </View>

                        <View style={styles.actionItemRight}>
                          <ThemedText
                            style={[
                              styles.actionAmount,
                              { color: action.type === 'owe' ? Brand.negative : Brand.positive },
                            ]}
                          >
                            {action.type === 'owe' ? `−${formatINR(action.amount)}` : `+${formatINR(action.amount)}`}
                          </ThemedText>
                          <ThemedText style={styles.actionChevron}>›</ThemedText>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* Recent Activity Stream (shown in Activity tab, or recent 3 in Overview) */}
              {activeTab === 'activity' ? (
                <View style={styles.activitySection}>
                  <ThemedText style={styles.sectionHeaderTitle}>Recent Activity</ThemedText>
                  <ThemedText style={styles.sectionHeaderSubtitle}>Recently updated groups</ThemedText>

                  {recentGroupActivity.length === 0 ? (
                    <ThemedView type="backgroundElement" style={styles.emptyStateCard}>
                      <ThemedText style={styles.emptyIcon}>✨</ThemedText>
                      <ThemedText style={styles.emptyTitle}>No activity yet</ThemedText>
                      <ThemedText style={styles.emptySub}>
                        Create or join a group to start logging expenses and tracking settlements.
                      </ThemedText>
                    </ThemedView>
                  ) : (
                    <View style={styles.activityCard}>
                      {recentGroupActivity.map((g, idx) => {
                        const rawDate = g.updatedAt || g.createdAt;
                        const formattedDate = rawDate
                          ? new Date(rawDate).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'Recently active';

                        return (
                          <TouchableOpacity
                            key={g.id}
                            style={[
                              styles.activityRow,
                              idx < recentGroupActivity.length - 1 && styles.itemSeparator,
                            ]}
                            onPress={() => handleGroupPress(g)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.activityAvatar}>
                              <ThemedText style={styles.activityAvatarText}>
                                {g.name.charAt(0).toUpperCase()}
                              </ThemedText>
                            </View>
                            <View style={styles.activityDetails}>
                              <ThemedText style={styles.activityGroupName}>{g.name}</ThemedText>
                              <ThemedText style={styles.activityMeta}>
                                {g.expenseCount} expense{g.expenseCount === 1 ? '' : 's'} · {formattedDate}
                              </ThemedText>
                            </View>
                            <ThemedText style={styles.activityChevron}>›</ThemedText>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : null}

              {/* Groups List as Simple Rows with Subtle Separators */}
              {activeTab === 'overview' || activeTab === 'groups' ? (
                <View style={styles.groupsSection}>
                  <View style={styles.groupsHeaderRow}>
                    <ThemedText style={styles.groupsSectionTitle}>
                      Your Groups ({groups.length})
                    </ThemedText>
                    <TouchableOpacity
                      onPress={handleCreateGroup}
                      activeOpacity={0.8}
                      style={styles.createGroupBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Create a new group"
                    >
                      <ThemedText style={styles.createGroupBtnText}>
                        + New Group
                      </ThemedText>
                    </TouchableOpacity>
                  </View>

                  {groupsLoading && groups.length === 0 ? (
                    <ThemedView type="backgroundElement" style={styles.stateCard}>
                      <ActivityIndicator size="large" color={Brand.primary} />
                      <ThemedText type="small" style={styles.stateSub}>
                        Loading groups from backend...
                      </ThemedText>
                    </ThemedView>
                  ) : groupsError && groups.length === 0 ? (
                    <ThemedView type="backgroundElement" style={styles.stateCard}>
                      <ThemedText type="smallBold">Couldn&apos;t load groups</ThemedText>
                      <ThemedText type="small" style={styles.stateSub}>
                        {groupsError}
                      </ThemedText>
                      <TouchableOpacity style={styles.retryBtn} onPress={() => refresh()} activeOpacity={0.8}>
                        <ThemedText style={styles.retryText}>Retry</ThemedText>
                      </TouchableOpacity>
                    </ThemedView>
                  ) : groups.length === 0 ? (
                    <ThemedView type="backgroundElement" style={styles.stateCard}>
                      <ThemedText style={styles.emptyIcon}>👥</ThemedText>
                      <ThemedText type="smallBold">No groups yet</ThemedText>
                      <ThemedText type="small" style={styles.stateSub}>
                        Tap + New Group above to create your first group and start sharing expenses.
                      </ThemedText>
                      <TouchableOpacity
                        style={styles.retryBtn}
                        onPress={() => router.push('/group/new')}
                        activeOpacity={0.8}
                      >
                        <ThemedText style={styles.retryText}>Create Group</ThemedText>
                      </TouchableOpacity>
                    </ThemedView>
                  ) : (
                    <ThemedView type="backgroundElement" style={styles.groupRowsCard}>
                      {groups.map((group) => (
                        <GroupCard
                          key={group.id}
                          group={group}
                          onPress={handleGroupPress}
                          variant="row"
                        />
                      ))}
                    </ThemedView>
                  )}
                </View>
              ) : null}
            </>
          ) : (
            /* Unauthenticated View — Action Buttons */
            <ThemedView type="backgroundElement" style={styles.guestActionCard}>
              <View style={styles.guestHero}>
                <Image
                  source={require('@/assets/images/icon-192.png')}
                  style={styles.guestLogo}
                  resizeMode="contain"
                  accessibilityLabel="LendLocal Logo"
                />
                <ThemedText type="title" style={styles.guestBrandTitle}>
                  LendLocal
                </ThemedText>
                <ThemedText type="small" style={styles.guestBrandTagline}>
                  Shared expenses and lending made simple
                </ThemedText>
              </View>

              <ThemedText type="smallBold" style={styles.guestTitle}>
                Get Started with Native Mobile
              </ThemedText>
              <ThemedText type="small" style={styles.guestSub}>
                Sign in with your existing LendLocal web account or register a new one to sync balances.
              </ThemedText>

              <View style={styles.authBtnRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={() => router.push('/(auth)/login')}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.btnPrimaryText}>Sign In</ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btn, styles.btnOutline]}
                  onPress={() => router.push('/(auth)/register')}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.btnOutlineText}>Create Account</ThemedText>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.guestServerBtn}
                onPress={() => setShowServerModal(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Server Connection Settings"
              >
                <ThemedText style={styles.guestServerBtnText}>
                  ⚙️ Server Connection Settings
                </ThemedText>
              </TouchableOpacity>
            </ThemedView>
          )}
        </ScrollView>

        <SettingsModal
          visible={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          user={user}
          isRefreshingUser={isRefreshingUser}
          onRefreshUser={() => refreshUser().catch(() => {})}
          onOpenUpiModal={handleOpenUpiFromSettings}
          onOpenServerModal={handleOpenServerFromSettings}
          onLogout={handleLogout}
          isLoggingOut={isLoggingOut}
        />

        <ServerConfigModal
          visible={showServerModal}
          onClose={() => setShowServerModal(false)}
        />

        <UpiConfigModal
          visible={showUpiModal}
          onClose={handleCloseUpiModal}
          initialUpiId={editingUpiId !== undefined ? editingUpiId : user?.upiId}
          onSuccess={handleUpiSuccess}
        />

        <NotificationInboxModal
          visible={showNotificationsModal}
          onClose={() => setShowNotificationsModal(false)}
          onUnreadCountChange={setUnreadNotificationsCount}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Surfaces.darkBg,
  },
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Surfaces.darkBg,
  },
  loadingText: {
    fontSize: 15,
    opacity: 0.8,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.three,
  },
  topHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    marginRight: Spacing.two,
  },
  headerLogo: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  greetingTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  greetingTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#F0F4F8',
    letterSpacing: -0.3,
  },
  greetingSub: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    fontSize: 16,
  },
  bellBadge: {
    marginTop: -22,
    marginRight: -22,
    alignSelf: 'flex-end',
    backgroundColor: Brand.primary,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  bellBadgeText: {
    color: '#030507',
    fontSize: 10,
    fontWeight: '800',
  },
  settingsGearBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsGearIcon: {
    fontSize: 16,
  },
  navTabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    gap: 2,
  },
  navTab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  navTabActive: {
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorderBright,
  },
  navTabText: {
    fontSize: 12,
    color: '#7A93A6',
    fontWeight: '600',
  },
  navTabTextActive: {
    color: Brand.primaryLight,
    fontWeight: '700',
  },
  netBalanceCard: {
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.one + 2,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  netCardOwed: {
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  netCardOwe: {
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  netCardSettled: {
    borderColor: Surfaces.darkBorder,
  },
  netCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  netBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
  },
  netBadgeText: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  netBadgeOwed: {
    backgroundColor: Brand.positiveDim,
  },
  netBadgeTextOwed: {
    color: Brand.positive,
    fontSize: 11,
    fontWeight: '700',
  },
  netBadgeOwe: {
    backgroundColor: Brand.negativeDim,
  },
  netBadgeTextOwe: {
    color: Brand.negative,
    fontSize: 11,
    fontWeight: '700',
  },
  netBadgeSettled: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  netBadgeTextSettled: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  netAmountContainer: {
    marginVertical: 2,
  },
  netCardAmount: {
    fontSize: 34,
    lineHeight: 44,
    fontWeight: '800',
    letterSpacing: -0.6,
    includeFontPadding: false,
    paddingVertical: 4,
  },
  netCardExplanation: {
    fontSize: 13,
    color: '#7A93A6',
    lineHeight: 18,
    marginTop: 2,
  },
  netLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  netLoadingText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  netCardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Surfaces.darkBorder,
    marginVertical: Spacing.two,
  },
  secondaryTotalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  secondaryCol: {
    flex: 1,
  },
  secondaryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  dotIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  secondaryLabel: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  secondaryValueOwed: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.positive,
  },
  secondaryValueOwe: {
    fontSize: 16,
    fontWeight: '700',
    color: Brand.negative,
  },
  secondaryVerticalDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: Surfaces.darkBorder,
    marginHorizontal: Spacing.three,
  },
  attentionSection: {
    gap: Spacing.two,
  },
  attentionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  attentionTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attentionIcon: {
    fontSize: 14,
  },
  attentionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  attentionCountBadge: {
    backgroundColor: Brand.warningDim,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  attentionCountText: {
    color: Brand.warning,
    fontSize: 11,
    fontWeight: '700',
  },
  attentionCard: {
    backgroundColor: Surfaces.darkCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    overflow: 'hidden',
  },
  attentionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  attentionItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  actionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionMainText: {
    fontSize: 14,
    color: '#CBD5E1',
  },
  boldWhite: {
    fontWeight: '700',
    color: '#F0F4F8',
  },
  actionGroupMeta: {
    fontSize: 11,
    color: '#7A93A6',
    marginTop: 2,
  },
  actionItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionChevron: {
    fontSize: 16,
    color: '#7A93A6',
  },
  itemSeparator: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Surfaces.darkBorder,
  },
  activitySection: {
    gap: Spacing.two,
  },
  sectionHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  sectionHeaderSubtitle: {
    fontSize: 13,
    color: '#7A93A6',
    marginTop: -Spacing.one,
  },
  activityCard: {
    backgroundColor: Surfaces.darkCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    overflow: 'hidden',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
  activityAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Surfaces.darkCardMid,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  activityAvatarText: {
    color: Brand.primaryLight,
    fontWeight: '700',
    fontSize: 14,
  },
  activityDetails: {
    flex: 1,
  },
  activityGroupName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  activityMeta: {
    fontSize: 12,
    color: '#7A93A6',
    marginTop: 2,
  },
  activityChevron: {
    fontSize: 16,
    color: '#7A93A6',
  },
  emptyStateCard: {
    backgroundColor: Surfaces.darkCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.one,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  emptySub: {
    fontSize: 13,
    color: '#7A93A6',
    textAlign: 'center',
    lineHeight: 18,
  },
  groupsSection: {
    gap: Spacing.two,
  },
  groupsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  groupsSectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  createGroupBtn: {
    backgroundColor: Brand.primary,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
  },
  createGroupBtnText: {
    color: '#030507',
    fontSize: 13,
    fontWeight: '700',
  },
  groupRowsCard: {
    backgroundColor: Surfaces.darkCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    overflow: 'hidden',
  },
  stateCard: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: Spacing.two,
    alignItems: 'center',
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: Spacing.half,
  },
  stateSub: {
    opacity: 0.7,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    marginTop: Spacing.one,
    backgroundColor: Brand.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  retryText: {
    color: '#030507',
    fontWeight: '700',
  },
  guestActionCard: {
    padding: Spacing.four,
    borderRadius: 18,
    gap: Spacing.three,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  guestHero: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  guestLogo: {
    width: 60,
    height: 60,
    borderRadius: 15,
  },
  guestBrandTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  guestBrandTagline: {
    color: '#94A3B8',
    textAlign: 'center',
  },
  guestTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  guestSub: {
    opacity: 0.75,
    lineHeight: 20,
    fontSize: 14,
  },
  authBtnRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnPrimary: {
    backgroundColor: Brand.primary,
  },
  btnPrimaryText: {
    color: '#030507',
    fontWeight: '700',
    fontSize: 15,
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: Brand.primary,
    backgroundColor: Brand.primaryDim,
  },
  btnOutlineText: {
    color: Brand.primaryLight,
    fontWeight: '700',
    fontSize: 15,
  },
  guestServerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    borderRadius: 10,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    marginTop: Spacing.one,
  },
  guestServerBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
});
