import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { MaxContentWidth, Spacing } from '../constants/theme';
import type { CreateExpensePayload, ExpenseItem, GroupDetail, UpdateExpensePayload } from '../types/api';
import {
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  buildCustomExpensePayload,
  buildEqualExpensePayload,
  buildEqualPreview,
  hasDepartedSplitParticipants,
  parseAmountToPaise,
  validateCustomSplits,
} from '../utils/expenseForm';
import { formatINR } from '../utils/format';

export interface ExpenseModalProps {
  visible: boolean;
  onClose: () => void;
  group: GroupDetail;
  currentUserId?: string | null;
  onSubmit: (payload: CreateExpensePayload) => Promise<any>;
  onUpdate?: (id: string, payload: UpdateExpensePayload) => Promise<any>;
  isMutating?: boolean;
  expenseToEdit?: ExpenseItem | null;
}

export function ExpenseModal({
  visible,
  onClose,
  group,
  currentUserId,
  onSubmit,
  onUpdate,
  isMutating = false,
  expenseToEdit = null,
}: ExpenseModalProps) {
  const isEditMode = Boolean(expenseToEdit);
  const [description, setDescription] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [category, setCategory] = useState<string>('General');
  const [dateInput, setDateInput] = useState<string>('');
  const [paidBy, setPaidBy] = useState<string>('');
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [customSplits, setCustomSplits] = useState<Array<{ user: string; share: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Active group members list
  const members = useMemo(() => group?.members ?? [], [group?.members]);
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);

  // Check if existing expense has any participants who departed
  const hasDeparted = useMemo(() => {
    if (!expenseToEdit) return false;
    return hasDepartedSplitParticipants(expenseToEdit.splits, memberIds);
  }, [expenseToEdit, memberIds]);

  // Reset & initialize form state on modal open
  useEffect(() => {
    if (!visible) return;

    setFormError(null);
    setIsSubmitting(false);

    if (expenseToEdit) {
      // EDIT MODE: Prepopulate existing values
      setDescription(expenseToEdit.description || '');
      setAmountInput(String(expenseToEdit.amount || ''));
      setCategory(expenseToEdit.category || 'General');

      // Preserve existing date (formatted to YYYY-MM-DD)
      const rawDate = expenseToEdit.date;
      if (rawDate) {
        const d = new Date(rawDate);
        setDateInput(!isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
      } else {
        setDateInput(new Date().toISOString().slice(0, 10));
      }

      // Preserve original payer if valid active member; do NOT switch to current user
      const origPayerId = expenseToEdit.paidBy?.id ?? (typeof expenseToEdit.paidBy === 'string' ? expenseToEdit.paidBy : '');
      const payerIsMember = origPayerId && members.some((m) => m.id === origPayerId);
      if (payerIsMember) {
        setPaidBy(origPayerId);
      } else {
        const currentIsMember = currentUserId && members.some((m) => m.id === currentUserId);
        setPaidBy(currentIsMember ? currentUserId! : (members[0]?.id || ''));
      }

      // Prepopulate split type and splits
      if (expenseToEdit.splitType === 'custom') {
        setSplitType('custom');
        const preSplits = (expenseToEdit.splits || []).map((s) => ({
          user: typeof s.user === 'object' && s.user ? s.user.id! : String(s.user || ''),
          share: typeof s.share === 'number' ? (s.share % 1 === 0 ? s.share.toString() : s.share.toFixed(2)) : String(s.share ?? ''),
        }));
        setCustomSplits(preSplits);
        setSelectedParticipants(
          preSplits.map((s) => s.user).filter((id) => members.some((m) => m.id === id))
        );
      } else {
        setSplitType('equal');
        setCustomSplits(members.map((m) => ({ user: m.id, share: '' })));
        if (Array.isArray(expenseToEdit.splits) && expenseToEdit.splits.length > 0) {
          const participantIds = expenseToEdit.splits
            .map((s) => (typeof s.user === 'object' && s.user ? s.user.id : String(s.user || '')))
            .filter((id): id is string => Boolean(id) && members.some((m) => m.id === id));

          setSelectedParticipants(participantIds.length > 0 ? participantIds : members.map((m) => m.id));
        } else {
          setSelectedParticipants(members.map((m) => m.id));
        }
      }
    } else {
      // CREATE MODE: Default values
      setDescription('');
      setAmountInput('');
      setCategory('General');
      setDateInput(new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
      setSplitType('equal');
      setCustomSplits(members.map((m) => ({ user: m.id, share: '' })));

      // Default payer to current authenticated user if active member; else first member
      const currentIsMember = currentUserId && members.some((m) => m.id === currentUserId);
      setPaidBy(currentIsMember ? currentUserId! : (members[0]?.id || ''));

      // Default all active group members selected
      setSelectedParticipants(members.map((m) => m.id));
    }
  }, [visible, expenseToEdit, currentUserId, members]);

  // Live amount parsing
  const parsedAmount = useMemo(() => parseAmountToPaise(amountInput), [amountInput]);

  // Live equal-split calculation
  const equalPreview = useMemo(() => {
    if (splitType !== 'equal' || !parsedAmount.valid || parsedAmount.paise <= 0 || selectedParticipants.length === 0) {
      return null;
    }
    return buildEqualPreview(parsedAmount.paise, selectedParticipants);
  }, [splitType, parsedAmount, selectedParticipants]);

  // Live custom-split calculation and validation
  const currentAllocatedPaise = useMemo(() => {
    if (splitType !== 'custom') return 0;
    return customSplits
      .filter((s) => selectedParticipants.includes(s.user))
      .reduce((sum, item) => {
        const trimmed = String(item.share ?? '').trim();
        if (!trimmed || !/^\d+(\.\d+)?$/.test(trimmed)) return sum;
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) return sum;
        return sum + Math.round(n * 100);
      }, 0);
  }, [splitType, customSplits, selectedParticipants]);

  const currentRemainingPaise = (parsedAmount.valid ? parsedAmount.paise : 0) - currentAllocatedPaise;

  const liveCustomValidation = useMemo(() => {
    if (splitType !== 'custom' || !parsedAmount.valid || parsedAmount.paise <= 0) {
      return null;
    }
    const activeSplits = customSplits.filter((s) => selectedParticipants.includes(s.user));
    return validateCustomSplits(activeSplits, parsedAmount.paise, memberIds);
  }, [splitType, customSplits, selectedParticipants, parsedAmount, memberIds]);

  const handleSwitchToCustom = () => {
    setFormError(null);
    setSplitType('custom');

    // If custom shares are empty and amount is valid, pre-populate with equal split
    const hasExistingShares = customSplits.some(
      (s) => selectedParticipants.includes(s.user) && String(s.share).trim() !== ''
    );
    if (!hasExistingShares && parsedAmount.valid && parsedAmount.paise > 0 && selectedParticipants.length > 0) {
      const preview = buildEqualPreview(parsedAmount.paise, selectedParticipants);
      if (preview.valid) {
        setCustomSplits((prev) =>
          members.map((m) => {
            const match = preview.splits.find((s) => s.user === m.id);
            return {
              user: m.id,
              share: match ? match.share.toFixed(2) : (prev.find((p) => p.user === m.id)?.share ?? ''),
            };
          })
        );
      }
    }
  };

  const handleSplitEvenly = () => {
    if (!parsedAmount.valid || parsedAmount.paise <= 0 || selectedParticipants.length === 0) return;
    const preview = buildEqualPreview(parsedAmount.paise, selectedParticipants);
    if (preview.valid) {
      setCustomSplits((prev) =>
        members.map((m) => {
          const match = preview.splits.find((s) => s.user === m.id);
          return {
            user: m.id,
            share: match ? match.share.toFixed(2) : (prev.find((p) => p.user === m.id)?.share ?? ''),
          };
        })
      );
    }
  };

  const handleCustomShareChange = (userId: string, val: string) => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    setCustomSplits((prev) => {
      const exists = prev.some((s) => s.user === userId);
      if (exists) {
        return prev.map((s) => (s.user === userId ? { ...s, share: val } : s));
      }
      return [...prev, { user: userId, share: val }];
    });
  };

  const handleToggleParticipant = (memberId: string) => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    setSelectedParticipants((prev) => {
      if (prev.includes(memberId)) {
        return prev.filter((id) => id !== memberId);
      }
      return [...prev, memberId];
    });
  };

  const handleSelectAllParticipants = () => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    if (selectedParticipants.length === members.length) {
      const fallback = members.find((m) => m.id === paidBy)?.id || members[0]?.id;
      setSelectedParticipants(fallback ? [fallback] : []);
    } else {
      setSelectedParticipants(members.map((m) => m.id));
    }
  };

  const handleResetDateToday = () => {
    setDateInput(new Date().toISOString().slice(0, 10));
  };

  const handleClose = () => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (isSubmitting || isMutating || hasDeparted) return;

    let validation: { valid: boolean; payload?: CreateExpensePayload; error?: string };

    if (splitType === 'custom') {
      const activeSplits = customSplits.filter((s) => selectedParticipants.includes(s.user));
      validation = buildCustomExpensePayload({
        groupId: group.id,
        description,
        amountInput,
        paidBy,
        customSplits: activeSplits,
        category,
        dateInput,
        validMemberIds: memberIds,
      });
    } else {
      validation = buildEqualExpensePayload({
        groupId: group.id,
        description,
        amountInput,
        paidBy,
        selectedParticipants,
        category,
        dateInput,
        validMemberIds: memberIds,
      });
    }

    if (!validation.valid || !validation.payload) {
      setFormError(validation.error || 'Please check your inputs');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (isEditMode && expenseToEdit && onUpdate) {
        await onUpdate(expenseToEdit.id, {
          description: validation.payload.description,
          amount: validation.payload.amount,
          paidBy: validation.payload.paidBy,
          splitType: validation.payload.splitType,
          splits: validation.payload.splits,
          category: validation.payload.category,
          date: validation.payload.date,
        });
      } else {
        await onSubmit(validation.payload);
      }
      onClose();
    } catch (err: any) {
      if (err?.isRefreshFailure) {
        onClose();
        Alert.alert(
          isEditMode ? 'Expense Updated' : 'Expense Saved',
          `Your expense was ${isEditMode ? 'updated' : 'recorded'} on the server, but updating the group ledger failed. Please pull down to refresh.`
        );
        return;
      }
      setFormError(err?.message || (isEditMode ? 'Failed to update expense' : 'Failed to save expense'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isBusy = isSubmitting || isMutating;

  const isCustomInvalid =
    splitType === 'custom' &&
    (!parsedAmount.valid ||
      parsedAmount.paise <= 0 ||
      selectedParticipants.length === 0 ||
      currentRemainingPaise !== 0 ||
      !liveCustomValidation?.valid);

  const isSaveDisabled = isBusy || hasDeparted || isCustomInvalid;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <ThemedView type="background" style={styles.modalContainer}>
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            {/* Top Navigation Header */}
            <View style={styles.header}>
              <ThemedText style={styles.headerTitle}>{isEditMode ? 'Edit Expense' : 'Add Expense'}</ThemedText>
              <TouchableOpacity
                onPress={handleClose}
                disabled={isBusy}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <ThemedText style={styles.closeBtnText}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Error Banner */}
              {formError ? (
                <View style={styles.errorBanner}>
                  <ThemedText style={styles.errorBannerText}>⚠️ {formError}</ThemedText>
                </View>
              ) : null}

              {/* Departed Member Warning (if editing an expense with past members) */}
              {hasDeparted ? (
                <View style={styles.warningBox}>
                  <ThemedText type="small" style={styles.warningText}>
                    ⚠️ This expense contains departed group members who cannot participate in new splits. Changes cannot be saved.
                  </ThemedText>
                </View>
              ) : null}

              {/* Description Input */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.inputLabel}>
                    Description
                  </ThemedText>
                  <ThemedText type="small" style={styles.counterText}>
                    {description.length}/200
                  </ThemedText>
                </View>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Dinner, Grocery run, Cab fare"
                  placeholderTextColor="#64748B"
                  value={description}
                  onChangeText={(val) => {
                    setDescription(val);
                    if (formError) setFormError(null);
                  }}
                  maxLength={200}
                  editable={!isBusy && !hasDeparted}
                  autoFocus={!isEditMode}
                  accessibilityLabel="Expense description"
                />
              </View>

              {/* Amount Input */}
              <View style={styles.inputGroup}>
                <ThemedText type="smallBold" style={styles.inputLabel}>
                  Amount (₹)
                </ThemedText>
                <View style={styles.amountInputRow}>
                  <ThemedText style={styles.currencyPrefix}>₹</ThemedText>
                  <TextInput
                    style={[styles.textInput, styles.amountInput]}
                    placeholder="0.00"
                    placeholderTextColor="#64748B"
                    value={amountInput}
                    onChangeText={(val) => {
                      setAmountInput(val);
                      if (formError) setFormError(null);
                    }}
                    keyboardType="decimal-pad"
                    editable={!isBusy && !hasDeparted}
                    accessibilityLabel="Expense amount in rupees"
                  />
                </View>
                {amountInput.trim() && !parsedAmount.valid ? (
                  <ThemedText type="small" style={styles.fieldErrorText}>
                    {parsedAmount.error}
                  </ThemedText>
                ) : null}
              </View>

              {/* Category Chips */}
              <View style={styles.inputGroup}>
                <ThemedText type="smallBold" style={styles.inputLabel}>
                  Category
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsScroll}
                >
                  {EXPENSE_CATEGORIES.map((cat) => {
                    const isSelected = category === cat;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.chip, isSelected && styles.chipActive]}
                        onPress={() => {
                          if (isBusy || hasDeparted) return;
                          setCategory(cat);
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Select category ${cat}`}
                        accessibilityState={{ selected: isSelected }}
                      >
                        <ThemedText
                          type="small"
                          style={[styles.chipText, isSelected && styles.chipTextActive]}
                        >
                          {cat}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Payer Selector */}
              <View style={styles.inputGroup}>
                <ThemedText type="smallBold" style={styles.inputLabel}>
                  Paid By
                </ThemedText>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipsScroll}
                >
                  {members.map((m) => {
                    const isSelected = paidBy === m.id;
                    const isMe = m.id === currentUserId;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.payerChip, isSelected && styles.payerChipActive]}
                        onPress={() => {
                          if (isBusy || hasDeparted) return;
                          setPaidBy(m.id);
                          if (formError) setFormError(null);
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Select payer ${m.name}`}
                        accessibilityState={{ selected: isSelected }}
                      >
                        <ThemedText
                          type="smallBold"
                          style={[styles.payerChipText, isSelected && styles.payerChipTextActive]}
                          numberOfLines={1}
                        >
                          {m.name}{isMe ? ' (You)' : ''}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Date Input */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.inputLabel}>
                    Date (YYYY-MM-DD)
                  </ThemedText>
                  <TouchableOpacity
                    onPress={handleResetDateToday}
                    disabled={isBusy || hasDeparted}
                    accessibilityRole="button"
                    accessibilityLabel="Set date to today"
                  >
                    <ThemedText type="smallBold" style={styles.todayLink}>
                      Today
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.textInput}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#64748B"
                  value={dateInput}
                  onChangeText={(val) => {
                    setDateInput(val);
                    if (formError) setFormError(null);
                  }}
                  maxLength={10}
                  editable={!isBusy && !hasDeparted}
                  accessibilityLabel="Expense date"
                />
              </View>

              {/* Split Method Segmented Tabs */}
              <View style={styles.inputGroup}>
                <ThemedText type="smallBold" style={styles.inputLabel}>
                  Split Method
                </ThemedText>
                <View style={styles.splitTypeTabs}>
                  <TouchableOpacity
                    style={[styles.splitTypeTab, splitType === 'equal' && styles.splitTypeTabActive]}
                    onPress={() => {
                      if (isBusy || hasDeparted) return;
                      setFormError(null);
                      setSplitType('equal');
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Equal split mode"
                    accessibilityState={{ selected: splitType === 'equal' }}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[styles.splitTypeTabText, splitType === 'equal' && styles.splitTypeTabTextActive]}
                    >
                      Equal Split
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.splitTypeTab, splitType === 'custom' && styles.splitTypeTabActive]}
                    onPress={() => {
                      if (isBusy || hasDeparted) return;
                      handleSwitchToCustom();
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Custom split mode"
                    accessibilityState={{ selected: splitType === 'custom' }}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[styles.splitTypeTabText, splitType === 'custom' && styles.splitTypeTabTextActive]}
                    >
                      Custom Split
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Participants Selection */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.inputLabel}>
                    {splitType === 'equal' ? 'Split With' : 'Custom Participants'} ({selectedParticipants.length} of {members.length})
                  </ThemedText>
                  <TouchableOpacity
                    onPress={handleSelectAllParticipants}
                    disabled={isBusy || hasDeparted}
                    accessibilityRole="button"
                    accessibilityLabel="Toggle select all participants"
                  >
                    <ThemedText type="smallBold" style={styles.todayLink}>
                      {selectedParticipants.length === members.length ? 'Reset' : 'Select All'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>

                <View style={styles.participantsList}>
                  {members.map((m) => {
                    const isChecked = selectedParticipants.includes(m.id);
                    const isMe = m.id === currentUserId;
                    const customShareItem = customSplits.find((s) => s.user === m.id);

                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.participantRow, isChecked && styles.participantRowChecked]}
                        onPress={() => handleToggleParticipant(m.id)}
                        disabled={isBusy || hasDeparted}
                        activeOpacity={0.7}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isChecked }}
                        accessibilityLabel={`Include ${m.name} in split`}
                      >
                        <View style={styles.participantLeft}>
                          <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                            {isChecked ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
                          </View>
                          <ThemedText
                            type="smallBold"
                            style={[
                              styles.participantName,
                              !isChecked && styles.participantNameUnchecked,
                            ]}
                          >
                            {m.name}{isMe ? ' (You)' : ''}
                          </ThemedText>
                        </View>

                        {/* EQUAL SPLIT: Live individual share preview */}
                        {splitType === 'equal' && isChecked && equalPreview && equalPreview.valid ? (
                          <ThemedText type="smallBold" style={styles.shareBadge}>
                            {formatINR(
                              equalPreview.splits.find((s) => s.user === m.id)?.share ?? 0
                            )}
                          </ThemedText>
                        ) : null}

                        {/* CUSTOM SPLIT: Editable share text input */}
                        {splitType === 'custom' && isChecked ? (
                          <View style={styles.customShareInputRow}>
                            <ThemedText style={styles.customShareCurrency}>₹</ThemedText>
                            <TextInput
                              style={styles.customShareInput}
                              placeholder="0.00"
                              placeholderTextColor="#64748B"
                              value={customShareItem?.share ?? ''}
                              onChangeText={(val) => handleCustomShareChange(m.id, val)}
                              keyboardType="decimal-pad"
                              editable={!isBusy && !hasDeparted}
                              accessibilityLabel={`Share for ${m.name}`}
                            />
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* EQUAL SPLIT: Live Breakdown Card */}
              {splitType === 'equal' ? (
                equalPreview && equalPreview.valid ? (
                  <ThemedView type="backgroundElement" style={styles.previewCard}>
                    <View style={styles.previewHeaderRow}>
                      <ThemedText type="smallBold" style={styles.previewTitle}>
                        Equal Split Breakdown
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.previewTotalShare}>
                        {equalPreview.remainderPaise > 0
                          ? `From ${formatINR(equalPreview.basePaise / 100)}`
                          : `${formatINR(equalPreview.basePaise / 100)} each`}
                      </ThemedText>
                    </View>

                    {equalPreview.remainderPaise > 0 ? (
                      <ThemedText type="small" style={styles.previewRemainder}>
                        ℹ️ Remainder paise distributed: {equalPreview.remainderPaise}{' '}
                        {equalPreview.remainderPaise > 1 ? 'members pay' : 'member pays'}{' '}
                        {formatINR((equalPreview.basePaise + 1) / 100)}, and{' '}
                        {equalPreview.splits.length - equalPreview.remainderPaise} pay{' '}
                        {formatINR(equalPreview.basePaise / 100)} to match the exact ₹
                        {parsedAmount.amount.toFixed(2)} total.
                      </ThemedText>
                    ) : null}
                  </ThemedView>
                ) : selectedParticipants.length === 0 ? (
                  <View style={styles.warningBox}>
                    <ThemedText type="small" style={styles.warningText}>
                      ⚠️ Select at least one participant to split this expense.
                    </ThemedText>
                  </View>
                ) : null
              ) : null}

              {/* CUSTOM SPLIT: Live Allocation Summary Card */}
              {splitType === 'custom' ? (
                <ThemedView type="backgroundElement" style={styles.customSummaryCard}>
                  <View style={styles.customSummaryHeaderRow}>
                    <ThemedText type="smallBold" style={styles.customSummaryTitle}>
                      Custom Allocation Summary
                    </ThemedText>
                    <TouchableOpacity
                      onPress={handleSplitEvenly}
                      disabled={
                        isBusy ||
                        hasDeparted ||
                        !parsedAmount.valid ||
                        parsedAmount.paise <= 0 ||
                        selectedParticipants.length === 0
                      }
                      style={[
                        styles.quickActionBtn,
                        (!parsedAmount.valid ||
                          parsedAmount.paise <= 0 ||
                          selectedParticipants.length === 0 ||
                          isBusy ||
                          hasDeparted) &&
                          styles.quickActionBtnDisabled,
                      ]}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Split evenly among selected participants"
                    >
                      <ThemedText style={styles.quickActionText}>Split Evenly</ThemedText>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.customSummaryMetrics}>
                    <View style={styles.metricColumn}>
                      <ThemedText type="small" style={styles.metricLabel}>
                        Expense Total
                      </ThemedText>
                      <ThemedText style={styles.metricValue}>
                        {formatINR(parsedAmount.valid ? parsedAmount.amount : 0)}
                      </ThemedText>
                    </View>
                    <View style={styles.metricColumn}>
                      <ThemedText type="small" style={styles.metricLabel}>
                        Allocated
                      </ThemedText>
                      <ThemedText style={styles.metricValue}>
                        {formatINR(currentAllocatedPaise / 100)}
                      </ThemedText>
                    </View>
                    <View style={styles.metricColumn}>
                      <ThemedText type="small" style={styles.metricLabel}>
                        Remaining
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.metricValue,
                          currentRemainingPaise === 0 && parsedAmount.valid && parsedAmount.paise > 0
                            ? styles.textSuccess
                            : currentRemainingPaise > 0
                            ? styles.textWarning
                            : styles.textDanger,
                        ]}
                      >
                        {formatINR(Math.abs(currentRemainingPaise) / 100)}
                      </ThemedText>
                    </View>
                  </View>

                  {/* Status Banner */}
                  {selectedParticipants.length === 0 ? (
                    <View style={[styles.matchBanner, styles.matchBannerWarning]}>
                      <ThemedText style={styles.matchBannerTextWarning}>
                        ⚠️ Select at least one participant for custom split.
                      </ThemedText>
                    </View>
                  ) : currentRemainingPaise === 0 &&
                    parsedAmount.valid &&
                    parsedAmount.paise > 0 &&
                    liveCustomValidation?.valid ? (
                    <View style={[styles.matchBanner, styles.matchBannerSuccess]}>
                      <ThemedText style={styles.matchBannerTextSuccess}>
                        ✨ Exact match! Total allocated matches expense amount.
                      </ThemedText>
                    </View>
                  ) : currentRemainingPaise > 0 ? (
                    <View style={[styles.matchBanner, styles.matchBannerWarning]}>
                      <ThemedText style={styles.matchBannerTextWarning}>
                        ⚠️ ₹{(currentRemainingPaise / 100).toFixed(2)} remaining to allocate.
                      </ThemedText>
                    </View>
                  ) : currentRemainingPaise < 0 ? (
                    <View style={[styles.matchBanner, styles.matchBannerError]}>
                      <ThemedText style={styles.matchBannerTextError}>
                        ⚠️ Over-allocated by ₹{(Math.abs(currentRemainingPaise) / 100).toFixed(2)}.
                      </ThemedText>
                    </View>
                  ) : liveCustomValidation && !liveCustomValidation.valid ? (
                    <View style={[styles.matchBanner, styles.matchBannerError]}>
                      <ThemedText style={styles.matchBannerTextError}>
                        ⚠️ {liveCustomValidation.error}
                      </ThemedText>
                    </View>
                  ) : null}
                </ThemedView>
              ) : null}
            </ScrollView>

            {/* Bottom Actions Bar */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.submitBtn, isSaveDisabled && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={isSaveDisabled}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={isEditMode ? 'Save changes' : 'Save expense'}
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <ThemedText style={styles.submitBtnText}>
                    {isEditMode ? 'Save Changes' : 'Save Expense'}
                  </ThemedText>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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
  keyboardAvoid: {
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
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.three,
  },
  errorBanner: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
  },
  errorBannerText: {
    color: '#EF4444',
    fontSize: 13,
  },
  inputGroup: {
    gap: Spacing.one,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputLabel: {
    opacity: 0.85,
  },
  counterText: {
    opacity: 0.5,
    fontSize: 12,
  },
  todayLink: {
    color: '#3B82F6',
    fontSize: 13,
  },
  textInput: {
    backgroundColor: '#0F172A40',
    color: '#F8FAFC',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    minHeight: 46,
  },
  amountInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  currencyPrefix: {
    fontSize: 20,
    fontWeight: '700',
    color: '#3B82F6',
    marginRight: Spacing.two,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  fieldErrorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 2,
  },
  chipsScroll: {
    gap: Spacing.two,
    paddingVertical: 4,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
    borderRadius: 999,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#3B82F6',
  },
  chipText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  payerChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 4,
    borderRadius: Spacing.two,
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
  },
  payerChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#3B82F6',
  },
  payerChipText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  payerChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  participantsList: {
    gap: Spacing.one + 2,
    marginTop: Spacing.one,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    backgroundColor: '#1E293B66',
    borderWidth: 1,
    borderColor: '#334155',
  },
  participantRowChecked: {
    backgroundColor: '#1E293B',
    borderColor: '#3B82F666',
  },
  participantLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#64748B',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  checkboxChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    marginTop: -1,
  },
  participantName: {
    fontSize: 14,
    color: '#F8FAFC',
  },
  participantNameUnchecked: {
    opacity: 0.6,
  },
  shareBadge: {
    color: '#3B82F6',
    fontSize: 13,
  },
  previewCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: '#3B82F644',
  },
  previewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewTitle: {
    fontSize: 14,
  },
  previewTotalShare: {
    fontSize: 14,
    color: '#10B981',
  },
  previewRemainder: {
    opacity: 0.75,
    fontSize: 12,
    lineHeight: 16,
  },
  warningBox: {
    padding: Spacing.two,
    borderRadius: Spacing.one,
    backgroundColor: '#F59E0B1A',
    borderColor: '#F59E0B66',
    borderWidth: 1,
  },
  warningText: {
    color: '#F59E0B',
    fontSize: 12,
  },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#334155',
    backgroundColor: '#0F172A22',
  },
  submitBtn: {
    backgroundColor: '#2563EB',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 4,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  splitTypeTabs: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: Spacing.two,
    padding: 3,
    borderWidth: 1,
    borderColor: '#334155',
  },
  splitTypeTab: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two - 2,
  },
  splitTypeTabActive: {
    backgroundColor: '#2563EB',
  },
  splitTypeTabText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  splitTypeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  customShareInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A80',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    paddingHorizontal: Spacing.two,
    width: 110,
    height: 38,
  },
  customShareCurrency: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '700',
    marginRight: 4,
  },
  customShareInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
    textAlign: 'right',
  },
  customSummaryCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#334155',
  },
  customSummaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customSummaryTitle: {
    fontSize: 14,
  },
  quickActionBtn: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.one,
    backgroundColor: '#1E293B',
    borderColor: '#3B82F6',
    borderWidth: 1,
  },
  quickActionBtnDisabled: {
    opacity: 0.4,
    borderColor: '#334155',
  },
  quickActionText: {
    color: '#3B82F6',
    fontSize: 12,
    fontWeight: '600',
  },
  customSummaryMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A40',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    borderWidth: 1,
    borderColor: '#334155',
  },
  metricColumn: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    opacity: 0.7,
    fontSize: 11,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  textSuccess: {
    color: '#10B981',
  },
  textWarning: {
    color: '#F59E0B',
  },
  textDanger: {
    color: '#EF4444',
  },
  matchBanner: {
    padding: Spacing.two,
    borderRadius: Spacing.one,
    borderWidth: 1,
  },
  matchBannerSuccess: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
  },
  matchBannerWarning: {
    backgroundColor: '#F59E0B1A',
    borderColor: '#F59E0B66',
  },
  matchBannerError: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
  },
  matchBannerTextSuccess: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
  },
  matchBannerTextWarning: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '600',
  },
  matchBannerTextError: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
});
