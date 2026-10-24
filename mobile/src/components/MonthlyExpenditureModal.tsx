import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Brand, Spacing, Surfaces } from '../constants/theme';
import { expensesApi } from '../services/expensesApi';
import type { MonthlyAnalyticsResponse } from '../types/api';
import { getCategoryIcon } from '../utils/expenseForm';
import { formatINR } from '../utils/format';

export interface MonthlyExpenditureModalProps {
  visible: boolean;
  onClose: () => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function MonthlyExpenditureModal({ visible, onClose }: MonthlyExpenditureModalProps) {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [data, setData] = useState<MonthlyAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Future-month navigation lock
  const isCurrentOrFutureMonth = useMemo(() => {
    const curYear = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    return year > curYear || (year === curYear && month >= curMonth);
  }, [year, month, now]);

  const loadData = useCallback(async (targetYear: number, targetMonth: number) => {
    const currentReqId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const res = await expensesApi.getMonthlyAnalytics(targetYear, targetMonth);
      if (currentReqId === requestIdRef.current) {
        setData(res);
      }
    } catch (err: any) {
      if (currentReqId === requestIdRef.current) {
        setError(err?.message || 'Failed to load monthly expenditure');
      }
    } finally {
      if (currentReqId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (visible) {
      const curYear = now.getFullYear();
      const curMonth = now.getMonth() + 1;
      setYear(curYear);
      setMonth(curMonth);
      loadData(curYear, curMonth);
    } else {
      requestIdRef.current += 1;
      setData(null);
      setError(null);
    }
  }, [visible, now, loadData]);

  const handlePrevMonth = () => {
    let nextY = year;
    let nextM = month - 1;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    }
    setYear(nextY);
    setMonth(nextM);
    loadData(nextY, nextM);
  };

  const handleNextMonth = () => {
    if (isCurrentOrFutureMonth) return;
    let nextY = year;
    let nextM = month + 1;
    if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    setYear(nextY);
    setMonth(nextM);
    loadData(nextY, nextM);
  };

  const monthLabel = useMemo(() => {
    return `${MONTH_NAMES[month - 1].slice(0, 3)} ${year}`;
  }, [year, month]);

  const comparisonBadge = useMemo(() => {
    if (!data?.primaryMetric) return null;
    const pct = data.primaryMetric.percentageChange;
    if (pct !== null && pct !== undefined) {
      const sign = pct > 0 ? '+' : '';
      const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
      const isHigher = pct > 0;
      return {
        text: `${arrow} ${sign}${pct}% vs last month`,
        color: isHigher ? '#F59E0B' : Brand.positive,
        bg: isHigher ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)',
      };
    }
    if (data.primaryMetric.amount > 0 && !data.primaryMetric.previousMonthAmount) {
      return {
        text: 'First month recorded',
        color: Brand.primary,
        bg: 'rgba(16, 185, 129, 0.12)',
      };
    }
    return {
      text: 'No prior data',
      color: '#94A3B8',
      bg: 'rgba(255, 255, 255, 0.05)',
    };
  }, [data]);

  const maxTrendAmount = useMemo(() => {
    if (!data?.dailyTrend || data.dailyTrend.length === 0) return 0;
    return data.dailyTrend.reduce((max, d) => Math.max(max, d.amount), 0);
  }, [data?.dailyTrend]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss monthly expenditure"
        />
        <View style={styles.dialog}>
          {/* Header */}
          <View style={styles.dialogHeader}>
            <View style={styles.headerTitleWrap}>
              <ThemedText style={styles.headerIcon}>💳</ThemedText>
              <ThemedText style={styles.dialogTitle}>Monthly expenditure</ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close monthly expenditure modal"
              activeOpacity={0.7}
            >
              <ThemedText style={styles.closeBtnText}>×</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Month Selector Bar */}
          <View style={styles.monthNavRow}>
            <TouchableOpacity
              style={styles.monthNavBtn}
              onPress={handlePrevMonth}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
            >
              <ThemedText style={styles.monthNavArrow}>←</ThemedText>
            </TouchableOpacity>

            <ThemedText style={styles.monthLabel}>{monthLabel}</ThemedText>

