import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Brand, Spacing, Surfaces } from '../constants/theme';
import type { GroupSummary } from '../types/api';
import { BALANCE_COLORS, formatINR, getBalanceLabel, getBalanceTone } from '../utils/format';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

interface GroupCardProps {
  group: GroupSummary;
  onPress: (group: GroupSummary) => void;
  variant?: 'card' | 'row';
}

export function GroupCard({ group, onPress, variant = 'card' }: GroupCardProps) {
  const tone = getBalanceTone(group.myBalance);
  const balanceColor = BALANCE_COLORS[tone];
  const balanceText = getBalanceLabel(group.myBalance);

  if (variant === 'row') {
    return (
      <TouchableOpacity
        onPress={() => onPress(group)}
        activeOpacity={0.7}
        style={styles.rowContainer}
        accessibilityRole="button"
        accessibilityLabel={`Group ${group.name}. ${balanceText}. Tap to open.`}
      >
        <View style={styles.rowLeft}>
          <View style={[styles.rowAvatar, { borderColor: balanceColor }]}>
            <ThemedText style={styles.rowAvatarText}>
              {group.name.charAt(0).toUpperCase()}
            </ThemedText>
          </View>
          <View style={styles.rowDetails}>
            <View style={styles.rowTitleWrap}>
              <ThemedText type="smallBold" style={styles.rowName} numberOfLines={1}>
                {group.name}
              </ThemedText>
              {!group.isActiveMember ? (
                <View style={styles.historyBadgeSmall}>
                  <ThemedText style={styles.historyTextSmall}>History</ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText style={styles.rowMeta} numberOfLines={1}>
              {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · {group.expenseCount} expense{group.expenseCount === 1 ? '' : 's'}
            </ThemedText>
          </View>
        </View>

        <View style={styles.rowRight}>
          <ThemedText style={[styles.rowBalance, { color: balanceColor }]}>
            {tone === 'owed'
              ? `+${formatINR(group.myBalance)}`
              : tone === 'owe'
              ? `−${formatINR(Math.abs(group.myBalance))}`
              : 'Settled'}
          </ThemedText>
          <ThemedText style={styles.rowChevron}>›</ThemedText>
        </View>
      </TouchableOpacity>
    );
  }

  const borderAccentStyle =
    tone === 'owed'
      ? styles.cardOwed
      : tone === 'owe'
      ? styles.cardOwe
      : styles.cardSettled;

  return (
    <TouchableOpacity
      onPress={() => onPress(group)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Group ${group.name}. ${balanceText}. Tap to open.`}
    >
      <ThemedView type="backgroundElement" style={[styles.card, borderAccentStyle]}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <View style={styles.nameRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: balanceColor },
                ]}
              />
              <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
                {group.name}
              </ThemedText>
            </View>
            {group.description ? (
              <ThemedText type="small" style={styles.description} numberOfLines={1}>
                {group.description}
              </ThemedText>
            ) : null}
          </View>
          <View style={styles.headerRight}>
            {!group.isActiveMember ? (
              <View style={styles.historyBadge}>
                <ThemedText style={styles.historyText}>History</ThemedText>
              </View>
            ) : null}
            <ThemedText style={styles.chevron}>›</ThemedText>
          </View>
        </View>

        <View style={styles.metaRow}>
          <ThemedText type="small" style={styles.meta}>
            {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · {group.expenseCount} expense
            {group.expenseCount === 1 ? '' : 's'}
          </ThemedText>
        </View>

        <View style={styles.footerRow}>
          <ThemedText type="smallBold" style={[styles.balance, { color: balanceColor }]}>
            {balanceText}
          </ThemedText>
          {group.settlements?.length ? (
            <ThemedText type="small" style={styles.settlements}>
              {group.settlements.length} settlement{group.settlements.length === 1 ? '' : 's'}
            </ThemedText>
          ) : null}
        </View>
      </ThemedView>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: 16,
    gap: Spacing.two,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  cardOwed: {
    borderLeftWidth: 3,
    borderLeftColor: Brand.primary,
  },
  cardOwe: {
    borderLeftWidth: 3,
    borderLeftColor: Brand.negative,
  },
  cardSettled: {
    borderLeftWidth: 3,
    borderLeftColor: Surfaces.darkBorderBright,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  titleWrap: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  description: {
    opacity: 0.65,
    marginTop: 3,
    fontSize: 13,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  chevron: {
    fontSize: 20,
    color: '#7A93A6',
    lineHeight: 22,
    marginLeft: 2,
  },
  historyBadge: {
    backgroundColor: Brand.warningDim,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  historyText: {
    color: Brand.warning,
    fontSize: 11,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
  },
  meta: {
    opacity: 0.7,
    fontSize: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Surfaces.darkBorder,
  },
  balance: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  settlements: {
    opacity: 0.6,
    fontSize: 12,
    flexShrink: 1,
  },
  rowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two + 4,
    paddingHorizontal: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Surfaces.darkBorder,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
    marginRight: Spacing.two,
  },
  rowAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowAvatarText: {
    color: '#F0F4F8',
    fontSize: 15,
    fontWeight: '800',
  },
  rowDetails: {
    flex: 1,
  },
  rowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
  },
  rowMeta: {
    fontSize: 12,
    color: '#7A93A6',
    marginTop: 2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowBalance: {
    fontSize: 14,
    fontWeight: '700',
  },
  rowChevron: {
    fontSize: 18,
    color: '#7A93A6',
  },
  historyBadgeSmall: {
    backgroundColor: Brand.warningDim,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  historyTextSmall: {
    color: Brand.warning,
    fontSize: 10,
    fontWeight: '700',
  },
});
