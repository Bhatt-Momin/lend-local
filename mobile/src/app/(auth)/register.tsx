import { Link, useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ServerConfigModal } from '../../components/ServerConfigModal';
import { ThemedText } from '../../components/themed-text';
import { ThemedView } from '../../components/themed-view';
import { Spacing } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, serverUrl } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showServerModal, setShowServerModal] = useState(false);

  const handleRegister = async () => {
    setErrorMessage(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('Please enter your full name');
      return;
    }

    if (trimmedName.length < 2) {
      setErrorMessage('Name must be at least 2 characters');
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage('Please enter your email address');
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter a password');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      await register(trimmedName, trimmedEmail, password);
      // Navigate to Home on success
      router.replace('/');
    } catch (err: any) {
      const msg = err?.message || 'Registration failed. Please try again.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Top Navigation */}
            <View style={styles.topNav}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backBtn}
                accessibilityLabel="Go back"
              >
                <ThemedText style={styles.backText}>← Back</ThemedText>
              </TouchableOpacity>
            </View>

            {/* Brand Header */}
            <View style={styles.headerSection}>
              <Image
                source={require('@/assets/images/icon-192.png')}
                style={styles.logoImage}
                resizeMode="contain"
                accessibilityLabel="LendLocal Logo"
              />
              <ThemedText type="title" style={styles.title}>
                Create Account
              </ThemedText>
              <ThemedText type="small" style={styles.subtitle}>
                Join LendLocal to track shared expenses and settle balances
              </ThemedText>
            </View>

            {/* Server Connection Badge */}
            <TouchableOpacity
              style={styles.serverBadge}
              onPress={() => setShowServerModal(true)}
              activeOpacity={0.7}
            >
              <View style={styles.serverDot} />
              <ThemedText type="small" style={styles.serverText} numberOfLines={1}>
                Server: {serverUrl || 'Detecting...'}
              </ThemedText>
              <ThemedText type="small" style={styles.serverChangeText}>
                Edit
              </ThemedText>
            </TouchableOpacity>

            {/* Error Banner */}
            {errorMessage && (
              <View style={styles.errorBanner}>
                <ThemedText style={styles.errorIcon}>⚠️</ThemedText>
                <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
              </View>
            )}

            {/* Form Fields */}
            <View style={styles.formCard}>
              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Full Name
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="e.g. Alex Morgan"
                  placeholderTextColor="#888"
                  autoCapitalize="words"
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Email Address
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="name@example.com"
                  placeholderTextColor="#888"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Password
                </ThemedText>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    value={password}
                    onChangeText={(val) => {
                      setPassword(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="At least 6 characters"
                    placeholderTextColor="#888"
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSubmitting}
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowPassword((prev) => !prev)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <ThemedText style={styles.eyeText}>
                      {showPassword ? 'Hide' : 'Show'}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Confirm Password
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(val) => {
                    setConfirmPassword(val);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="Repeat your password"
                  placeholderTextColor="#888"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                onPress={handleRegister}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <View style={styles.submittingContainer}>
                    <ActivityIndicator color="#fff" size="small" />
                    <ThemedText style={styles.submitBtnText}>Creating account...</ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.submitBtnText}>Create Account</ThemedText>
                )}
              </TouchableOpacity>
            </View>

            {/* Switch to Login */}
            <View style={styles.switchAuthRow}>
              <ThemedText type="small" style={styles.switchPrompt}>
                Already have an account?{' '}
              </ThemedText>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity>
                  <ThemedText type="smallBold" style={styles.switchLink}>
                    Sign in
                  </ThemedText>
                </TouchableOpacity>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <ServerConfigModal
          visible={showServerModal}
          onClose={() => setShowServerModal(false)}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.one,
  },
  backBtn: {
    paddingVertical: Spacing.one,
    paddingRight: Spacing.two,
  },
  backText: {
    color: '#3B82F6',
    fontSize: 15,
    fontWeight: '600',
  },
  headerSection: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
  },
  logoImage: {
    width: 56,
    height: 56,
    borderRadius: 14,
    marginBottom: Spacing.one,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 18,
  },
  serverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B80',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    gap: Spacing.one,
  },
  serverDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  serverText: {
    flex: 1,
    fontSize: 12,
    opacity: 0.8,
  },
  serverChangeText: {
    color: '#3B82F6',
    fontWeight: '600',
    fontSize: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    backgroundColor: '#EF44441F',
    borderColor: '#EF444466',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  errorIcon: {
    fontSize: 15,
  },
  errorText: {
    flex: 1,
    color: '#EF4444',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  formCard: {
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  fieldGroup: {
    gap: Spacing.one,
  },
  label: {
    fontSize: 13,
    opacity: 0.9,
  },
  input: {
    backgroundColor: '#1E293B50',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
    color: '#fff',
    minHeight: 48,
  },
  passwordContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 60,
  },
  eyeBtn: {
    position: 'absolute',
    right: Spacing.three,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
  eyeText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '600',
  },
  submitBtn: {
    backgroundColor: '#2563EB',
    borderRadius: Spacing.two,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.65,
  },
  submitBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  submittingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  switchAuthRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  switchPrompt: {
    opacity: 0.75,
  },
  switchLink: {
    color: '#3B82F6',
  },
});
