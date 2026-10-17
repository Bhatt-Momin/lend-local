import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import * as Linking from 'expo-linking';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '../constants/theme';
import { paymentApi } from '../services/paymentApi';
import type {
  PaymentIntentItem,
  PaymentStatus,
  SettlementDebt,
  UpiIntentResponse,
} from '../types/api';
import { formatINR } from '../utils/format';
import {
  buildCreateIntentPayload,
  buildIntentActionPayload,
  canCancelIntent,
  canClaimIntent,
  canConfirmIntent,
  canRejectIntent,
  getPaymentStatusBadge,
  isTerminalStatus,
  validatePaymentAmount,
} from '../utils/paymentForm';

export interface PaymentModalProps {
  visible: boolean;
  onClose: () => void;
  groupId: string;
  settlement: SettlementDebt | null;
  currentUserId?: string | null;
  existingIntent?: PaymentIntentItem | null;
  onIntentUpdated?: () => void | Promise<void>;
}

export function PaymentModal({
  visible,
  onClose,
  groupId,
  settlement,
  currentUserId,
  existingIntent,
  onIntentUpdated,
}: PaymentModalProps) {
  // Creation form state
  const [amountInput, setAmountInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isActionInProgress, setIsActionInProgress] = useState<boolean>(false);
  const [isRefreshingStatus, setIsRefreshingStatus] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState<boolean>(false);
  const [isRecipientUpiMissing, setIsRecipientUpiMissing] = useState<boolean>(false);

  // Active / Tracked Intent State
  const [currentIntentId, setCurrentIntentId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<PaymentStatus | null>(null);
  const [currentAmount, setCurrentAmount] = useState<number | null>(null);
  const [currentPayeeName, setCurrentPayeeName] = useState<string | null>(null);
  const [currentPayerName, setCurrentPayerName] = useState<string | null>(null);
  const [currentPayeeUpiId, setCurrentPayeeUpiId] = useState<string | null>(null);
  const [currentUpiUri, setCurrentUpiUri] = useState<string | null>(null);
  const [currentFromId, setCurrentFromId] = useState<string | null>(null);
  const [currentToId, setCurrentToId] = useState<string | null>(null);

  // UPI launch feedback state
  const [launchStatus, setLaunchStatus] = useState<'idle' | 'launched' | 'fallback'>('idle');

  // Refs for bounded polling and preventing stale / overlapping updates
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef<number>(0);
  const isPollingFetchRef = useRef<boolean>(false);
  const statusRequestIdRef = useRef<number>(0);
  const MAX_POLL_COUNT = 12; // 12 iterations * 5000ms = 60s max
  const POLL_INTERVAL_MS = 5000;

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollCountRef.current = 0;
    isPollingFetchRef.current = false;
  }, []);

  // Initialize or reset modal state
  useEffect(() => {
    if (visible && settlement) {
      setFormError(null);
      setFormSuccess(null);
      setRefreshWarning(null);
      setIsConflict(false);
      setIsRecipientUpiMissing(false);
      setIsSubmitting(false);
      setIsActionInProgress(false);
      setIsRefreshingStatus(false);

      if (existingIntent) {
        const fromId = String(
          typeof existingIntent.from === 'object' && existingIntent.from
            ? (existingIntent.from as any)._id || (existingIntent.from as any).id
            : existingIntent.from
        );
        const toId = String(
          typeof existingIntent.to === 'object' && existingIntent.to
            ? (existingIntent.to as any)._id || (existingIntent.to as any).id
            : existingIntent.to
        );
        setCurrentIntentId(existingIntent.intentId);
        setCurrentStatus(existingIntent.status);
        setCurrentAmount(existingIntent.amount);
        setCurrentPayeeName(existingIntent.payeeName || settlement.to?.name || 'Recipient');
        setCurrentPayerName(existingIntent.payerName || settlement.from?.name || 'Payer');
        setCurrentPayeeUpiId((existingIntent as any).payeeUpiId || null);
        setCurrentUpiUri(existingIntent.upiUri || null);
        setCurrentFromId(fromId);
        setCurrentToId(toId);
        setLaunchStatus('idle');
        setAmountInput(existingIntent.amount.toFixed(2));
      } else {
        const toId = String(settlement.to?.userId ?? settlement.to?.id ?? '');
        setCurrentIntentId(null);
        setCurrentStatus(null);
        setCurrentAmount(null);
        setCurrentPayeeName(settlement.to?.name || 'Recipient');
        setCurrentPayerName(settlement.from?.name || 'Payer');
        setCurrentPayeeUpiId(null);
        setCurrentUpiUri(null);
        setCurrentFromId(String(currentUserId || ''));
        setCurrentToId(toId);
        setLaunchStatus('idle');
        setAmountInput(settlement.amount.toFixed(2));
      }
    } else {
      stopPolling();
    }
  }, [visible, settlement, existingIntent, currentUserId, stopPolling]);

  // Bounded polling tick implementation
  const pollStatusTick = useCallback(async () => {
    if (!currentIntentId || !currentStatus || isTerminalStatus(currentStatus)) {
      stopPolling();
      return;
    }

    if (pollCountRef.current >= MAX_POLL_COUNT) {
      stopPolling();
      return;
    }

    // Guard: prevent overlapping concurrent polling requests
    if (isPollingFetchRef.current || isActionInProgress) return;
    isPollingFetchRef.current = true;
    pollCountRef.current += 1;

    const currentReqId = ++statusRequestIdRef.current;
    try {
      const res = await paymentApi.getStatus(currentIntentId);
      // Guard: ignore stale responses if another request completed in between
      if (currentReqId === statusRequestIdRef.current) {
        if (res.status !== currentStatus) {
          setCurrentStatus(res.status);
          if (onIntentUpdated) {
            onIntentUpdated();
          }
        }
        if (isTerminalStatus(res.status)) {
          stopPolling();
        }
      }
    } catch {
      // Background polling errors are caught silently to prevent UI disruption
    } finally {
      isPollingFetchRef.current = false;
    }
  }, [currentIntentId, currentStatus, isActionInProgress, stopPolling, onIntentUpdated]);

  // Manage polling timer: active when visible and non-terminal status
  useEffect(() => {
    stopPolling();

    if (
      visible &&
      currentIntentId &&
      currentStatus &&
      !isTerminalStatus(currentStatus) &&
      (currentStatus === 'payer_claimed' || currentStatus === 'pending')
    ) {
      pollCountRef.current = 0;
      pollTimerRef.current = setInterval(pollStatusTick, POLL_INTERVAL_MS);
    }

    return () => {
      stopPolling();
    };
  }, [visible, currentIntentId, currentStatus, stopPolling, pollStatusTick]);

  if (!settlement) return null;

  const authorizedAmount = settlement.amount;
  const isPayer = Boolean(
    currentUserId &&
    currentFromId &&
    String(currentFromId) === String(currentUserId)
  );
  const isRecipient = Boolean(
    currentUserId &&
    currentToId &&
    String(currentToId) === String(currentUserId)
  );

  const canClaim = Boolean(
    currentIntentId && currentStatus && canClaimIntent(currentStatus, isPayer)
  );
  const canCancel = Boolean(
    currentIntentId && currentStatus && canCancelIntent(currentStatus, isPayer)
  );
  const canConfirm = Boolean(
    currentIntentId && currentStatus && canConfirmIntent(currentStatus, isRecipient)
  );
  const canReject = Boolean(
    currentIntentId && currentStatus && canRejectIntent(currentStatus, isRecipient)
  );

  const isTerminal = Boolean(currentStatus && isTerminalStatus(currentStatus));
  const badgeInfo = currentStatus ? getPaymentStatusBadge(currentStatus) : null;

  const displayPayeeName = currentPayeeName || settlement.to?.name || 'Group Member';
  const displayPayerName = currentPayerName || settlement.from?.name || 'Group Member';
  const displayAmount = currentAmount ?? authorizedAmount;

  const handleFullAmount = () => {
    setAmountInput(authorizedAmount.toFixed(2));
    setFormError(null);
  };

  const handleLaunchUpi = async (upiUri: string) => {
    try {
      await Linking.openURL(upiUri);
      setLaunchStatus('launched');
    } catch {
      setLaunchStatus('fallback');
    }
  };

  // M2: Create Intent flow
  const handlePay = async () => {
    if (isSubmitting) return;

    setFormError(null);
    setFormSuccess(null);
    setRefreshWarning(null);
    setIsConflict(false);
    setIsRecipientUpiMissing(false);

    // 1. Client-side validation matching backend integer paise arithmetic
    const validation = validatePaymentAmount(amountInput, authorizedAmount);
    if (!validation.valid) {
      setFormError(validation.message || 'Invalid payment amount');
      return;
    }

    // 2. Build payload
    const recipientId = String(settlement.to?.userId ?? settlement.to?.id ?? '');
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
      setCurrentIntentId(res.intentId);
      setCurrentStatus(res.status || 'pending');
      setCurrentAmount(res.amount);
      setCurrentPayeeName(res.payeeName);
      setCurrentPayerName(settlement.from?.name || 'You');
      setCurrentPayeeUpiId(res.payeeUpiId);
      setCurrentUpiUri(res.upiUri);
      setCurrentFromId(String(currentUserId || ''));
      setCurrentToId(recipientId);

      if (onIntentUpdated) {
        try {
          await onIntentUpdated();
        } catch {
          // Non-blocking
        }
      }

      // Attempt to launch external UPI app
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
          `${displayPayeeName} has not set up a UPI ID yet. Please ask them to add their UPI ID in Profile Settings.`
        );
      } else {
        setFormError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // M3: Payer Claim flow
  const handleClaim = () => {
    if (isActionInProgress || !canClaim || !currentIntentId) return;

    Alert.alert(
      'Confirm Payment Claim',
      `Did you finish sending ${formatINR(displayAmount)} via UPI to ${displayPayeeName}?\n\nOnce claimed, the recipient will be notified to confirm receipt. The debt remains on your balance until confirmed.`,
      [
        { text: 'Not Yet', style: 'cancel' },
        {
          text: "Yes, I've Paid",
          onPress: async () => {
            setIsActionInProgress(true);
            setFormError(null);
            setFormSuccess(null);
            setRefreshWarning(null);
            try {
              const payload = buildIntentActionPayload(currentIntentId);
              const res = await paymentApi.claim(payload);
              setCurrentStatus(res.status);
              setFormSuccess(res.message || 'Payment claimed successfully');
              if (onIntentUpdated) {
                try {
                  await onIntentUpdated();
                } catch {
                  setRefreshWarning('Payment was claimed on the server, but balances could not be refreshed immediately. Please pull down to refresh.');
                }
              }
            } catch (err: any) {
              setFormError(err?.message || 'Failed to claim payment');
            } finally {
              setIsActionInProgress(false);
            }
          },
        },
      ]
    );
  };

  // M3: Payer Cancel flow (strictly allowed only while status === 'pending')
  const handleCancel = () => {
    if (isActionInProgress || !canCancel || !currentIntentId) return;

    Alert.alert(
      'Cancel Payment Intent',
      'Are you sure you want to cancel this pending payment intent?\n\n⚠️ Note: Cancellation does NOT reverse any money already sent through your UPI app.',
      [
        { text: 'Keep Intent', style: 'cancel' },
        {
          text: 'Cancel Payment',
          style: 'destructive',
          onPress: async () => {
            setIsActionInProgress(true);
            setFormError(null);
            setFormSuccess(null);
            setRefreshWarning(null);
            try {
              const payload = buildIntentActionPayload(currentIntentId);
              const res = await paymentApi.cancel(payload);
              setCurrentStatus(res.status);
              stopPolling();
              setFormSuccess(res.message || 'Payment intent cancelled');
              if (onIntentUpdated) {
                try {
                  await onIntentUpdated();
                } catch {
                  setRefreshWarning('Payment was cancelled on the server, but balances could not be refreshed immediately. Please pull down to refresh.');
                }
              }
            } catch (err: any) {
              setFormError(err?.message || 'Failed to cancel payment');
            } finally {
              setIsActionInProgress(false);
            }
          },
        },
      ]
    );
  };

  // M4: Recipient Confirm Receipt flow (strictly allowed only while status === 'payer_claimed')
  const handleConfirmReceipt = () => {
    if (isActionInProgress || !canConfirm || !currentIntentId) return;

    Alert.alert(
      'Confirm Payment Receipt',
      `Did you check your bank account or UPI app and confirm that ${formatINR(displayAmount)} was received from ${displayPayerName}?\n\n⚠️ Once confirmed, this settlement will be authoritatively applied to the group balances.`,
      [
        { text: 'Not Yet', style: 'cancel' },
        {
          text: 'Yes, Confirm Receipt',
          onPress: async () => {
            setIsActionInProgress(true);
            setFormError(null);
            setFormSuccess(null);
            setRefreshWarning(null);
            try {
              const payload = buildIntentActionPayload(currentIntentId);
              const res = await paymentApi.confirm(payload);
              setCurrentStatus(res.status);
              stopPolling();
              setFormSuccess(res.message || 'Payment confirmed. The settlement has been applied to the ledger.');
              if (onIntentUpdated) {
                try {
                  await onIntentUpdated();
                } catch {
                  setRefreshWarning('Payment was confirmed successfully on the server, but group balances could not be refreshed immediately. Please pull down to refresh.');
                }
              }
            } catch (err: any) {
              setFormError(err?.message || 'Failed to confirm payment receipt');
            } finally {
              setIsActionInProgress(false);
            }
          },
        },
      ]
    );
  };

  // M4: Recipient Reject Claim flow (strictly allowed only while status === 'payer_claimed')
  const handleRejectClaim = () => {
    if (isActionInProgress || !canReject || !currentIntentId) return;

    Alert.alert(
      'Reject Payment Claim',
      `Are you sure you want to reject this payment claim from ${displayPayerName}?\n\n⚠️ Confirm only if you verified that you did NOT receive ${formatINR(displayAmount)}. No changes will be made to group balances.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject Claim',
          style: 'destructive',
          onPress: async () => {
            setIsActionInProgress(true);
            setFormError(null);
            setFormSuccess(null);
            setRefreshWarning(null);
            try {
              const payload = buildIntentActionPayload(currentIntentId);
              const res = await paymentApi.reject(payload);
              setCurrentStatus(res.status);
              stopPolling();
              setFormSuccess(res.message || 'Payment rejected. No ledger change has been made.');
              if (onIntentUpdated) {
                try {
                  await onIntentUpdated();
                } catch {
                  setRefreshWarning('Payment was rejected on the server, but group balances could not be refreshed immediately. Please pull down to refresh.');
                }
              }
            } catch (err: any) {
              setFormError(err?.message || 'Failed to reject payment claim');
            } finally {
              setIsActionInProgress(false);
            }
          },
        },
      ]
    );
  };

  // Manual Status Refresh
  const handleManualRefresh = async () => {
    if (!currentIntentId || isActionInProgress || isRefreshingStatus) return;

    setIsRefreshingStatus(true);
    setFormError(null);
    setFormSuccess(null);
    setRefreshWarning(null);

    const currentReqId = ++statusRequestIdRef.current;
    try {
      const res = await paymentApi.getStatus(currentIntentId);
      if (currentReqId === statusRequestIdRef.current) {
        setCurrentStatus(res.status);
        if (onIntentUpdated) {
          try {
            await onIntentUpdated();
          } catch {
            // Non-blocking for manual status check
          }
        }
        if (isTerminalStatus(res.status)) {
          stopPolling();
        }
      }
    } catch (err: any) {
      setFormError(err?.message || 'Failed to refresh payment status');
    } finally {
      setIsRefreshingStatus(false);
    }
  };

  const handleStartNewPayment = () => {
    setCurrentIntentId(null);
    setCurrentStatus(null);
    setCurrentAmount(null);
    setCurrentUpiUri(null);
    setLaunchStatus('idle');
    setFormError(null);
    setFormSuccess(null);
    setRefreshWarning(null);
    setAmountInput(authorizedAmount.toFixed(2));
  };

  const isBusy = isSubmitting || isActionInProgress;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={isBusy ? undefined : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={isBusy ? undefined : onClose}
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
                  {currentIntentId
                    ? isRecipient
                      ? 'Review Payment Claim'
                      : 'UPI Payment Status'
                    : 'Pay via Direct UPI'}
                </ThemedText>
                <ThemedText type="small" style={styles.dialogSubtitle}>
                  {currentIntentId
                    ? isRecipient
                      ? 'Verify and confirm incoming funds'
                      : 'Track and manage peer-to-peer settlement'
                    : 'Settle your share peer-to-peer'}
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={onClose}
                disabled={isBusy}
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
                  {isRecipient ? 'Payer:' : 'Paying To:'}
                </ThemedText>
                <ThemedText type="smallBold" style={styles.debtSummaryValue}>
                  {isRecipient ? displayPayerName : displayPayeeName}
                </ThemedText>
              </View>
              <View style={styles.debtSummaryRow}>
                <ThemedText type="small" style={styles.debtSummaryLabel}>
                  Authorized Debt:
                </ThemedText>
                <ThemedText type="smallBold" style={styles.debtAmountValue}>
                  {formatINR(authorizedAmount)}
                </ThemedText>
              </View>
            </View>

            {/* Error / Success / Warning Feedback Banners */}
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

            {formSuccess ? (
              <View style={styles.successBox}>
                <ThemedText style={styles.successText}>✓ {formSuccess}</ThemedText>
              </View>
            ) : null}

            {refreshWarning ? (
              <View style={styles.warningBox}>
                <ThemedText style={styles.warningText}>⚠️ {refreshWarning}</ThemedText>
              </View>
            ) : null}

            {/* ========================================================= */}
            {/* VIEW A: TRACKING EXISTING OR FRESHLY INITIATED INTENT     */}
            {/* ========================================================= */}
            {currentIntentId && currentStatus ? (
              <View style={styles.intentStatusContainer}>
                {/* Status Badge & Header */}
                <View
                  style={[
                    styles.statusBadgeRow,
                    badgeInfo ? { backgroundColor: badgeInfo.bgColor } : null,
                  ]}
                >
                  <ThemedText
                    style={[
                      styles.statusBadgeText,
                      badgeInfo ? { color: badgeInfo.color } : null,
                    ]}
                  >
                    {badgeInfo?.label ?? currentStatus}
                  </ThemedText>
                  <TouchableOpacity
                    style={styles.refreshBtn}
                    onPress={handleManualRefresh}
                    disabled={isRefreshingStatus || isBusy}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Refresh status"
                  >
                    {isRefreshingStatus ? (
                      <ActivityIndicator size="small" color="#38BDF8" />
                    ) : (
                      <ThemedText style={styles.refreshBtnText}>🔄 Refresh</ThemedText>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Intent Details Box */}
                <View style={styles.intentDetailsCard}>
                  <View style={styles.detailRow}>
                    <ThemedText type="small" style={styles.detailLabel}>
                      {isRecipient ? 'Claimed Amount:' : 'Initiated Amount:'}
                    </ThemedText>
                    <ThemedText type="smallBold" style={styles.detailValue}>
                      {formatINR(displayAmount)}
                    </ThemedText>
                  </View>

                  {currentPayeeUpiId ? (
                    <View style={styles.detailRow}>
                      <ThemedText type="small" style={styles.detailLabel}>
                        Recipient VPA:
                      </ThemedText>
                      <ThemedText
                        type="smallBold"
                        style={[styles.detailValue, styles.vpaText]}
                        selectable
                      >
                        {currentPayeeUpiId}
                      </ThemedText>
                    </View>
                  ) : null}

                  <View style={styles.detailRow}>
                    <ThemedText type="small" style={styles.detailLabel}>
                      Payment Note:
                    </ThemedText>
                    <ThemedText type="small" style={styles.detailValue}>
                      LendLocal Settlement
                    </ThemedText>
                  </View>
                </View>

                {/* Status Guidance Card for Payer */}
                {isPayer && currentStatus === 'pending' ? (
                  <View style={styles.noticeBox}>
                    <ThemedText type="small" style={styles.noticeText}>
                      ℹ️ <ThemedText type="smallBold" style={styles.boldNotice}>Action Required:</ThemedText>{' '}
                      If you sent the money via your UPI app, tap{' '}
                      <ThemedText type="smallBold" style={styles.boldWhite}>
                        &ldquo;I Have Paid&rdquo;
                      </ThemedText>{' '}
                      below so the recipient is notified to confirm receipt. If you did not send it, you can safely cancel.
                    </ThemedText>
                  </View>
                ) : null}

                {isPayer && currentStatus === 'payer_claimed' ? (
                  <View style={styles.claimedNoticeBox}>
                    <ThemedText type="small" style={styles.claimedNoticeText}>
                      ⏳ <ThemedText type="smallBold" style={styles.boldNotice}>Awaiting Recipient Confirmation:</ThemedText>{' '}
                      You claimed this payment. The recipient must confirm receipt before your group balance is updated.
                    </ThemedText>
                    <ThemedText type="small" style={styles.subNoticeText}>
                      • Once claimed, this payment cannot be cancelled.
                      {'\n'}• Status updates automatically when confirmed.
                    </ThemedText>
                  </View>
                ) : null}

                {/* Status Guidance Card for Recipient (M4) */}
                {isRecipient && currentStatus === 'payer_claimed' ? (
                  <View style={styles.verificationCard}>
                    <ThemedText style={styles.verificationTitle}>
                      ⚠️ Verification Required
                    </ThemedText>
                    <ThemedText type="small" style={styles.verificationSub}>
                      {displayPayerName} states they transferred {formatINR(displayAmount)} to you via UPI. Please check your bank account or UPI app (Google Pay, PhonePe, Paytm, etc.) to verify receipt before confirming.
                    </ThemedText>
                  </View>
                ) : null}

                {isRecipient && currentStatus === 'pending' ? (
                  <View style={styles.noticeBox}>
                    <ThemedText type="small" style={styles.noticeText}>
                      ℹ️ {displayPayerName} initiated this payment intent, but has not yet claimed that the payment was sent.
                    </ThemedText>
                  </View>
                ) : null}

                {currentStatus === 'recipient_confirmed' ? (
                  <View style={styles.confirmedNoticeBox}>
                    <ThemedText type="small" style={styles.confirmedNoticeText}>
                      🎉 <ThemedText type="smallBold" style={styles.boldNotice}>Confirmed!</ThemedText>{' '}
                      {isRecipient
                        ? 'You confirmed receiving this payment. The settlement has been applied to group balances.'
                        : 'The recipient confirmed receipt. This settlement is authoritatively recorded on the ledger.'}
                    </ThemedText>
                  </View>
                ) : null}

                {currentStatus === 'recipient_rejected' ? (
                  <View style={styles.errorBox}>
                    <ThemedText style={styles.errorText}>
                      ❌ <ThemedText type="smallBold" style={styles.boldNotice}>Payment Rejected:</ThemedText>{' '}
                      {isRecipient
                        ? 'You rejected this payment claim. No ledger changes were made.'
                        : 'The recipient stated they did not receive this payment. No ledger changes were made.'}
                    </ThemedText>
                  </View>
                ) : null}

                {currentStatus === 'cancelled' ? (
                  <View style={styles.noticeBox}>
                    <ThemedText type="small" style={styles.noticeText}>
                      ℹ️ This payment intent was cancelled. No money was recorded as settled.
                    </ThemedText>
                  </View>
                ) : null}

                {/* Third-party observer notice */}
                {!isPayer && !isRecipient ? (
                  <View style={styles.noticeBox}>
                    <ThemedText type="small" style={styles.noticeText}>
                      ℹ️ You are viewing this settlement intent in read-only mode.
                    </ThemedText>
                  </View>
                ) : null}

                {/* Action Buttons */}
                <View style={styles.intentActionsWrap}>
                  {/* M4: Recipient Actions (Confirm & Reject) */}
                  {canConfirm ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.confirmBtn, isBusy && styles.btnDisabled]}
                      onPress={handleConfirmReceipt}
                      disabled={isBusy}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="Confirm payment receipt"
                    >
                      {isActionInProgress ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <ThemedText style={styles.confirmBtnText}>✓ Confirm Receipt</ThemedText>
                      )}
                    </TouchableOpacity>
                  ) : null}

                  {canReject ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.rejectBtn, isBusy && styles.btnDisabled]}
                      onPress={handleRejectClaim}
                      disabled={isBusy}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Reject payment claim"
                    >
                      <ThemedText style={styles.rejectBtnText}>✕ Reject Claim</ThemedText>
                    </TouchableOpacity>
                  ) : null}

                  {/* M3: Payer Pending Controls: Claim and Cancel */}
                  {canClaim ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.claimBtn, isBusy && styles.btnDisabled]}
                      onPress={handleClaim}
                      disabled={isBusy}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel="I have completed this UPI payment"
                    >
                      {isActionInProgress ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <ThemedText style={styles.claimBtnText}>✓ I Have Paid</ThemedText>
                      )}
                    </TouchableOpacity>
                  ) : null}

                  {/* Re-launch UPI App if URI is available and status is pending */}
                  {currentUpiUri && currentStatus === 'pending' && isPayer ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.secondaryBtn, isBusy && styles.btnDisabled]}
                      onPress={() => handleLaunchUpi(currentUpiUri)}
                      disabled={isBusy}
                      activeOpacity={0.8}
                    >
                      <ThemedText style={styles.secondaryBtnText}>
                        Re-open UPI App
                      </ThemedText>
                    </TouchableOpacity>
                  ) : null}

                  {/* Cancel button: strictly allowed only while status === 'pending' */}
                  {canCancel ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.cancelPaymentBtn, isBusy && styles.btnDisabled]}
                      onPress={handleCancel}
                      disabled={isBusy}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel payment intent"
                    >
                      <ThemedText style={styles.cancelPaymentBtnText}>
                        Cancel Payment
                      </ThemedText>
                    </TouchableOpacity>
                  ) : null}

                  {/* If cancelled, allow starting a fresh payment */}
                  {currentStatus === 'cancelled' && isPayer ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.primaryBtn]}
                      onPress={handleStartNewPayment}
                      activeOpacity={0.8}
                    >
                      <ThemedText style={styles.primaryBtnText}>
                        New Payment
                      </ThemedText>
                    </TouchableOpacity>
                  ) : null}

                  {/* Close / Done Button */}
                  <TouchableOpacity
                    style={[styles.btn, styles.closeBtn]}
                    onPress={onClose}
                    disabled={isBusy}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.closeBtnDisplayText}>
                      {isTerminal ? 'Close' : 'Done'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* ========================================================= */}
            {/* VIEW B: M2 CREATE NEW PAYMENT INTENT FORM                 */}
            {/* ========================================================= */}
            {!currentIntentId ? (
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

                {/* Informational Guidance */}
                <View style={styles.noticeBox}>
                  <ThemedText type="small" style={styles.noticeText}>
                    ℹ️ Tapping &ldquo;Pay via UPI&rdquo; initiates a direct payment intent and opens your installed UPI app (Google Pay, PhonePe, Paytm, etc.).
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
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    padding: Spacing.two + 1,
  },
  warningText: {
    color: '#FCD34D',
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
    lineHeight: 17,
  },
  successBox: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    padding: Spacing.two + 1,
  },
  successText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
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
  claimedNoticeBox: {
    backgroundColor: '#0284C71A',
    borderColor: '#0284C74D',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two + 2,
    gap: 4,
  },
  claimedNoticeText: {
    color: '#38BDF8',
    fontSize: 12,
    lineHeight: 17,
  },
  verificationCard: {
    backgroundColor: '#0284C71A',
    borderColor: '#0284C780',
    borderWidth: 1.5,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  verificationTitle: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
  verificationSub: {
    color: '#E2E8F0',
    fontSize: 12,
    lineHeight: 18,
  },
  subNoticeText: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  confirmedNoticeBox: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two + 2,
  },
  confirmedNoticeText: {
    color: '#34D399',
    fontSize: 12,
    lineHeight: 17,
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
  // Intent tracking status view styles
  intentStatusContainer: {
    gap: Spacing.three,
  },
  statusBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
    backgroundColor: '#0F172A66',
    borderRadius: Spacing.one,
  },
  refreshBtnText: {
    fontSize: 12,
    color: '#38BDF8',
    fontWeight: '600',
  },
  intentDetailsCard: {
    backgroundColor: '#0F172A',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#334155',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  detailValue: {
    color: '#F8FAFC',
    fontSize: 13,
  },
  vpaText: {
    color: '#38BDF8',
    fontWeight: '700',
  },
  intentActionsWrap: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  confirmBtn: {
    backgroundColor: '#10B981',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  rejectBtn: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444480',
    borderWidth: 1,
  },
  rejectBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
  claimBtn: {
    backgroundColor: '#10B981',
  },
  claimBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cancelPaymentBtn: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
  },
  cancelPaymentBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  primaryBtn: {
    backgroundColor: '#2563EB',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtn: {
    backgroundColor: '#334155',
  },
  secondaryBtnText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  closeBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
  },
  closeBtnDisplayText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
});
