import React, { useEffect, useState } from 'react';
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

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Brand, Spacing, Surfaces } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../services/api';
import type { UserProfile } from '../services/secureStore';

export interface PhoneVerificationModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: (user: UserProfile) => void;
}

export function PhoneVerificationModal({
  visible,
  onClose,
  onSuccess,
}: PhoneVerificationModalProps) {
  const { user, refreshUser } = useAuth();

  const isAlreadyVerified = Boolean(user?.phoneVerified && user?.phoneNumber);

  const [step, setStep] = useState<'input' | 'verify'>('input');
  const [isChangingNumber, setIsChangingNumber] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneMasked, setPhoneMasked] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Reset state whenever modal visibility changes
  useEffect(() => {
    if (visible) {
      setStep('input');
      setIsChangingNumber(false);
      setPhoneInput('');
      setPhoneMasked('');
      setOtpInput('');
      setErrorMessage(null);
      setInfoMessage(null);
      setCooldownSeconds(0);
      setIsLoading(false);
    } else {
      setCooldownSeconds(0);
    }
  }, [visible]);

  // Cooldown timer countdown cleanly tied to visible lifecycle
  useEffect(() => {
    if (!visible || cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [visible, cooldownSeconds]);

  // 1. Request verification code (Start verification)
  const handleSendCode = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmed = phoneInput.trim();
    if (!trimmed || !trimmed.startsWith('+') || trimmed.length < 8) {
      setErrorMessage(
        'Please enter a valid international phone number starting with "+" (e.g. +919876543210 or +14155552671)'
      );
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.startPhoneVerification(trimmed);
      setPhoneMasked(res.phoneMasked || trimmed);
      setCooldownSeconds(res.cooldownSeconds || 60);
      setInfoMessage(res.message || 'Verification code sent successfully');
      setStep('verify');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to send verification code');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Resend verification code
  const handleResendCode = async () => {
    if (cooldownSeconds > 0 || !phoneInput.trim()) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const res = await authApi.startPhoneVerification(phoneInput.trim());
      setPhoneMasked(res.phoneMasked || phoneInput.trim());
      setCooldownSeconds(res.cooldownSeconds || 60);
      setInfoMessage(res.message || 'A new verification code has been sent');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to resend verification code');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Confirm verification code
  const handleVerifyOtp = async () => {
    setErrorMessage(null);

    const trimmedOtp = otpInput.trim();
    if (!trimmedOtp || trimmedOtp.length !== 6 || !/^\d{6}$/.test(trimmedOtp)) {
      setErrorMessage('Please enter the 6-digit verification code');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.confirmPhoneVerification({
        otp: trimmedOtp,
        phoneNumber: phoneInput.trim(),
      });

      await refreshUser().catch(() => {});
      if (onSuccess && res.user) {
        onSuccess(res.user);
      }

      Alert.alert(
        'Phone Verified',
        res.message || 'Your phone number has been verified successfully.',
        [
          {
            text: 'Done',
            onPress: onClose,
          },
        ]
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Invalid or expired verification code');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Remove verified phone number
  const handleRemovePhone = () => {
    if (isLoading) return;

    Alert.alert(
      'Remove Verified Phone',
      'Are you sure you want to remove your verified phone number? You will no longer be able to recover your account via SMS OTP.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
              await authApi.removePhone();
              await refreshUser().catch(() => {});
              onClose();
            } catch (err: any) {
              setErrorMessage(err?.message || 'Failed to remove phone number');
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  };

  const formatCooldown = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalOverlay}
      >
        <ThemedView type="backgroundElement" style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <ThemedText type="smallBold" style={styles.headerTitle}>
              {isAlreadyVerified && !isChangingNumber
                ? 'Verified Phone Number'
                : 'Verify Phone Number'}
            </ThemedText>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close phone verification modal"
            >
              <ThemedText style={styles.closeBtn}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Error & Info Feedback */}
            {errorMessage ? (
              <View style={styles.errorBanner}>
                <ThemedText style={styles.errorText}>⚠️ {errorMessage}</ThemedText>
              </View>
            ) : null}

            {infoMessage ? (
              <View style={styles.infoBanner}>
                <ThemedText style={styles.infoText}>ℹ️ {infoMessage}</ThemedText>
              </View>
            ) : null}

            {/* CASE A: Already Verified (Manage View) */}
            {isAlreadyVerified && !isChangingNumber ? (
              <View style={styles.verifiedContainer}>
                <View style={styles.verifiedCard}>
                  <View style={styles.verifiedHeader}>
                    <View style={styles.verifiedIconBadge}>
                      <ThemedText style={styles.verifiedIcon}>✓</ThemedText>
                    </View>
                    <View style={styles.verifiedInfo}>
                      <ThemedText style={styles.verifiedTitle}>
                        Verified for Recovery
                      </ThemedText>
                      <ThemedText style={styles.verifiedNumber}>
                        {user?.phoneNumber}
                      </ThemedText>
                    </View>
                  </View>

                  {user?.phoneVerifiedAt ? (
                    <ThemedText type="small" style={styles.verifiedDate}>
                      Verified on{' '}
                      {new Date(user.phoneVerifiedAt).toLocaleDateString(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </ThemedText>
                  ) : null}

                  <ThemedText type="small" style={styles.verifiedDesc}>
                    This international phone number is linked to your account. You can use it to
                    receive SMS OTP codes to recover access if you forget your password.
                  </ThemedText>
                </View>

                {/* Actions */}
                <TouchableOpacity
                  style={styles.outlineBtn}
                  onPress={() => {
                    setIsChangingNumber(true);
                    setStep('input');
                    setPhoneInput('');
                    setErrorMessage(null);
                    setInfoMessage(null);
                  }}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.outlineBtnText}>
                    Change Phone Number
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dangerBtn}
                  onPress={handleRemovePhone}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#EF4444" size="small" />
                  ) : (
                    <ThemedText style={styles.dangerBtnText}>
                      Remove Phone Number
                    </ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {/* CASE B: Not Verified or Changing Number */}
            {(!isAlreadyVerified || isChangingNumber) && step === 'input' ? (
              <View style={styles.formSection}>
                <ThemedText type="small" style={styles.descText}>
                  {isChangingNumber
                    ? 'Enter your new international phone number. We will send an SMS verification code.'
                    : 'Add and verify your international phone number to enable instant SMS OTP account recovery.'}
                </ThemedText>

                <ThemedText type="smallBold" style={styles.fieldLabel}>
                  Phone Number (E.164)
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={phoneInput}
                  onChangeText={(val) => {
                    setPhoneInput(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="+919876543210"
                  placeholderTextColor="#888"
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />
                <ThemedText type="small" style={styles.hintText}>
                  Include country calling code starting with &quot;+&quot; (e.g. +919876543210 or +14155552671)
                </ThemedText>

                <TouchableOpacity
                  style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                  onPress={handleSendCode}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={styles.btnText}>
                      Send Verification Code
                    </ThemedText>
                  )}
                </TouchableOpacity>

                {isChangingNumber ? (
                  <TouchableOpacity
                    style={styles.cancelLink}
                    onPress={() => {
                      setIsChangingNumber(false);
                      setErrorMessage(null);
                      setInfoMessage(null);
                    }}
                    disabled={isLoading}
                  >
                    <ThemedText type="small" style={styles.cancelLinkText}>
                      Cancel change
                    </ThemedText>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {/* CASE C: OTP Verification Step */}
            {(!isAlreadyVerified || isChangingNumber) && step === 'verify' ? (
              <View style={styles.formSection}>
                <View style={styles.targetBadge}>
                  <ThemedText type="small" style={styles.targetLabel}>
                    Verification code sent to:
                  </ThemedText>
                  <ThemedText type="smallBold" style={styles.targetNumber}>
                    {phoneMasked || phoneInput}
                  </ThemedText>
                </View>

                <ThemedText type="smallBold" style={styles.fieldLabel}>
                  6-Digit SMS Verification Code
                </ThemedText>
                <TextInput
                  style={[styles.input, styles.otpInput]}
                  value={otpInput}
                  onChangeText={(val) => {
                    setOtpInput(val.replace(/\D/g, '').slice(0, 6));
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="123456"
                  placeholderTextColor="#888"
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!isLoading}
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                  onPress={handleVerifyOtp}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={styles.btnText}>Verify & Save</ThemedText>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.outlineBtn,
                    (cooldownSeconds > 0 || isLoading) && styles.btnDisabled,
                  ]}
                  onPress={handleResendCode}
                  disabled={cooldownSeconds > 0 || isLoading}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.outlineBtnText}>
                    {cooldownSeconds > 0
                      ? `Resend Code in ${formatCooldown(cooldownSeconds)}`
                      : 'Resend Verification Code'}
                  </ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.switchStepBtn}
                  onPress={() => {
                    setStep('input');
                    setErrorMessage(null);
                  }}
                  disabled={isLoading}
                >
                  <ThemedText type="small" style={styles.switchStepText}>
                    ← Use a different phone number
                  </ThemedText>
                </TouchableOpacity>
              </View>
            ) : null}
          </ScrollView>
        </ThemedView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    borderRadius: 20,
    backgroundColor: Surfaces.darkCard,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Surfaces.darkBorder,
  },
  headerTitle: {
    fontSize: 18,
    color: '#F8FAFC',
  },
  closeBtn: {
    fontSize: 20,
    color: '#94A3B8',
    padding: 4,
  },
  scrollContent: {
    padding: Spacing.four,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 10,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
  },
  infoBanner: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    borderRadius: 10,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  infoText: {
    color: '#93C5FD',
    fontSize: 13,
  },
  descText: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: Spacing.three,
  },
  fieldLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    marginBottom: Spacing.one,
  },
  input: {
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    color: '#F8FAFC',
    fontSize: 15,
  },
  otpInput: {
    textAlign: 'center',
    letterSpacing: 6,
    fontSize: 22,
    fontWeight: '700',
  },
  hintText: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 6,
    marginBottom: Spacing.four,
  },
  primaryBtn: {
    backgroundColor: Brand.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  btnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    backgroundColor: Surfaces.darkCardMid,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  outlineBtnText: {
    color: '#94A3B8',
    fontWeight: '600',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  switchStepBtn: {
    marginTop: Spacing.three,
    alignItems: 'center',
  },
  switchStepText: {
    color: Brand.primaryLight,
    fontSize: 13,
    fontWeight: '500',
  },
  cancelLink: {
    marginTop: Spacing.three,
    alignItems: 'center',
  },
  cancelLinkText: {
    color: '#94A3B8',
    fontSize: 13,
  },
  targetBadge: {
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    borderRadius: 10,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  targetLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  targetNumber: {
    color: Brand.primaryLight,
    fontSize: 15,
    marginTop: 2,
  },
  formSection: {
    marginTop: Spacing.one,
  },
  verifiedContainer: {
    gap: Spacing.three,
  },
  verifiedCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 14,
    padding: Spacing.four,
  },
  verifiedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  verifiedIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedIcon: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 18,
  },
  verifiedInfo: {
    flex: 1,
  },
  verifiedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#10B981',
  },
  verifiedNumber: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    marginTop: 2,
  },
  verifiedDate: {
    color: '#64748B',
    fontSize: 12,
    marginTop: Spacing.two,
  },
  verifiedDesc: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginTop: Spacing.two,
  },
  dangerBtn: {
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerBtnText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 14,
  },
});

