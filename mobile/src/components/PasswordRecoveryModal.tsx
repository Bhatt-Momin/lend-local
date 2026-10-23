import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { authApi } from '../services/api';

interface PasswordRecoveryModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function PasswordRecoveryModal({ visible, onClose, onSuccess }: PasswordRecoveryModalProps) {
  const [tab, setTab] = useState<'phone' | 'email'>('phone');

  // Phone flow states
  const [phone, setPhone] = useState('');
  const [phoneStep, setPhoneStep] = useState<'request' | 'reset'>('request');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  // Email flow states
  const [email, setEmail] = useState('');

  // Status & feedback
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Reset state on open
  useEffect(() => {
    if (visible) {
      setTab('phone');
      setPhone('');
      setPhoneStep('request');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setEmail('');
      setErrorMessage(null);
      setInfoMessage(null);
      setCooldownSeconds(0);
    }
  }, [visible]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  const handlePhoneRequest = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmed = phone.trim();
    if (!trimmed || !trimmed.startsWith('+')) {
      setErrorMessage('Please enter an international phone number starting with "+" (e.g. +919876543210 or +14155552671)');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.forgotPasswordPhone(trimmed);
      setInfoMessage(res.message || 'If an account is associated with this verified phone number, a verification code has been sent.');
      setPhoneStep('reset');
      setCooldownSeconds(res.cooldownSeconds || 300);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to initiate phone recovery');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendPhoneCode = async () => {
    if (cooldownSeconds > 0 || !phone.trim()) return;
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const res = await authApi.forgotPasswordPhone(phone.trim());
      setInfoMessage(res.message || 'A new verification code has been sent.');
      setCooldownSeconds(res.cooldownSeconds || 300);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to resend code');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoneReset = async () => {
    setErrorMessage(null);

    const trimmedOtp = otp.trim();
    if (!trimmedOtp || trimmedOtp.length !== 6 || !/^\d{6}$/.test(trimmedOtp)) {
      setErrorMessage('Please enter the 6-digit verification code');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.resetPasswordPhone({
        phoneNumber: phone.trim(),
        otp: trimmedOtp,
        password: newPassword,
      });

      Alert.alert(
        'Password Reset',
        res.message || 'Password has been reset successfully. Please sign in with your new password.',
        [
          {
            text: 'Sign In',
            onPress: () => {
              onClose();
              if (onSuccess) onSuccess();
            },
          },
        ]
      );
    } catch (err: any) {
      setErrorMessage(err?.message || 'Invalid or expired verification code');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailRequest = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.forgotPasswordEmail(trimmed);
      setInfoMessage(res.message || 'If an account with that email exists, recovery instructions have been sent.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to submit recovery request');
    } finally {
      setIsLoading(false);
    }
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
      <View style={styles.modalOverlay}>
        <ThemedView type="backgroundElement" style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <ThemedText type="smallBold" style={styles.headerTitle}>
              Account Recovery
            </ThemedText>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <ThemedText style={styles.closeBtn}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Segmented Control */}
          <View style={styles.tabsRow}>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'phone' && styles.tabBtnActive]}
              onPress={() => {
                setTab('phone');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.tabBtnText, tab === 'phone' && styles.tabBtnTextActive]}>
                📱 Verified Phone
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, tab === 'email' && styles.tabBtnActive]}
              onPress={() => {
                setTab('email');
                setErrorMessage(null);
                setInfoMessage(null);
              }}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.tabBtnText, tab === 'email' && styles.tabBtnTextActive]}>
                ✉️ Email Link
              </ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Feedback Alerts */}
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

            {/* TAB: Phone Recovery */}
            {tab === 'phone' && (
              <View style={styles.bodySection}>
                {phoneStep === 'request' ? (
                  <>
                    <ThemedText type="small" style={styles.descText}>
                      Enter your verified international phone number. If verified on an account, we will send an SMS OTP.
                    </ThemedText>

                    <ThemedText type="smallBold" style={styles.fieldLabel}>
                      Phone Number (E.164)
                    </ThemedText>
                    <TextInput
                      style={styles.input}
                      value={phone}
                      onChangeText={(val) => {
                        setPhone(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="+14155552671"
                      placeholderTextColor="#888"
                      keyboardType="phone-pad"
                      autoCapitalize="none"
                      editable={!isLoading}
                    />
                    <ThemedText type="small" style={styles.hintText}>
                      Include country calling code starting with &quot;+&quot; (e.g. +919876543210 or +14155552671)
                    </ThemedText>

                    <TouchableOpacity
                      style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                      onPress={handlePhoneRequest}
                      disabled={isLoading}
                      activeOpacity={0.8}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <ThemedText style={styles.btnText}>Send Recovery Code</ThemedText>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <View style={styles.targetBadge}>
                      <ThemedText type="small" style={styles.targetLabel}>
                        Recovery target:
                      </ThemedText>
                      <ThemedText type="smallBold" style={styles.targetNumber}>
                        {phone}
                      </ThemedText>
                    </View>

                    <ThemedText type="smallBold" style={styles.fieldLabel}>
                      6-Digit SMS Verification Code
                    </ThemedText>
                    <TextInput
                      style={[styles.input, styles.otpInput]}
                      value={otp}
                      onChangeText={(val) => {
                        setOtp(val.replace(/\D/g, '').slice(0, 6));
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="123456"
                      placeholderTextColor="#888"
                      keyboardType="number-pad"
                      maxLength={6}
                      editable={!isLoading}
                    />

                    <ThemedText type="smallBold" style={styles.fieldLabel}>
                      New Password
                    </ThemedText>
                    <View style={styles.passwordRow}>
                      <TextInput
                        style={[styles.input, styles.passwordInput]}
                        value={newPassword}
                        onChangeText={(val) => {
                          setNewPassword(val);
                          if (errorMessage) setErrorMessage(null);
                        }}
                        placeholder="••••••••"
                        placeholderTextColor="#888"
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        editable={!isLoading}
                      />
                      <TouchableOpacity
                        style={styles.eyeBtn}
                        onPress={() => setShowPassword((prev) => !prev)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <ThemedText style={styles.eyeBtnText}>
                          {showPassword ? 'Hide' : 'Show'}
                        </ThemedText>
                      </TouchableOpacity>
                    </View>

                    <ThemedText type="smallBold" style={styles.fieldLabel}>
                      Confirm New Password
                    </ThemedText>
                    <TextInput
                      style={styles.input}
                      value={confirmPassword}
                      onChangeText={(val) => {
                        setConfirmPassword(val);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="••••••••"
                      placeholderTextColor="#888"
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      editable={!isLoading}
                    />

                    <TouchableOpacity
                      style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                      onPress={handlePhoneReset}
                      disabled={isLoading}
                      activeOpacity={0.8}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <ThemedText style={styles.btnText}>Reset Password</ThemedText>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.outlineBtn, (cooldownSeconds > 0 || isLoading) && styles.btnDisabled]}
                      onPress={handleResendPhoneCode}
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
                        setPhoneStep('request');
                        setErrorMessage(null);
                      }}
                    >
                      <ThemedText type="small" style={styles.switchStepText}>
                        ← Use a different phone number
                      </ThemedText>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {/* TAB: Email Recovery */}
            {tab === 'email' && (
              <View style={styles.bodySection}>
                <ThemedText type="small" style={styles.descText}>
                  Enter your registered account email and we will send you secure password reset instructions.
                </ThemedText>

                <ThemedText type="smallBold" style={styles.fieldLabel}>
                  Email Address
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="you@example.com"
                  placeholderTextColor="#888"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, isLoading && styles.btnDisabled]}
                  onPress={handleEmailRequest}
                  disabled={isLoading}
                  activeOpacity={0.8}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={styles.btnText}>Send Reset Link</ThemedText>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  modalCard: {
    backgroundColor: Surfaces.darkCard,
    borderColor: Surfaces.darkBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: Spacing.four,
    maxHeight: '90%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  headerTitle: {
    fontSize: 18,
    color: '#F0F4F8',
  },
  closeBtn: {
    fontSize: 18,
    color: '#888',
    padding: 4,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    backgroundColor: 'transparent',
  },
  tabBtnActive: {
    backgroundColor: Brand.primaryDim,
    borderColor: Brand.primary,
  },
  tabBtnText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: Brand.primary,
  },
  bodySection: {
    marginTop: Spacing.one,
  },
  descText: {
    color: '#A0AEC0',
    marginBottom: Spacing.three,
    lineHeight: 18,
  },
  fieldLabel: {
    color: '#CBD5E0',
    marginBottom: Spacing.one,
    fontSize: 13,
  },
  input: {
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    borderRadius: 8,
    padding: Platform.OS === 'ios' ? 12 : 10,
    color: '#F0F4F8',
    fontSize: 15,
    marginBottom: Spacing.one,
  },
  otpInput: {
    letterSpacing: 4,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 60,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  eyeBtnText: {
    color: Brand.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  hintText: {
    color: '#718096',
    fontSize: 11,
    marginBottom: Spacing.three,
  },
  targetBadge: {
    backgroundColor: Surfaces.darkCardMid,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    marginBottom: Spacing.three,
  },
  targetLabel: {
    color: '#A0AEC0',
    fontSize: 11,
  },
  targetNumber: {
    color: '#F0F4F8',
    fontSize: 14,
    marginTop: 2,
  },
  primaryBtn: {
    backgroundColor: Brand.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: Surfaces.darkBorderBright,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  outlineBtnText: {
    color: '#CBD5E0',
    fontWeight: '600',
    fontSize: 13,
  },
  switchStepBtn: {
    marginTop: Spacing.three,
    alignItems: 'center',
  },
  switchStepText: {
    color: Brand.primary,
    fontSize: 13,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.two,
    marginBottom: Spacing.three,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
  },
  infoBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: Brand.primary,
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.two,
    marginBottom: Spacing.three,
  },
  infoText: {
    color: '#6EE7B7',
    fontSize: 12,
  },
});
