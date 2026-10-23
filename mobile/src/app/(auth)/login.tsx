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
import { PasswordRecoveryModal } from '../../components/PasswordRecoveryModal';
import { ThemedText } from '../../components/themed-text';
import { ThemedView } from '../../components/themed-view';
import { Brand, Spacing, Surfaces } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen() {
  const router = useRouter();
  const { login, serverUrl } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showServerModal, setShowServerModal] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  const handleLogin = async () => {
    setErrorMessage(null);

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
      setErrorMessage('Please enter your password');
      return;
    }

    setIsSubmitting(true);

    try {
      await login(trimmedEmail, password);
      // Navigate to Home on success
      router.replace('/');
    } catch (err: any) {
      const msg = err?.message || 'Login failed. Please check your credentials.';
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
                Welcome Back
              </ThemedText>
              <ThemedText type="small" style={styles.subtitle}>
                Sign in to manage your shared expenses & balances
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
                <View style={styles.passwordLabelRow}>
                  <ThemedText type="smallBold" style={styles.label}>
                    Password
                  </ThemedText>
                  <TouchableOpacity
                    onPress={() => setShowRecoveryModal(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <ThemedText style={styles.forgotPasswordText}>
                      Forgot?
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                <View style={styles.passwordContainer}>
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    value={password}
                    onChangeText={(val) => {
                      setPassword(val);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="Enter your password"
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

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                onPress={handleLogin}
                disabled={isSubmitting}
                activeOpacity={0.8}
              >
                {isSubmitting ? (
                  <View style={styles.submittingContainer}>
                    <ActivityIndicator color="#fff" size="small" />
                    <ThemedText style={styles.submitBtnText}>Signing in...</ThemedText>
                  </View>
                ) : (
                  <ThemedText style={styles.submitBtnText}>Sign In</ThemedText>
                )}
              </TouchableOpacity>
            </View>

            {/* Switch to Register */}
            <View style={styles.switchAuthRow}>
              <ThemedText type="small" style={styles.switchPrompt}>
                Don't have an account?{' '}
              </ThemedText>
              <Link href="/(auth)/register" asChild>
                <TouchableOpacity>
                  <ThemedText type="smallBold" style={styles.switchLink}>
                    Sign up
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

        <PasswordRecoveryModal
          visible={showRecoveryModal}
          onClose={() => setShowRecoveryModal(false)}
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
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Surfaces.darkCardMid,
    borderWidth: 1,
    borderColor: Surfaces.darkBorder,
    alignSelf: 'flex-start',
  },
  backText: {
    color: Brand.primaryLight,
    fontWeight: '700',
    fontSize: 13,
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
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  subtitle: {
    opacity: 0.7,
    textAlign: 'center',
    lineHeight: 18,
  },
  serverBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Surfaces.darkCardMid,
    borderColor: Surfaces.darkBorder,
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
    backgroundColor: Brand.primary,
  },
  serverText: {
    flex: 1,
    fontSize: 12,
    opacity: 0.8,
  },
  serverChangeText: {
    color: Brand.primaryLight,
    fontWeight: '700',
    fontSize: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    backgroundColor: Brand.negativeDim,
    borderColor: 'rgba(239, 68, 68, 0.35)',
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
    color: Brand.negative,
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
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  forgotPasswordText: {
    color: Brand.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.9,
  },
  input: {
    backgroundColor: Surfaces.darkCardMid,
    borderColor: Surfaces.darkBorder,
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
    color: Brand.primaryLight,
    fontSize: 13,
    fontWeight: '700',
  },
  submitBtn: {
    backgroundColor: Brand.primary,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.one,
  },
  submitBtnDisabled: {
    opacity: 0.65,
  },
  submitBtnText: {
    color: '#030507',
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
    color: Brand.primaryLight,
    fontWeight: '700',
  },
});
