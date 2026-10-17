import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '../constants/theme';
import { paymentApi } from '../services/paymentApi';
import type { SettlementDebt, UpiIntentResponse } from '../types/api';
import { formatINR } from '../utils/format';
import { buildCreateIntentPayload, validatePaymentAmount } from '../utils/paymentForm';

export interface PaymentModalProps {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  settlement: SettlementDebt | null;
  currentUserId?: string | null;
}

export function PaymentModal({
  visible,
  onClose,
  groupId,
  settlement,
  currentUserId,
}: PaymentModalProps) {
  const [amountInput, setAmountInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState<boolean>(false);
  const [isRecipientUpiMissing, setIsRecipientUpiMissing] = useState<boolean>(false);

  // Result state after intent creation
  const [intentResult, setIntentResult] = useState<UpiIntentResponse | null>(null);
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'launched' | 'fallback'>('idle');

  // Pre-fill full amount on visible or settlement change
  useEffect(() => {
    if (visible && settlement) {
      setAmountInput(settlement.amount.toFixed(2));
      setFormError(null);
      setIsConflict(false);
      setIsRecipientUpiMissing(false);
      setIntentResult(null);
      setLaunchStatus('idle');
      setIsSubmitting(false);
    }
  }, [visible, settlement]);

  if (!settlement) return null;

  const recipientName = settlement.to?.name || 'Group Member';
  const recipientId = String(settlement.to?.userId ?? settlement.to?.id ?? '');
  const authorizedAmount = settlement.amount;

  const handleFullAmount = () => {
    setAmountInput(authorizedAmount.toFixed(2));
    setFormError(null);
  };

  const handleLaunchUpi = async (upiUri: string) => {
    try {
      await Linking.openURL(upiUri);
      setLaunchStatus('launched');
    } catch (linkErr) {
      // Gracefully fall back to manual details if no UPI app can be opened
      setLaunchStatus('fallback');
    }
  };

  const handlePay = async () => {
    if (isSubmitting) return;

    setFormError(null);
    setIsConflict(false);
    setIsRecipientUpiMissing(false);

    // 1. Client-side validation matching backend integer paise arithmetic
    const validation = validatePaymentAmount(amountInput, authorizedAmount);
    if (!validation.valid) {
      setFormError(validation.message || 'Invalid payment amount');
      return;
    }

    // 2. Build payload
    let payload;
    try {
      payload = buildCreateIntentPayload({
        groupId,
        toUserId: recipientId,
        amount: amountInput,
        authorizedAmount,
        currentUserId,
      });
    } catch (buildErr: any) {
      setFormError(buildErr?.message || 'Invalid payment parameters');
      return;
    }

    // 3. Initiate payment intent
    setIsSubmitting(true);
    try {
      const res = await paymentApi.createIntent(payload);
      setIntentResult(res);

      // Attempt to launch the external UPI app
      await handleLaunchUpi(res.upiUri);
    } catch (err: any) {
      const status = err?.status;
      const message: string = err?.message || 'Failed to initiate UPI payment';

      if (status === 409) {
        setIsConflict(true);
        setFormError(message);
      } else if (
        status === 400 &&
        message.toLowerCase().includes('not configured a upi')
      ) {
        setIsRecipientUpiMissing(true);
        setFormError(
          `${recipientName} has not set up a UPI ID yet. Please ask them to add their UPI ID in their Profile Settings.`
        );
      } else {
        setFormError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={isSubmitting ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={isSubmitting ? undefined : onClose}
        />

        <ThemedView type="backgroundElement" style={styles.dialog}>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header */}
            <View style={styles.dialogHeader}>
              <View style={styles.titleWrap}>
                <ThemedText type="smallBold" style={styles.dialogTitle}>
                  Pay via Direct UPI
                </ThemedText>
                <ThemedText type="small" style={styles.dialogSubtitle}>
                  Settle your share peer-to-peer
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={onClose}
                disabled={isSubmitting}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Close payment dialog"
              >
                <ThemedText style={styles.closeBtnText}>✕</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Recipient & Authorized Debt Card */}
            <View style={styles.debtSummaryCard}>
              <View style={styles.debtSummaryRow}>
                <ThemedText type="small" style={styles.debtSummaryLabel}>
                  Paying To:
                </ThemedText>
                <ThemedText type="smallBold" style={styles.debtSummaryValue}>
                  {recipientName}
                </ThemedText>
              </View>
              <View style={styles.debtSummaryRow}>
                <ThemedText type="small" style={styles.debtSummaryLabel}>
                  Total Debt:
                </ThemedText>
                <ThemedText type="smallBold" style={styles.debtAmountValue}>
                  {formatINR(authorizedAmount)}
                </ThemedText>
              </View>
            </View>

            {/* View State: LAUNCHED */}
            {launchStatus === 'launched' && intentResult ? (
              <View style={styles.resultContainer}>
                <View style={styles.launchedBanner}>
                  <ThemedText style={styles.badgeSuccess}>✓ UPI App Launched</ThemedText>
                  <ThemedText style={styles.launchedTitle}>
                    Payment of {formatINR(intentResult.amount)} Initiated
                  </ThemedText>
                  <ThemedText type="small" style={styles.launchedSub}>
                    Check your UPI app to authorize and finish the payment to{' '}
                    <ThemedText type="smallBold" style={styles.boldWhite}>
                      {intentResult.payeeName}
                    </ThemedText>{' '}
                    ({intentResult.payeeUpiId}).
                  </ThemedText>
                </View>

                {/* Important notice: debt not cleared until recipient confirms */}
                <View style={styles.noticeBox}>
                  <ThemedText type="small" style={styles.noticeText}>
                    ℹ️ <ThemedText type="smallBold" style={styles.boldNotice}>Note:</ThemedText>{' '}
                    Your balance is not cleared immediately. Once you finish payment in your UPI app,
                    the recipient must confirm receipt before the debt is removed from group balances.
                  </ThemedText>
                </View>

                <View style={styles.resultActions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.secondaryBtn]}
                    onPress={() => handleLaunchUpi(intentResult.upiUri)}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.secondaryBtnText}>
                      Re-launch UPI App
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btn, styles.primaryBtn]}
                    onPress={onClose}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.primaryBtnText}>Done</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* View State: FALLBACK (Manual UPI Details) */}
            {launchStatus === 'fallback' && intentResult ? (
              <View style={styles.resultContainer}>
                <View style={styles.fallbackBanner}>
                  <ThemedText style={styles.badgeWarning}>⚠️ Manual Transfer Required</ThemedText>
                  <ThemedText style={styles.fallbackTitle}>
                    Could Not Open UPI App Automatically
                  </ThemedText>
                  <ThemedText type="small" style={styles.fallbackSub}>
                    No compatible UPI app could be launched on this device. Open Google Pay, PhonePe, Paytm, or BHIM and transfer manually:
                  </ThemedText>
                </View>

                <View style={styles.manualDetailsBox}>
                  <View style={styles.manualDetailRow}>
                    <ThemedText type="small" style={styles.manualLabel}>
                      Payee Name:
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.manualValue}>
                      {intentResult.payeeName}
                    </ThemedText>
                  </View>
                  <View style={styles.manualDetailRow}>
                    <ThemedText type="small" style={styles.manualLabel}>
                      UPI ID (VPA):
                    </ThemedText>
                    <ThemedText
                      type="smallBold"
                      style={[styles.manualValue, styles.vpaHighlight]}
                      selectable
                    >
                      {intentResult.payeeUpiId}
                    </ThemedText>
                  </View>
                  <View style={styles.manualDetailRow}>
                    <ThemedText type="small" style={styles.manualLabel}>
                      Amount:
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.manualValue}>
                      {formatINR(intentResult.amount)}
                    </ThemedText>
                  </View>
                  <View style={styles.manualDetailRow}>
                    <ThemedText type="small" style={styles.manualLabel}>
                      Note / Reference:
                    </ThemedText>
                    <ThemedText type="small" style={styles.manualValue}>
                      LendLocal Settlement
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.noticeBox}>
                  <ThemedText type="small" style={styles.noticeText}>
                    ℹ️ <ThemedText type="smallBold" style={styles.boldNotice}>Note:</ThemedText>{' '}
                    After sending the money, the recipient will confirm receipt to update the ledger.
                  </ThemedText>
                </View>

                <View style={styles.resultActions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.secondaryBtn]}
                    onPress={() => handleLaunchUpi(intentResult.upiUri)}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.secondaryBtnText}>
                      Retry UPI App
                    </ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btn, styles.primaryBtn]}
                    onPress={onClose}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.primaryBtnText}>Close</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* View State: IDLE (Amount input and pay initiation) */}
            {launchStatus === 'idle' ? (
              <View style={styles.formContainer}>
                {/* Amount Input */}
                <View style={styles.inputWrap}>
                  <View style={styles.inputLabelRow}>
                    <ThemedText type="smallBold" style={styles.inputLabel}>
                      Amount to Pay (₹)
                    </ThemedText>
                    <TouchableOpacity
                      onPress={handleFullAmount}
                      disabled={isSubmitting}
                      hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                    >
                      <ThemedText type="smallBold" style={styles.fullAmountBtnText}>
                        Full Amount ({formatINR(authorizedAmount)})
                      </ThemedText>
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    style={[styles.input, isSubmitting && styles.inputDisabled]}
                    value={amountInput}
                    onChangeText={(text) => {
                      setAmountInput(text);
                      if (formError) setFormError(null);
                    }}
                    placeholder="0.00"
                    placeholderTextColor="#64748B"
                    keyboardType="decimal-pad"
                    editable={!isSubmitting}
                    accessibilityLabel="Payment amount input in rupees"
                  />
                  <ThemedText type="small" style={styles.helperText}>
                    Min ₹0.01 • Max {formatINR(authorizedAmount)}
                  </ThemedText>
                </View>

                {/* Error Banner */}
                {formError ? (
                  <View
                    style={[
                      styles.errorBox,
                      isConflict && styles.conflictBox,
                      isRecipientUpiMissing && styles.warningBox,
                    ]}
                  >
                    <ThemedText style={styles.errorText}>
                      {isRecipientUpiMissing ? '⚠️ ' : isConflict ? '⏳ ' : '⚠️ '}
                      {formError}
                    </ThemedText>
                  </View>
                ) : null}

                {/* Info Notice */}
                <View style={styles.noticeBox}>
                  <ThemedText type="small" style={styles.noticeText}>
                    ℹ️ Tapping &ldquo;Pay via UPI&rdquo; will open your installed UPI app (Google Pay, PhonePe, Paytm, etc.) to complete payment directly to {recipientName}.
                  </ThemedText>
                </View>

                {/* Actions */}
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.btn, styles.cancelBtn, isSubmitting && styles.btnDisabled]}
                    onPress={onClose}
                    disabled={isSubmitting}
                    activeOpacity={0.7}
                  >
                    <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btn, styles.payBtn, isSubmitting && styles.btnDisabled]}
                    onPress={handlePay}
                    disabled={isSubmitting}
                    activeOpacity={0.8}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <ThemedText style={styles.payBtnText}>Pay via UPI</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </ScrollView>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    borderRadius: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  scrollContent: {
    gap: Spacing.three,
  },
  dialogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleWrap: {
    flex: 1,
    marginRight: Spacing.two,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  dialogSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeBtnText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '700',
    padding: Spacing.one,
  },
  debtSummaryCard: {
    backgroundColor: '#0F172A66',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
    borderWidth: 1,
    borderColor: '#33415566',
  },
  debtSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debtSummaryLabel: {
    color: '#94A3B8',
    fontSize: 13,
  },
  debtSummaryValue: {
    color: '#F8FAFC',
    fontSize: 14,
  },
  debtAmountValue: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '700',
  },
  formContainer: {
    gap: Spacing.three,
  },
  inputWrap: {
    gap: Spacing.one,
  },
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    fontSize: 13,
    color: '#F8FAFC',
  },
  fullAmountBtnText: {
    fontSize: 12,
    color: '#3B82F6',
  },
  input: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '600',
  },
  inputDisabled: {
    opacity: 0.5,
  },
  helperText: {
    fontSize: 11,
    color: '#64748B',
  },
  errorBox: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    padding: Spacing.two + 1,
  },
  conflictBox: {
    backgroundColor: '#F59E0B1A',
    borderColor: '#F59E0B66',
  },
  warningBox: {
    backgroundColor: '#F59E0B1A',
    borderColor: '#F59E0B66',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 17,
  },
  noticeBox: {
    backgroundColor: '#0F172A40',
    borderRadius: Spacing.two,
    padding: Spacing.two + 2,
    borderWidth: 1,
    borderColor: '#3341554D',
  },
  noticeText: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
  },
  boldNotice: {
    color: '#CBD5E1',
  },
  boldWhite: {
    color: '#F8FAFC',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  btn: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 2,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  cancelBtn: {
    backgroundColor: '#334155',
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  payBtn: {
    backgroundColor: '#10B981',
    minWidth: 120,
  },
  payBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  // Result states
  resultContainer: {
    gap: Spacing.three,
  },
  launchedBanner: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  badgeSuccess: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  launchedTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  launchedSub: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  fallbackBanner: {
    backgroundColor: '#F59E0B1A',
    borderColor: '#F59E0B66',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  badgeWarning: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  fallbackTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  fallbackSub: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
  },
  manualDetailsBox: {
    backgroundColor: '#0F172A',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#334155',
  },
  manualDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  manualLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  manualValue: {
    color: '#F8FAFC',
    fontSize: 13,
  },
  vpaHighlight: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  resultActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  primaryBtn: {
    backgroundColor: '#2563EB',
    flex: 1,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    flex: 1,
  },
  secondaryBtnText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
});

