import { useRouter, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * Phase 2 placeholder for the Group Detail / Ledger screen.
 * Phase 3 will load `groupsApi.getById`, expenses, and balances here.
 */
export default function GroupDetailPlaceholder() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ThemedText type="title" style={styles.title}>
          Group
        </ThemedText>
        <ThemedText type="small" style={styles.sub} numberOfLines={2}>
          ID: {id ?? 'unknown'}
        </ThemedText>
        <ThemedText type="small" style={styles.sub}>
          Expense ledger, balances, and settlements land here in Phase 3.
        </ThemedText>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <ThemedText style={styles.backText}>Back to Dashboard</ThemedText>
        </TouchableOpacity>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 28, textAlign: 'center' },
  sub: { opacity: 0.7, textAlign: 'center' },
  backBtn: {
    marginTop: Spacing.two,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#fff', fontWeight: '700' },
});
