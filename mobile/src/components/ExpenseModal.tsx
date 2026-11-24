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
import { Brand, MaxContentWidth, Spacing, Surfaces } from '../constants/theme';
import type {
  CreateExpensePayload,
  ExpenseItem,
  ExpenseSplitType,
  GroupDetail,
  UpdateExpensePayload,
} from '../types/api';
import {
  EXPENSE_CATEGORIES,
  ExpenseCategory,
  buildCustomExpensePayload,
  buildEqualExpensePayload,
  buildEqualPreview,
  buildPercentageExpensePayload,
  buildSharesExpensePayload,
  hasDepartedSplitParticipants,
  parseAmountToPaise,
  validateCustomSplits,
  validateMultiPayers,
  validatePercentageSplits,
  validateSharesSplits,
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

  // Multi-Payer state
  const [payerMode, setPayerMode] = useState<'single' | 'multiple'>('single');
  const [multiPayers, setMultiPayers] = useState<Array<{ user: string; amount: string }>>([]);

  // Split Type state: 'equal' | 'custom' | 'percentage' | 'shares'
  const [splitType, setSplitType] = useState<ExpenseSplitType>('equal');
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [customSplits, setCustomSplits] = useState<Array<{ user: string; share: string }>>([]);
  const [percentageSplits, setPercentageSplits] = useState<Array<{ user: string; percentage: string }>>([]);
  const [sharesSplits, setSharesSplits] = useState<Array<{ user: string; shares: string }>>([]);

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

      // Prepopulate payers
      if (expenseToEdit.payers && expenseToEdit.payers.length > 1) {
        setPayerMode('multiple');
        setMultiPayers(
          members.map((m) => {
            const match = (expenseToEdit.payers || []).find((p) => {
              const uId = typeof p.user === 'object' && p.user ? (p.user as any).id || (p.user as any)._id : p.user;
              return String(uId) === m.id;
            });
            return {
              user: m.id,
              amount: match ? match.amount.toFixed(2) : '',
            };
          })
        );
      } else {
        setPayerMode('single');
        setMultiPayers(members.map((m) => ({ user: m.id, amount: '' })));
        const origPayerId = expenseToEdit.paidBy?.id ?? (typeof expenseToEdit.paidBy === 'string' ? expenseToEdit.paidBy : '');
        const payerIsMember = origPayerId && members.some((m) => m.id === origPayerId);
        if (payerIsMember) {
          setPaidBy(origPayerId);
        } else {
          const currentIsMember = currentUserId && members.some((m) => m.id === currentUserId);
          setPaidBy(currentIsMember ? currentUserId! : (members[0]?.id || ''));
        }
      }

      // Prepopulate split type and splits
      const st = expenseToEdit.splitType || 'equal';
      setSplitType(st);

      if (st === 'custom') {
        const preSplits = (expenseToEdit.splits || []).map((s) => ({
          user: typeof s.user === 'object' && s.user ? (s.user as any).id! : String(s.user || ''),
          share: typeof s.share === 'number' ? (s.share % 1 === 0 ? s.share.toString() : s.share.toFixed(2)) : String(s.share ?? ''),
        }));
        setCustomSplits(preSplits);
        setSelectedParticipants(
          preSplits.map((s) => s.user).filter((id) => members.some((m) => m.id === id))
        );
      } else if (st === 'percentage') {
        const preSplits = (expenseToEdit.splits || []).map((s) => ({
          user: typeof s.user === 'object' && s.user ? (s.user as any).id! : String(s.user || ''),
          percentage: s.percentage !== undefined ? String(s.percentage) : '',
        }));
        setPercentageSplits(preSplits);
        setSelectedParticipants(
          preSplits.map((s) => s.user).filter((id) => members.some((m) => m.id === id))
        );
      } else if (st === 'shares') {
        const preSplits = (expenseToEdit.splits || []).map((s) => ({
          user: typeof s.user === 'object' && s.user ? (s.user as any).id! : String(s.user || ''),
          shares: s.shares !== undefined ? String(s.shares) : '1',
        }));
        setSharesSplits(preSplits);
        setSelectedParticipants(
          preSplits.map((s) => s.user).filter((id) => members.some((m) => m.id === id))
        );
      } else {
        setCustomSplits(members.map((m) => ({ user: m.id, share: '' })));
        setPercentageSplits(members.map((m) => ({ user: m.id, percentage: '' })));
        setSharesSplits(members.map((m) => ({ user: m.id, shares: '1' })));
        if (Array.isArray(expenseToEdit.splits) && expenseToEdit.splits.length > 0) {
          const participantIds = expenseToEdit.splits
            .map((s) => (typeof s.user === 'object' && s.user ? (s.user as any).id : String(s.user || '')))
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
      setPayerMode('single');
      setMultiPayers(members.map((m) => ({ user: m.id, amount: '' })));
      setCustomSplits(members.map((m) => ({ user: m.id, share: '' })));
      setPercentageSplits(members.map((m) => ({ user: m.id, percentage: '' })));
      setSharesSplits(members.map((m) => ({ user: m.id, shares: '1' })));

      // Default payer to current authenticated user if active member; else first member
      const currentIsMember = currentUserId && members.some((m) => m.id === currentUserId);
      setPaidBy(currentIsMember ? currentUserId! : (members[0]?.id || ''));

      // Default all active group members selected
      setSelectedParticipants(members.map((m) => m.id));
    }
  }, [visible, expenseToEdit, currentUserId, members]);

  // Live amount parsing & math detection
  const parsedAmount = useMemo(() => parseAmountToPaise(amountInput), [amountInput]);
  const hasMathExpression = useMemo(() => /[+\-*/()]/.test(amountInput.trim()), [amountInput]);

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
        if (!trimmed) return sum;
        const parseRes = parseAmountToPaise(trimmed);
        if (parseRes.valid && parseRes.paise > 0) return sum + parseRes.paise;
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

  // Live percentage calculation and validation
  const livePercentageValidation = useMemo(() => {
    if (splitType !== 'percentage') return null;
    const activeSplits = percentageSplits.filter((s) => selectedParticipants.includes(s.user));
    return validatePercentageSplits(activeSplits, memberIds);
  }, [splitType, percentageSplits, selectedParticipants, memberIds]);

  // Live shares calculation and validation
  const liveSharesValidation = useMemo(() => {
    if (splitType !== 'shares') return null;
    const activeSplits = sharesSplits.filter((s) => selectedParticipants.includes(s.user));
    return validateSharesSplits(activeSplits, memberIds);
  }, [splitType, sharesSplits, selectedParticipants, memberIds]);

  // Live multi-payer calculation and validation
  const liveMultiPayerValidation = useMemo(() => {
    if (payerMode !== 'multiple' || !parsedAmount.valid || parsedAmount.paise <= 0) {
      return null;
    }
    return validateMultiPayers(multiPayers, parsedAmount.paise, memberIds);
  }, [payerMode, multiPayers, parsedAmount, memberIds]);

  const currentTotalPayerPaise = useMemo(() => {
    if (payerMode !== 'multiple') return 0;
    return multiPayers.reduce((sum, item) => {
      const trimmed = String(item.amount ?? '').trim();
      if (!trimmed) return sum;
      const parseRes = parseAmountToPaise(trimmed);
      if (parseRes.valid && parseRes.paise > 0) return sum + parseRes.paise;
      const n = Number(trimmed);
      if (isNaN(n) || n <= 0) return sum;
      return sum + Math.round(n * 100);
    }, 0);
  }, [payerMode, multiPayers]);

  const currentRemainingPayerPaise = (parsedAmount.valid ? parsedAmount.paise : 0) - currentTotalPayerPaise;

  // Handlers
  const handleAmountBlur = () => {
    if (hasMathExpression && parsedAmount.valid) {
      setAmountInput(parsedAmount.amount.toFixed(2));
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

  const handlePercentageChange = (userId: string, val: string) => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    setPercentageSplits((prev) => {
      const exists = prev.some((s) => s.user === userId);
      if (exists) {
        return prev.map((s) => (s.user === userId ? { ...s, percentage: val } : s));
      }
      return [...prev, { user: userId, percentage: val }];
    });
  };

  const handleSharesChange = (userId: string, val: string) => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    setSharesSplits((prev) => {
      const exists = prev.some((s) => s.user === userId);
      if (exists) {
        return prev.map((s) => (s.user === userId ? { ...s, shares: val } : s));
      }
      return [...prev, { user: userId, shares: val }];
    });
  };

  const handleMultiPayerChange = (userId: string, val: string) => {
    if (isSubmitting || isMutating) return;
    setFormError(null);
    setMultiPayers((prev) => {
      const exists = prev.some((s) => s.user === userId);
      if (exists) {
        return prev.map((s) => (s.user === userId ? { ...s, amount: val } : s));
      }
      return [...prev, { user: userId, amount: val }];
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

  const handleSplitEvenPercentages = () => {
    if (selectedParticipants.length === 0) return;
    const n = selectedParticipants.length;
    const basePct = parseFloat((100 / n).toFixed(2));
    setPercentageSplits((prev) =>
      members.map((m) => {
        const isSel = selectedParticipants.includes(m.id);
        return {
          user: m.id,
          percentage: isSel ? String(basePct) : (prev.find((p) => p.user === m.id)?.percentage ?? ''),
        };
      })
    );
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

    const activePayerList = payerMode === 'multiple' ? multiPayers.filter((p) => (Number(p.amount) || 0) > 0) : undefined;

    if (splitType === 'custom') {
      const activeSplits = customSplits.filter((s) => selectedParticipants.includes(s.user));
      validation = buildCustomExpensePayload({
        groupId: group.id,
        description,
        amountInput,
        paidBy: payerMode === 'single' ? paidBy : undefined,
        payers: activePayerList,
        customSplits: activeSplits,
        category,
        dateInput,
        validMemberIds: memberIds,
      });
    } else if (splitType === 'percentage') {
      const activeSplits = percentageSplits.filter((s) => selectedParticipants.includes(s.user));
      validation = buildPercentageExpensePayload({
        groupId: group.id,
        description,
        amountInput,
        paidBy: payerMode === 'single' ? paidBy : undefined,
        payers: activePayerList,
        percentageSplits: activeSplits,
        category,
        dateInput,
        validMemberIds: memberIds,
      });
    } else if (splitType === 'shares') {
      const activeSplits = sharesSplits.filter((s) => selectedParticipants.includes(s.user));
      validation = buildSharesExpensePayload({
        groupId: group.id,
        description,
        amountInput,
        paidBy: payerMode === 'single' ? paidBy : undefined,
        payers: activePayerList,
        sharesSplits: activeSplits,
        category,
        dateInput,
        validMemberIds: memberIds,
      });
    } else {
      validation = buildEqualExpensePayload({
        groupId: group.id,
        description,
        amountInput,
        paidBy: payerMode === 'single' ? paidBy : undefined,
        payers: activePayerList,
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
      let updateRes: any = null;
      if (isEditMode && expenseToEdit && onUpdate) {
        updateRes = await onUpdate(expenseToEdit.id, {
          description: validation.payload.description,
          amount: validation.payload.amount,
          paidBy: validation.payload.paidBy,
          payers: validation.payload.payers,
          splitType: validation.payload.splitType,
          splits: validation.payload.splits,
          category: validation.payload.category,
          date: validation.payload.date,
        });
      } else {
        updateRes = await onSubmit(validation.payload);
      }

      // Display budget status alert if present
      if (updateRes?.budgetStatus) {
        const { percentageUsed, monthlyLimit, alert } = updateRes.budgetStatus;
        const limitDisplay = monthlyLimit > 0 ? `₹${monthlyLimit}` : 'No limit';
        if (alert === '100') {
          Alert.alert(
            '⚠️ Monthly budget exceeded!',
            `You have used ${percentageUsed}% of the monthly limit.`
          );
        } else if (alert === '80') {
          Alert.alert(
            '⚠️ Note: Group has reached budget limit',
            `Group has reached ${percentageUsed}% of its monthly budget.`
          );
        }
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

  const isPercentageInvalid =
    splitType === 'percentage' &&
    (!parsedAmount.valid ||
      parsedAmount.paise <= 0 ||
      selectedParticipants.length === 0 ||
      !livePercentageValidation?.valid);

  const isSharesInvalid =
    splitType === 'shares' &&
    (!parsedAmount.valid ||
      parsedAmount.paise <= 0 ||
      selectedParticipants.length === 0 ||
      !liveSharesValidation?.valid);

  const isMultiPayerInvalid =
    payerMode === 'multiple' &&
    (!parsedAmount.valid ||
      parsedAmount.paise <= 0 ||
      !liveMultiPayerValidation?.valid);

  const isSaveDisabled =
    isBusy || hasDeparted || isCustomInvalid || isPercentageInvalid || isSharesInvalid || isMultiPayerInvalid;

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
                accessibilityRole="button"
                accessibilityLabel="Close dialog"
              >
                <ThemedText style={styles.closeBtnText}>Cancel</ThemedText>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Form Feedback Banner */}
              {formError ? (
                <View style={styles.errorBanner}>
                  <ThemedText style={styles.errorBannerText}>⚠️ {formError}</ThemedText>
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

              {/* Amount Input with Inline Math Calculator */}
              <View style={styles.inputGroup}>
                <ThemedText type="smallBold" style={styles.inputLabel}>
                  Amount (₹)
                </ThemedText>
                <View style={styles.amountInputRow}>
                  <ThemedText style={styles.currencyPrefix}>₹</ThemedText>
                  <TextInput
                    style={[styles.textInput, styles.amountInput]}
                    placeholder="e.g. 500 or 12+34"
                    placeholderTextColor="#64748B"
                    value={amountInput}
                    onChangeText={(val) => {
                      setAmountInput(val);
                      if (formError) setFormError(null);
                    }}
                    onBlur={handleAmountBlur}
                    keyboardType="default"
                    editable={!isBusy && !hasDeparted}
                    accessibilityLabel="Expense amount in rupees"
                  />
                </View>

                {/* Math Live Preview Chip */}
                {hasMathExpression && parsedAmount.valid ? (
                  <View style={styles.mathPreviewChip}>
                    <ThemedText style={styles.mathPreviewText}>
                      🧮 Result: ₹{formatINR(parsedAmount.amount)}
                    </ThemedText>
                  </View>
                ) : null}

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

              {/* Paid By & Multi-Payer Mode */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.inputLabel}>
                    Paid By
                  </ThemedText>
                  <View style={styles.payerModeToggle}>
                    <TouchableOpacity
                      style={[styles.payerModeBtn, payerMode === 'single' && styles.payerModeBtnActive]}
                      onPress={() => setPayerMode('single')}
                      disabled={isBusy || hasDeparted}
                    >
                      <ThemedText
                        style={[styles.payerModeBtnText, payerMode === 'single' && styles.payerModeBtnTextActive]}
                      >
                        Single
                      </ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.payerModeBtn, payerMode === 'multiple' && styles.payerModeBtnActive]}
                      onPress={() => setPayerMode('multiple')}
                      disabled={isBusy || hasDeparted}
                    >
                      <ThemedText
                        style={[styles.payerModeBtnText, payerMode === 'multiple' && styles.payerModeBtnTextActive]}
                      >
                        Multiple
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>

                {payerMode === 'single' ? (
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
                ) : (
                  /* Multiple Payers Input List */
                  <View style={styles.multiPayerContainer}>
                    {members.map((m) => {
                      const item = multiPayers.find((p) => p.user === m.id);
                      const isMe = m.id === currentUserId;
                      return (
                        <View key={m.id} style={styles.multiPayerRow}>
                          <ThemedText type="smallBold" style={styles.multiPayerName}>
                            {m.name}{isMe ? ' (You)' : ''}
                          </ThemedText>
                          <View style={styles.multiPayerInputWrap}>
                            <ThemedText style={styles.customShareCurrency}>₹</ThemedText>
                            <TextInput
                              style={styles.customShareInput}
                              placeholder="0.00"
                              placeholderTextColor="#64748B"
                              value={item?.amount ?? ''}
                              onChangeText={(val) => handleMultiPayerChange(m.id, val)}
                              keyboardType="default"
                              editable={!isBusy && !hasDeparted}
                              accessibilityLabel={`Amount paid by ${m.name}`}
                            />
                          </View>
                        </View>
                      );
                    })}

                    {/* Multi-Payer Summary */}
                    <View style={styles.multiPayerSummary}>
                      <ThemedText type="small" style={styles.multiPayerSummaryText}>
                        Total Paid: {formatINR(currentTotalPayerPaise / 100)} / {formatINR(parsedAmount.valid ? parsedAmount.amount : 0)}
                      </ThemedText>
                      {currentRemainingPayerPaise === 0 && parsedAmount.valid && parsedAmount.paise > 0 ? (
                        <ThemedText style={styles.textSuccess}>✓ Matches total</ThemedText>
                      ) : currentRemainingPayerPaise > 0 ? (
                        <ThemedText style={styles.textWarning}>
                          ₹{(currentRemainingPayerPaise / 100).toFixed(2)} remaining
                        </ThemedText>
                      ) : (
                        <ThemedText style={styles.textDanger}>
                          Over by ₹{(Math.abs(currentRemainingPayerPaise) / 100).toFixed(2)}
                        </ThemedText>
                      )}
                    </View>
                  </View>
                )}
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
                  keyboardType="numbers-and-punctuation"
                  editable={!isBusy && !hasDeparted}
                  accessibilityLabel="Expense date"
                />
              </View>

              {/* Split Type Selector: Equal | Custom | Percentage | Shares */}
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
                  >
                    <ThemedText
                      type="smallBold"
                      style={[styles.splitTypeTabText, splitType === 'equal' && styles.splitTypeTabTextActive]}
                    >
                      Equal
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.splitTypeTab, splitType === 'custom' && styles.splitTypeTabActive]}
                    onPress={() => {
                      if (isBusy || hasDeparted) return;
                      setFormError(null);
                      setSplitType('custom');
                    }}
                    activeOpacity={0.8}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[styles.splitTypeTabText, splitType === 'custom' && styles.splitTypeTabTextActive]}
                    >
                      Custom (₹)
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.splitTypeTab, splitType === 'percentage' && styles.splitTypeTabActive]}
                    onPress={() => {
                      if (isBusy || hasDeparted) return;
                      setFormError(null);
                      setSplitType('percentage');
                    }}
                    activeOpacity={0.8}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[styles.splitTypeTabText, splitType === 'percentage' && styles.splitTypeTabTextActive]}
                    >
                      % Split
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.splitTypeTab, splitType === 'shares' && styles.splitTypeTabActive]}
                    onPress={() => {
                      if (isBusy || hasDeparted) return;
                      setFormError(null);
                      setSplitType('shares');
                    }}
                    activeOpacity={0.8}
                  >
                    <ThemedText
                      type="smallBold"
                      style={[styles.splitTypeTabText, splitType === 'shares' && styles.splitTypeTabTextActive]}
                    >
                      Shares
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Participants Selection */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <ThemedText type="smallBold" style={styles.inputLabel}>
                    Participants ({selectedParticipants.length} of {members.length})
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
                    const pctItem = percentageSplits.find((s) => s.user === m.id);
                    const sharesItem = sharesSplits.find((s) => s.user === m.id);

                    // Calculated values for preview
                    const pctVal = Number(pctItem?.percentage) || 0;
                    const calculatedPctPaise = parsedAmount.valid
                      ? Math.round((pctVal / 100) * parsedAmount.paise)
                      : 0;

                    const totalSharesCount = sharesSplits
                      .filter((s) => selectedParticipants.includes(s.user))
                      .reduce((sum, s) => sum + (Number(s.shares) || 0), 0);
                    const shVal = Number(sharesItem?.shares) || 0;
                    const calculatedSharesPaise =
                      parsedAmount.valid && totalSharesCount > 0
                        ? Math.round((shVal / totalSharesCount) * parsedAmount.paise)
                        : 0;

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
                              keyboardType="default"
                              editable={!isBusy && !hasDeparted}
                              accessibilityLabel={`Share for ${m.name}`}
                            />
                          </View>
                        ) : null}

                        {/* PERCENTAGE SPLIT: Editable % input & preview */}
                        {splitType === 'percentage' && isChecked ? (
                          <View style={styles.pctInputRow}>
                            <TextInput
                              style={styles.pctInput}
                              placeholder="0"
                              placeholderTextColor="#64748B"
                              value={pctItem?.percentage ?? ''}
                              onChangeText={(val) => handlePercentageChange(m.id, val)}
                              keyboardType="default"
                              editable={!isBusy && !hasDeparted}
                              accessibilityLabel={`Percentage for ${m.name}`}
                            />
                            <ThemedText style={styles.pctSymbol}>%</ThemedText>
                            <ThemedText type="small" style={styles.pctCalculated}>
                              ({formatINR(calculatedPctPaise / 100)})
                            </ThemedText>
                          </View>
                        ) : null}

                        {/* SHARES SPLIT: Editable shares count & preview */}
                        {splitType === 'shares' && isChecked ? (
                          <View style={styles.pctInputRow}>
                            <TextInput
                              style={styles.sharesInput}
                              placeholder="1"
                              placeholderTextColor="#64748B"
                              value={sharesItem?.shares ?? '1'}
                              onChangeText={(val) => handleSharesChange(m.id, val)}
                              keyboardType="default"
                              editable={!isBusy && !hasDeparted}
                              accessibilityLabel={`Shares for ${m.name}`}
                            />
                            <ThemedText style={styles.sharesUnit}>sh</ThemedText>
                            <ThemedText type="small" style={styles.pctCalculated}>
                              ({formatINR(calculatedSharesPaise / 100)})
                            </ThemedText>
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

              {/* PERCENTAGE SPLIT: Live Summary Card */}
              {splitType === 'percentage' ? (
                <ThemedView type="backgroundElement" style={styles.customSummaryCard}>
                  <View style={styles.customSummaryHeaderRow}>
                    <ThemedText type="smallBold" style={styles.customSummaryTitle}>
                      Percentage Summary
                    </ThemedText>
                    <TouchableOpacity
                      onPress={handleSplitEvenPercentages}
                      disabled={isBusy || hasDeparted || selectedParticipants.length === 0}
                      style={[styles.quickActionBtn, selectedParticipants.length === 0 && styles.quickActionBtnDisabled]}
                      activeOpacity={0.7}
                    >
                      <ThemedText style={styles.quickActionText}>Split Evenly (%)</ThemedText>
                    </TouchableOpacity>
                  </View>

                  {livePercentageValidation?.valid ? (
                    <View style={[styles.matchBanner, styles.matchBannerSuccess]}>
                      <ThemedText style={styles.matchBannerTextSuccess}>
                        ✨ Exactly 100% allocated across {selectedParticipants.length} participants!
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={[styles.matchBanner, styles.matchBannerWarning]}>
                      <ThemedText style={styles.matchBannerTextWarning}>
                        {livePercentageValidation?.error ||
                          `Total: ${livePercentageValidation?.totalPercentage.toFixed(1) ?? 0}% (must equal 100%)`}
                      </ThemedText>
                    </View>
                  )}
                </ThemedView>
              ) : null}

              {/* SHARES SPLIT: Live Summary Card */}
              {splitType === 'shares' ? (
                <ThemedView type="backgroundElement" style={styles.customSummaryCard}>
                  <View style={styles.customSummaryHeaderRow}>
                    <ThemedText type="smallBold" style={styles.customSummaryTitle}>
                      Proportional Shares Summary
                    </ThemedText>
                    <ThemedText style={styles.quickActionText}>
                      Total Shares: {liveSharesValidation?.totalShares ?? 0}
                    </ThemedText>
                  </View>

                  {liveSharesValidation?.valid ? (
                    <View style={[styles.matchBanner, styles.matchBannerSuccess]}>
                      <ThemedText style={styles.matchBannerTextSuccess}>
                        ✨ {liveSharesValidation.totalShares} total shares. Value per share ≈{' '}
                        {formatINR(
                          parsedAmount.valid && liveSharesValidation.totalShares > 0
                            ? parsedAmount.amount / liveSharesValidation.totalShares
                            : 0
                        )}
                      </ThemedText>
                    </View>
                  ) : (
                    <View style={[styles.matchBanner, styles.matchBannerWarning]}>
                      <ThemedText style={styles.matchBannerTextWarning}>
                        {liveSharesValidation?.error || 'Enter positive shares for selected participants'}
                      </ThemedText>
                    </View>
                  )}
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
    borderBottomColor: Surfaces.darkBorder,
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
    color: Brand.primaryLight,
    fontSize: 13,
    fontWeight: '600',
  },
  textInput: {
    backgroundColor: Surfaces.darkCardMid,
    color: '#F8FAFC',
    borderColor: Surfaces.darkBorder,
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
    color: Brand.primary,
    marginRight: Spacing.two,
  },
  amountInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  mathPreviewChip: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: Spacing.one,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  mathPreviewText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '600',
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
    backgroundColor: Surfaces.darkCardMid,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: Brand.primary,
    borderColor: Brand.primaryLight,
  },
  chipText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  payerModeToggle: {
    flexDirection: 'row',
    backgroundColor: Surfaces.darkCard,
    borderRadius: Spacing.one + 2,
    padding: 2,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  payerModeBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    borderRadius: Spacing.one,
  },
  payerModeBtnActive: {
    backgroundColor: Brand.primary,
  },
  payerModeBtnText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  payerModeBtnTextActive: {
    color: '#FFFFFF',
  },
  payerChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 4,
    borderRadius: Spacing.two,
    backgroundColor: Surfaces.darkCardMid,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
  },
  payerChipActive: {
    backgroundColor: Brand.primary,
    borderColor: Brand.primaryLight,
  },
  payerChipText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  payerChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  multiPayerContainer: {
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    gap: Spacing.two,
  },
  multiPayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  multiPayerName: {
    fontSize: 14,
    color: '#F8FAFC',
    flex: 1,
  },
  multiPayerInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    paddingHorizontal: Spacing.two,
    width: 120,
    height: 38,
  },
  multiPayerSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Surfaces.darkBorder,
    paddingTop: Spacing.two,
    marginTop: 2,
  },
  multiPayerSummaryText: {
    color: '#94A3B8',
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
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  participantRowChecked: {
    backgroundColor: Surfaces.darkCardMid,
    borderColor: Brand.primaryGlow,
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
    backgroundColor: Brand.primary,
    borderColor: Brand.primary,
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
    color: Brand.primaryLight,
    fontSize: 13,
  },
  previewCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: Brand.primaryDim,
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
    borderTopColor: Surfaces.darkBorder,
    backgroundColor: Surfaces.darkBg,
  },
  submitBtn: {
    backgroundColor: Brand.primary,
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
    backgroundColor: Surfaces.darkCard,
    borderRadius: Spacing.two,
    padding: 3,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
  },
  splitTypeTab: {
    flex: 1,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.two - 2,
  },
  splitTypeTabActive: {
    backgroundColor: Brand.primary,
  },
  splitTypeTabText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  splitTypeTabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  customShareInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    paddingHorizontal: Spacing.two,
    width: 110,
    height: 38,
  },
  customShareCurrency: {
    color: Brand.primary,
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
  pctInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pctInput: {
    width: 55,
    height: 36,
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    color: '#F8FAFC',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
  },
  pctSymbol: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
  },
  pctCalculated: {
    color: Brand.primaryLight,
    fontSize: 12,
    minWidth: 58,
    textAlign: 'right',
  },
  sharesInput: {
    width: 45,
    height: 36,
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    color: '#F8FAFC',
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    padding: 0,
  },
  sharesUnit: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  customSummaryCard: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
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
    backgroundColor: Surfaces.darkCardMid,
    borderColor: Brand.primaryLight,
    borderWidth: 1,
  },
  quickActionBtnDisabled: {
    opacity: 0.4,
    borderColor: Surfaces.darkBorder,
  },
  quickActionText: {
    color: Brand.primaryLight,
    fontSize: 12,
    fontWeight: '600',
  },
  customSummaryMetrics: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
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
