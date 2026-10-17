import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Spacing } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { validateUpiId } from '../utils/paymentForm';

interface UpiConfigModalProps {
  visible: boolean;
  onClose: () => void;
}

export function UpiConfigModal({ visible, onClose }: UpiConfigModalProps) {
  const { user, updateUpiId } = useAuth();
  const [upiInput, setUpiInput] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setUpiInput(user?.upiId || '');
      setFormError(null);
      setSuccessMsg(null);
      setIsBusy(false);
    }
  }, [visible, user?.upiId]);

  const handleSave = async () => {
    if (isBusy) return;

    setFormError(null);
    setSuccessMsg(null);

    const validation = validateUpiId(upiInput, false);
    if (!validation.valid) {
      setFormError(validation.error || 'Please enter a valid UPI ID (e.g. username@bank)');
      return;
    }

    setIsBusy(true);
    try {
      const res = await updateUpiId(validation.upiId);
      setSuccessMsg(res.message || 'UPI ID saved successfully');
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save UPI ID');
    } finally {
      setIsBusy(false);
    }
  };

  const handleClear = () => {
    if (isBusy || !user?.upiId) return;

    Alert.alert(
      'Remove UPI ID',
      'Are you sure you want to remove your saved UPI ID? Other group members will not be able to pay you directly via UPI until you add one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsBusy(true);
            setFormError(null);
            setSuccessMsg(null);
            try {
              const res = await updateUpiId(null);
              setUpiInput('');
              setSuccessMsg(res.message || 'UPI ID cleared successfully');
              setTimeout(() => {
                onClose();
              }, 1000);
            } catch (err: any) {
              setFormError(err?.message || 'Failed to remove UPI ID');
            } finally {
              setIsBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
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
          {/* Header */}
          <View style={styles.dialogHeader}>
            <View style={styles.titleWrap}>
              <ThemedText type="smallBold" style={styles.dialogTitle}>
                Direct UPI ID
              </ThemedText>
              <ThemedText type="small" style={styles.dialogSubtitle}>
                Receive direct peer-to-peer settlement payments
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              disabled={isBusy}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Close UPI configuration"
            >
              <ThemedText style={styles.closeBtnText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Current Status Badge */}
          <View style={styles.statusRow}>
            <ThemedText type="small" style={styles.statusLabel}>
              Current VPA:
            </ThemedText>
            <ThemedText
              type="smallBold"
              style={[styles.statusValue, !user?.upiId && styles.statusNotConfigured]}
              numberOfLines={1}
            >
              {user?.upiId || 'Not configured'}
            </ThemedText>
          </View>

          {/* Input field */}
          <View style={styles.inputWrap}>
            <ThemedText type="smallBold" style={styles.inputLabel}>
              Virtual Payment Address (VPA)
            </ThemedText>
            <TextInput
              style={[styles.input, isBusy && styles.inputDisabled]}
              value={upiInput}
              onChangeText={(text) => {
                setUpiInput(text);
                if (formError) setFormError(null);
                if (successMsg) setSuccessMsg(null);
              }}
              placeholder="e.g. mobile@upi, name@okaxis"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!isBusy}
              accessibilityLabel="UPI ID input"
            />
          </View>

          {/* Error / Success Feedback */}
          {formError ? (
            <View style={styles.errorBox}>
              <ThemedText style={styles.errorText}>⚠️ {formError}</ThemedText>
            </View>
          ) : null}

          {successMsg ? (
            <View style={styles.successBox}>
              <ThemedText style={styles.successText}>✓ {successMsg}</ThemedText>
            </View>
          ) : null}

          {/* Disclaimer / Guidance */}
          <View style={styles.noticeBox}>
            <ThemedText type="small" style={styles.noticeText}>
              ℹ️ Note: Saving your UPI ID enables group members to launch UPI apps directly to settle debts with you. LendLocal does not verify ownership of this VPA.
            </ThemedText>
          </View>

          {/* Action buttons */}
          <View style={styles.actionsRow}>
            {user?.upiId ? (
              <TouchableOpacity
                style={[styles.btn, styles.clearBtn, isBusy && styles.btnDisabled]}
                onPress={handleClear}
                disabled={isBusy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Remove UPI ID"
              >
                <ThemedText style={styles.clearBtnText}>Remove</ThemedText>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.btn, styles.cancelBtn, isBusy && styles.btnDisabled]}
              onPress={onClose}
              disabled={isBusy}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <ThemedText style={styles.cancelBtnText}>Cancel</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.saveBtn, isBusy && styles.btnDisabled]}
              onPress={handleSave}
              disabled={isBusy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Save UPI ID"
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <ThemedText style={styles.saveBtnText}>Save</ThemedText>
              )}
            </TouchableOpacity>
          </View>
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
    maxWidth: 420,
    borderRadius: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1E293B',
    gap: Spacing.three,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
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
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A66',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#33415566',
  },
  statusLabel: {
    color: '#94A3B8',
    fontSize: 12,
  },
  statusValue: {
    color: '#38BDF8',
    fontSize: 13,
    flex: 1,
  },
  statusNotConfigured: {
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  inputWrap: {
    gap: Spacing.one,
  },
  inputLabel: {
    fontSize: 13,
    color: '#F8FAFC',
  },
  input: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    color: '#F8FAFC',
    fontSize: 15,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  errorBox: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    padding: Spacing.two,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 12,
  },
  successBox: {
    backgroundColor: '#10B9811A',
    borderColor: '#10B9814D',
    borderWidth: 1,
    borderRadius: Spacing.one + 2,
    padding: Spacing.two,
  },
  successText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '600',
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
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  btn: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three + 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  clearBtn: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
    marginRight: 'auto',
  },
  clearBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  cancelBtn: {
    backgroundColor: '#334155',
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: '#2563EB',
    minWidth: 72,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
