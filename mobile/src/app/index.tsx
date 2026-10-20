import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
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
import { ServerConfigModal } from '../components/ServerConfigModal';
import { UpiConfigModal } from '../components/UpiConfigModal';
import { ThemedText } from '../components/themed-text';
import { ThemedView } from '../components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { useGroups } from '../hooks/useGroups';
import type { GroupSummary } from '../types/api';
import { formatINR } from '../utils/format';

export default function HomeScreen() {
  const router = useRouter();
  const { user, isLoading, isRefreshingUser, logout, refreshUser } = useAuth();
  const [showServerModal, setShowServerModal] = useState(false);
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const groupsEnabled = !!user && !isLoading;
  const { groups, isLoading: groupsLoading, isRefreshing, error: groupsError, refresh, refreshOnFocus } =
    useGroups(groupsEnabled, { onUnauthorized: logout });

  useFocusEffect(
    useCallback(() => {
      if (groupsEnabled) {
        refreshOnFocus();
        refreshUser().catch((err) => {
          console.warn('Dashboard focus user refresh failed:', err?.message);
        });
      }
    }, [groupsEnabled, refreshOnFocus, refreshUser])
  );

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([refresh(), refreshUser()]);
  }, [refresh, refreshUser]);

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
    return { owedToMe, iOwe };
  }, [groups]);

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
        <ActivityIndicator size="large" color="#2563EB" />
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
              <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#2563EB" />
            ) : undefined
          }
        >
          {/* Brand Header */}
          <View style={styles.heroSection}>
            <Image
              source={require('@/assets/images/icon-192.png')}
              style={styles.logoImage}
              resizeMode="contain"
              accessibilityLabel="LendLocal Logo"
            />
            <ThemedText type="title" style={styles.brandTitle}>
              LendLocal
            </ThemedText>
            <ThemedText type="small" style={styles.brandTagline}>
              Shared expenses and lending made simple
            </ThemedText>
          </View>

          {user ? (
            <>
              {/* Dashboard header */}
              <ThemedView type="backgroundElement" style={styles.authProfileCard}>
                <View style={styles.userHeaderRow}>
                  <View style={styles.avatarBadge}>
                    <ThemedText style={styles.avatarText}>
                      {user.name.charAt(0).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.userHeaderText}>
                    <ThemedText type="smallBold" style={styles.userName} numberOfLines={1}>
                      {user.name}
                    </ThemedText>
                    <ThemedText type="small" style={styles.userEmail} numberOfLines={1}>
                      {user.email}
                    </ThemedText>
                  </View>
                  <TouchableOpacity onPress={() => setShowServerModal(true)}>
                    <ThemedText type="smallBold" style={styles.editLink}>
                      Server
                    </ThemedText>
                  </TouchableOpacity>
                </View>

                {/* Direct UPI ID Profile Setting */}
                <TouchableOpacity
                  style={styles.upiRow}
                  onPress={() => {
                    if (user.upiId === undefined && !isRefreshingUser) {
                      refreshUser().catch(() => {});
                    } else {
                      setShowUpiModal(true);
                    }
                  }}
                  onLongPress={() => setShowUpiModal(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={
                    user.upiId
                      ? `UPI ID: ${user.upiId}. Tap to edit.`
                      : user.upiId === null
                      ? 'UPI ID not set. Tap to configure.'
                      : isRefreshingUser
                      ? 'Checking UPI ID status.'
                      : 'UPI ID status unknown. Tap to retry loading.'
                  }
                >
                  <View style={styles.upiInfo}>
                    <ThemedText type="small" style={styles.upiLabel}>
                      UPI ID (for receiving payments)
                    </ThemedText>
                    <ThemedText
                      type="smallBold"
                      style={[styles.upiValue, !user.upiId && styles.upiNotSet]}
                      numberOfLines={1}
                    >
                      {user.upiId
                        ? user.upiId
                        : user.upiId === null
                        ? 'Not configured (tap to set)'
                        : isRefreshingUser
                        ? 'Checking status...'
                        : 'Status unknown (tap to retry)'}
                    </ThemedText>
                  </View>
                  <ThemedText
                    type="smallBold"
                    style={styles.upiEditBtn}
                    onPress={() => {
                      if (user.upiId === undefined && !isRefreshingUser) {
                        refreshUser().catch(() => {});
                      } else {
                        setShowUpiModal(true);
                      }
                    }}
                  >
                    {user.upiId
                      ? 'Edit'
                      : user.upiId === null
                      ? '+ Set'
                      : isRefreshingUser
                      ? '...'
                      : 'Retry'}
                  </ThemedText>
                </TouchableOpacity>

                <View style={styles.summaryRow}>
                  <View style={styles.summaryBox}>
                    <ThemedText type="small" style={styles.summaryLabel}>
                      Net owed to you
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.summaryOwed}>
                      {formatINR(totals.owedToMe)}
                    </ThemedText>
                  </View>
                  <View style={styles.summaryBox}>
                    <ThemedText type="small" style={styles.summaryLabel}>
                      Net you owe
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.summaryOwe}>
                      {formatINR(totals.iOwe)}
                    </ThemedText>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.logoutBtn}
                  onPress={handleLogout}
                  disabled={isLoggingOut}
                  activeOpacity={0.8}
                >
                  {isLoggingOut ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <ThemedText style={styles.logoutBtnText}>Sign Out</ThemedText>
                  )}
                </TouchableOpacity>
              </ThemedView>

              {/* Groups dashboard */}
              <View style={styles.sectionHeaderRow}>
                <ThemedText type="smallBold" style={styles.sectionTitle}>
                  Your Groups ({groups.length})
                </ThemedText>
                <TouchableOpacity onPress={handleCreateGroup} activeOpacity={0.8}>
                  <ThemedText type="smallBold" style={styles.createLink}>
                    + New
                  </ThemedText>
                </TouchableOpacity>
              </View>

              {groupsLoading ? (
                <ThemedView type="backgroundElement" style={styles.stateCard}>
                  <ActivityIndicator size="large" color="#2563EB" />
                  <ThemedText type="small" style={styles.stateSub}>
                    Loading groups from backend...
                  </ThemedText>
                </ThemedView>
              ) : groupsError ? (
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
                  <ThemedText type="smallBold">No groups yet</ThemedText>
                  <ThemedText type="small" style={styles.stateSub}>
                    Tap + New above to create your first group and start sharing expenses.
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
                <View style={styles.groupList}>
                  {groups.map((group) => (
                    <GroupCard key={group.id} group={group} onPress={handleGroupPress} />
                  ))}
                </View>
              )}
            </>
          ) : (
            /* Unauthenticated View — Action Buttons */
            <ThemedView type="backgroundElement" style={styles.guestActionCard}>
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
            </ThemedView>
          )}
        </ScrollView>

        <ServerConfigModal
          visible={showServerModal}
          onClose={() => setShowServerModal(false)}
        />

        <UpiConfigModal
          visible={showUpiModal}
          onClose={() => setShowUpiModal(false)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.three,
  },
  loadingText: {
    fontSize: 15,
    opacity: 0.8,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.three,
  },
  heroSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  logoImage: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: Spacing.one,
  },
  brandTitle: {
    textAlign: 'center',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
  },
  brandTagline: {
    textAlign: 'center',
    opacity: 0.75,
  },
  authProfileCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#3B82F640',
  },
  userHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  avatarBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  userHeaderText: {
    flex: 1,
  },
  userName: {
    fontSize: 17,
  },
  userEmail: {
    opacity: 0.75,
  },
  upiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A2B',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
    borderWidth: 1,
    borderColor: '#33415566',
  },
  upiInfo: {
    flex: 1,
    marginRight: Spacing.two,
  },
  upiLabel: {
    opacity: 0.65,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  upiValue: {
    color: '#38BDF8',
    fontSize: 13,
    marginTop: 1,
  },
  upiNotSet: {
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  upiEditBtn: {
    color: '#3B82F6',
    fontSize: 13,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  summaryBox: {
    flex: 1,
    backgroundColor: '#0F172A0D',
    borderRadius: 12,
    padding: Spacing.three,
    gap: 4,
  },
  summaryLabel: {
    opacity: 0.7,
  },
  summaryOwed: {
    color: '#10B981',
    fontSize: 15,
  },
  summaryOwe: {
    color: '#EF4444',
    fontSize: 15,
  },
  logoutBtn: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#EF444466',
    backgroundColor: '#EF444414',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  logoutBtnText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 14,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  sectionTitle: {
    fontSize: 16,
  },
  createLink: {
    color: '#2563EB',
    fontSize: 14,
  },
  stateCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
  stateSub: {
    opacity: 0.7,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: Spacing.one,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
  },
  groupList: {
    gap: Spacing.two,
  },
  guestActionCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  guestTitle: {
    fontSize: 16,
  },
  guestSub: {
    opacity: 0.75,
    lineHeight: 19,
  },
  authBtnRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnPrimary: {
    backgroundColor: '#2563EB',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  btnOutlineText: {
    color: '#3B82F6',
    fontWeight: '700',
    fontSize: 15,
  },
  editLink: {
    color: '#3B82F6',
    fontSize: 13,
  },
});
