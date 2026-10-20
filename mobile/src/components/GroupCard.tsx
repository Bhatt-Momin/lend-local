import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { Spacing } from '../constants/theme';
import type { GroupSummary } from '../types/api';
import { BALANCE_COLORS, getBalanceLabel, getBalanceTone } from '../utils/format';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

interface GroupCardProps {
  group: GroupSummary;
  onPress: (group: GroupSummary) => void;
}

export function GroupCard({ group, onPress }: GroupCardProps) {
  const tone = getBalanceTone(group.myBalance);
  const balanceColor = BALANCE_COLORS[tone];
  const balanceText = getBalanceLabel(group.myBalance);

  return (
    <TouchableOpacity onPress={() => onPress(group)} activeOpacity={0.7}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.titleWrap}>
            <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
              {group.name}
            </ThemedText>
            {group.description ? (
              <ThemedText type="small" style={styles.description} numberOfLines={1}>
                {group.description}
              </ThemedText>
            ) : null}
          </View>
          {!group.isActiveMember ? (
            <View style={styles.historyBadge}>
              <ThemedText style={styles.historyText}>History</ThemedText>
            </View>
          ) : null}
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
              {group.settlements.length} settlement{group.settlements.length === 1 ? '' : 's'} in group
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
    borderRadius: Spacing.three,
    gap: Spacing.two,
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
  name: {
    fontSize: 16,
  },
  description: {
    opacity: 0.65,
    marginTop: 2,
  },
  historyBadge: {
    backgroundColor: '#F59E0B22',
    borderColor: '#F59E0B66',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  historyText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
  },
  meta: {
    opacity: 0.7,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  balance: {
    fontSize: 14,
    flexShrink: 1,
  },
  settlements: {
    opacity: 0.6,
    flexShrink: 1,
  },
});