            <TouchableOpacity
              style={[styles.monthNavBtn, isCurrentOrFutureMonth && styles.monthNavBtnDisabled]}
              onPress={handleNextMonth}
              disabled={isCurrentOrFutureMonth}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Next month"
            >
              <ThemedText style={[styles.monthNavArrow, isCurrentOrFutureMonth && styles.monthNavArrowDisabled]}>
                →
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Main Scrollable Content */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={Brand.primary} />
                <ThemedText style={styles.loadingText}>Loading monthly expenditure...</ThemedText>
              </View>
            ) : error ? (
              <View style={styles.errorBox}>
                <ThemedText style={styles.errorIcon}>⚠️</ThemedText>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => loadData(year, month)}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.retryBtnText}>Retry</ThemedText>
                </TouchableOpacity>
              </View>
            ) : data ? (
              <>
                {/* Primary Allocated Expense Share Card */}
                <ThemedView type="backgroundElement" style={styles.primaryCard}>
                  <ThemedText style={styles.primaryCardLabel}>YOUR ALLOCATED EXPENSE SHARE</ThemedText>
                  <ThemedText style={styles.primaryAmount}>
                    {formatINR(data.primaryMetric?.amount || 0)}
                  </ThemedText>
                  <ThemedText style={styles.primarySub}>
                    Exact personal share across your active groups this month.
                  </ThemedText>

                  {comparisonBadge ? (
                    <View style={[styles.badgeWrap, { backgroundColor: comparisonBadge.bg }]}>
                      <ThemedText style={[styles.badgeText, { color: comparisonBadge.color }]}>
                        {comparisonBadge.text}
                      </ThemedText>
                    </View>
                  ) : null}
                </ThemedView>

                {/* Secondary Metrics Row */}
                <View style={styles.secondaryGrid}>
                  <View style={styles.secondaryTile}>
                    <ThemedText style={styles.secondaryTileLabel}>Personally paid</ThemedText>
                    <ThemedText style={styles.secondaryTileValue}>
                      {formatINR(data.secondaryMetrics?.personallyPaid || 0)}
                    </ThemedText>
                  </View>

                  <View style={styles.secondaryTile}>
                    <ThemedText style={styles.secondaryTileLabel}>You owe</ThemedText>
                    <ThemedText style={[styles.secondaryTileValue, { color: Brand.negative }]}>
                      {formatINR(data.secondaryMetrics?.netOwedToOthers || 0)}
                    </ThemedText>
                  </View>

                  <View style={styles.secondaryTile}>
                    <ThemedText style={styles.secondaryTileLabel}>Owed to you</ThemedText>
                    <ThemedText style={[styles.secondaryTileValue, { color: Brand.positive }]}>
                      {formatINR(data.secondaryMetrics?.netOwedToUser || 0)}
                    </ThemedText>
                  </View>
                </View>

                {/* Category Distribution */}
                <View style={styles.sectionWrap}>
                  <ThemedText style={styles.sectionTitle}>Category breakdown</ThemedText>
                  {data.categoryBreakdown.length === 0 ? (
                    <ThemedText style={styles.emptyNotice}>No spending categories recorded.</ThemedText>
                  ) : (
                    <View style={styles.catList}>
                      {data.categoryBreakdown.map((cat, idx) => (
                        <View key={`${cat.category}_${idx}`} style={styles.catRow}>
                          <View style={styles.catTopRow}>
                            <View style={styles.catLeft}>
                              <ThemedText style={styles.catEmoji}>
                                {getCategoryIcon(cat.category)}
                              </ThemedText>
                              <ThemedText style={styles.catName}>{cat.category}</ThemedText>
                            </View>
                            <ThemedText style={styles.catAmount}>
                              {formatINR(cat.amount)}{' '}
                              <ThemedText style={styles.catPct}>({cat.percentage}%)</ThemedText>
                            </ThemedText>
                          </View>
                          <View style={styles.catBarBg}>
                            <View
                              style={[
                                styles.catBarFill,
                                { width: `${Math.min(100, Math.max(2, cat.percentage))}%` },
                              ]}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Daily Spending Trend */}
                {maxTrendAmount > 0 && data.dailyTrend.length > 0 ? (
                  <View style={styles.sectionWrap}>
                    <ThemedText style={styles.sectionTitle}>Daily activity trend</ThemedText>
                    <View style={styles.chartContainer}>
                      <View style={styles.barsRow}>
                        {data.dailyTrend.map((d) => {
                          const heightPct = Math.round((d.amount / maxTrendAmount) * 100);
                          const isZero = d.amount === 0;
                          return (
                            <View key={`day_${d.day}`} style={styles.barCol}>
                              <View
                                style={[
                                  styles.bar,
                                  {
                                    height: isZero ? 4 : Math.max(8, heightPct),
                                    backgroundColor: isZero
                                      ? 'rgba(255, 255, 255, 0.08)'
                                      : Brand.primary,
                                  },
                                ]}
                              />
                            </View>
                          );
                        })}
                      </View>
                      <View style={styles.chartLabelsRow}>
                        <ThemedText style={styles.chartLabel}>Day 1</ThemedText>
                        <ThemedText style={styles.chartLabel}>Day {data.dailyTrend.length}</ThemedText>
                      </View>
                    </View>
                  </View>
                ) : null}

                {/* Monthly Expenses Feed */}
                <View style={styles.sectionWrap}>
                  <ThemedText style={styles.sectionTitle}>
                    Expenses in {monthLabel} ({data.recentExpenses.length})
                  </ThemedText>
                  {data.recentExpenses.length === 0 ? (
                    <ThemedView type="backgroundElement" style={styles.emptyNoticeCard}>
                      <ThemedText style={styles.emptyNoticeIcon}>🧾</ThemedText>
                      <ThemedText style={styles.emptyNoticeTitle}>No expenses found</ThemedText>
                      <ThemedText style={styles.emptyNoticeSub}>
                        No group expenses were logged during this month.
                      </ThemedText>
                    </ThemedView>
                  ) : (
                    <View style={styles.expenseFeed}>
                      {data.recentExpenses.map((ex) => {
                        const dateStr = new Date(ex.date).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        });
                        return (
                          <View key={ex.id} style={styles.expenseCard}>
                            <View style={styles.expenseLeft}>
                              <View style={styles.expenseIconWrap}>
                                <ThemedText style={styles.expenseEmoji}>
                                  {getCategoryIcon(ex.category)}
                                </ThemedText>
                              </View>
                              <View style={styles.expenseMetaWrap}>
                                <ThemedText style={styles.expenseTitle} numberOfLines={1}>
                                  {ex.description}
                                </ThemedText>
                                <ThemedText style={styles.expenseMeta} numberOfLines={1}>
                                  {ex.groupName} • {dateStr}
                                </ThemedText>
                              </View>
                            </View>
                            <View style={styles.expenseRight}>
                              <ThemedText style={styles.expenseShareAmount}>
                                {formatINR(ex.userShare > 0 ? ex.userShare : ex.totalAmount)}
                              </ThemedText>
                              <ThemedText
                                style={[
                                  styles.expenseShareLabel,
                                  ex.isPayer ? styles.payerTag : styles.shareTag,
                                ]}
                              >
                                {ex.isPayer ? `You paid ${formatINR(ex.totalAmount)}` : `Your share: ${formatINR(ex.userShare)}`}
                              </ThemedText>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'flex-end',
  },
  dialog: {
    backgroundColor: '#0A0E14',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 16,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIcon: {
    fontSize: 20,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 20,
    color: '#94A3B8',
    lineHeight: 22,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  monthNavBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  monthNavBtnDisabled: {
    opacity: 0.35,
  },
  monthNavArrow: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  monthNavArrowDisabled: {
    color: '#64748B',
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  scrollArea: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingTop: 12,
    paddingBottom: 32,
    gap: 14,
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#94A3B8',
  },
  errorBox: {
    padding: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    alignItems: 'center',
    gap: 8,
  },
  errorIcon: {
    fontSize: 26,
  },
  errorText: {
    fontSize: 14,
    color: '#F87171',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Brand.primary,
    borderRadius: 8,
  },
  retryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  primaryCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    alignItems: 'flex-start',
  },
  primaryCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  primaryAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  primarySub: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 16,
    marginBottom: 10,
  },
  badgeWrap: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  secondaryGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryTile: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  secondaryTileLabel: {
    fontSize: 10,
    color: '#94A3B8',
    marginBottom: 4,
  },
  secondaryTileValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionWrap: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  emptyNotice: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
  catList: {
    gap: 8,
  },
  catRow: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    gap: 6,
  },
  catTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  catLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  catEmoji: {
    fontSize: 15,
  },
  catName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  catAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  catPct: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '400',
  },
  catBarBg: {
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  catBarFill: {
    height: '100%',
    backgroundColor: Brand.primary,
    borderRadius: 99,
  },
  chartContainer: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  barsRow: {
    height: 70,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingBottom: 4,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderRadius: 2,
  },
  chartLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  chartLabel: {
    fontSize: 10,
    color: '#64748B',
  },
  emptyNoticeCard: {
    padding: 24,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    gap: 6,
  },
  emptyNoticeIcon: {
    fontSize: 28,
  },
  emptyNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyNoticeSub: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
  },
  expenseFeed: {
    gap: 8,
  },
  expenseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  expenseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  expenseIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expenseEmoji: {
    fontSize: 16,
  },
  expenseMetaWrap: {
    flex: 1,
    minWidth: 0,
  },
  expenseTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  expenseMeta: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  expenseRight: {
    alignItems: 'flex-end',
    marginLeft: 8,
  },
  expenseShareAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  expenseShareLabel: {
    fontSize: 10,
    marginTop: 2,
  },
  payerTag: {
    color: Brand.positive,
  },
  shareTag: {
    color: '#94A3B8',
  },
});
