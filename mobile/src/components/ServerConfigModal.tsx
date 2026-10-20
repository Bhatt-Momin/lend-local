import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
  getDefaultApiBaseUrl,
  HEALTH_CHECK_TIMEOUT_MS,
  validateApiBaseUrl,
} from '../services/config';

interface ServerConfigModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ServerConfigModal({ visible, onClose }: ServerConfigModalProps) {
  const { serverUrl, updateServerUrl, resetToDefaultServerUrl } = useAuth();
  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleOpen = () => {
    setInputUrl(serverUrl || getDefaultApiBaseUrl());
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    const validation = validateApiBaseUrl(inputUrl);
    if (!validation.valid || !validation.normalizedUrl) {
      setTestResult({
        success: false,
        message: validation.error || 'Please enter a valid server URL',
      });
      return;
    }

    const targetUrl = validation.normalizedUrl;
    setInputUrl(targetUrl);
    setIsTesting(true);
    setTestResult(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    try {
      const healthEndpoint = `${targetUrl}/health`;
      const res = await fetch(healthEndpoint, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        setTestResult({
          success: true,
          message: `Connected successfully! (HTTP ${res.status})`,
        });
      } else {
        setTestResult({
          success: false,
          message: `Server returned HTTP ${res.status}. Expected /api/health to return 200.`,
        });
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      let msg = 'Connection failed';
      if (err?.name === 'AbortError') {
        const seconds = Math.round(HEALTH_CHECK_TIMEOUT_MS / 1000);
        msg = `Connection timed out (${seconds}s). If the hosted Render service was idle, it may need 30–50s to wake up. Please wait a moment and try again.`;
      } else if (err?.message) {
        msg = `${err.message}. Ensure backend is running and reachable.`;
      }
      setTestResult({ success: false, message: msg });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    const validation = validateApiBaseUrl(inputUrl);
    if (!validation.valid || !validation.normalizedUrl) {
      Alert.alert('Invalid URL', validation.error || 'Please enter a valid backend API URL');
      return;
    }

    const targetUrl = validation.normalizedUrl;
    setInputUrl(targetUrl);

    try {
      await updateServerUrl(targetUrl);
      Alert.alert('Settings Saved', `API server URL set to:\n${targetUrl}`);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save URL');
    }
  };

  const handleReset = async () => {
    try {
      await resetToDefaultServerUrl();
      const defaultUrl = getDefaultApiBaseUrl();
      setInputUrl(defaultUrl);
      setTestResult(null);
      Alert.alert('Settings Reset', `Reset to auto-detected default:\n${defaultUrl}`);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to reset URL');
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onShow={handleOpen}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <ThemedView type="backgroundElement" style={styles.modalContent}>
          <ThemedText type="smallBold" style={styles.title}>
            Connection Settings
          </ThemedText>

          <ThemedText type="small" style={styles.description}>
            Configure the backend API address. The hosted production service is on Render and may take 30–50 seconds to wake up if idle. For local development, use your computer's local network IP address.
          </ThemedText>

          <View style={styles.inputContainer}>
            <ThemedText type="smallBold" style={styles.inputLabel}>
              API Base URL
            </ThemedText>
            <TextInput
              style={styles.input}
              value={inputUrl}
              onChangeText={(text) => {
                setInputUrl(text);
                setTestResult(null);
              }}
              placeholder="e.g. https://lendlocal-58sf.onrender.com/api"
              placeholderTextColor="#888"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!isTesting}
            />
          </View>

          {testResult && (
            <View
              style={[
                styles.resultBox,
                testResult.success ? styles.resultSuccess : styles.resultError,
              ]}
            >
              <ThemedText style={testResult.success ? styles.resultTextSuccess : styles.resultTextError}>
                {testResult.success ? '✅ ' : '⚠️ '}
                {testResult.message}
              </ThemedText>
            </View>
          )}

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnOutline, isTesting && styles.btnDisabled]}
              onPress={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting ? (
                <ActivityIndicator size="small" color="#2563EB" />
              ) : (
                <ThemedText style={styles.btnOutlineText}>Test Connection</ThemedText>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, isTesting && styles.btnDisabled]}
              onPress={handleSave}
              disabled={isTesting}
            >
              <ThemedText style={styles.btnPrimaryText}>Save & Apply</ThemedText>
            </TouchableOpacity>
          </View>

          <View style={styles.footerRow}>
            <TouchableOpacity
              onPress={handleReset}
              style={styles.resetBtn}
              disabled={isTesting}
            >
              <ThemedText type="small" style={styles.resetText}>
                Reset to Default Auto-Detect
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              disabled={isTesting}
            >
              <ThemedText type="small" style={styles.closeText}>
                Cancel
              </ThemedText>
            </TouchableOpacity>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.three,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  description: {
    opacity: 0.75,
    lineHeight: 19,
  },
  inputContainer: {
    gap: Spacing.one,
  },
  inputLabel: {
    fontSize: 13,
  },
  input: {
    backgroundColor: '#00000022',
    color: '#fff',
    borderColor: '#444',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  resultBox: {
    padding: Spacing.two,
    borderRadius: Spacing.one,
    borderWidth: 1,
  },
  resultSuccess: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
  },
  resultError: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF44444D',
  },
  resultTextSuccess: {
    color: '#10B981',
    fontSize: 13,
  },
  resultTextError: {
    color: '#EF4444',
    fontSize: 13,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  btn: {
    flex: 1,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnPrimary: {
    backgroundColor: '#2563EB',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  btnOutlineText: {
    color: '#3B82F6',
    fontWeight: '600',
    fontSize: 14,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.one,
  },
  resetBtn: {
    paddingVertical: Spacing.one,
  },
  resetText: {
    color: '#9CA3AF',
    textDecorationLine: 'underline',
  },
  closeBtn: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  closeText: {
    color: '#9CA3AF',
  },
});
