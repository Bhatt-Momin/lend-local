import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '../../components/themed-text';
import { ThemedView } from '../../components/themed-view';
import { MaxContentWidth, Spacing } from '../../constants/theme';
import { groupsApi } from '../../services/api';

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [memberEmails, setMemberEmails] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddEmail = () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) return;

    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address');
      return;
    }

    if (memberEmails.includes(trimmed)) {
      Alert.alert('Duplicate Email', 'This email is already in the list');
      return;
    }

    setMemberEmails((prev) => [...prev, trimmed]);
    setEmailInput('');
    setError(null);
  };

  const handleRemoveEmail = (target: string) => {
    setMemberEmails((prev) => prev.filter((e) => e !== target));
  };

  const handleCreate = async () => {
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Group name is required');
      return;
    }

    if (trimmedName.length > 100) {
      setError('Group name must be 100 characters or less');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await groupsApi.create({
        name: trimmedName,
        description: description.trim() || undefined,
        memberEmails: memberEmails.length > 0 ? memberEmails : undefined,
      });

      // Navigate directly to the newly created group's detail screen
      router.replace(`/group/${res.group.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create group');
      setIsSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoid}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={styles.headerRow}>
              <TouchableOpacity
                onPress={() => router.back()}
                style={styles.cancelBtn}
                accessibilityLabel="Cancel"
                disabled={isSubmitting}
              >
                <ThemedText style={styles.cancelText}>Cancel</ThemedText>
              </TouchableOpacity>
              <ThemedText type="smallBold" style={styles.headerTitle}>
                New Group
              </ThemedText>
              <View style={styles.headerSpacer} />
            </View>

            {/* Error Banner */}
            {error ? (
              <View style={styles.errorCard}>
                <ThemedText style={styles.errorText}>⚠️ {error}</ThemedText>
              </View>
            ) : null}

            {/* Form Fields */}
            <ThemedView type="backgroundElement" style={styles.formCard}>
              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Group Name <ThemedText style={styles.required}>*</ThemedText>
                </ThemedText>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    if (error) setError(null);
                  }}
                  placeholder="e.g. Goa Trip, Flat 402, Office Lunch"
                  placeholderTextColor="#64748B"
                  maxLength={100}
                  editable={!isSubmitting}
                  autoFocus
                />
                <ThemedText type="small" style={styles.helperText}>
                  {name.length}/100 characters
                </ThemedText>
              </View>

              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Description (Optional)
                </ThemedText>
                <TextInput
                  style={[styles.input, styles.multilineInput]}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="What is this group for?"
                  placeholderTextColor="#64748B"
                  maxLength={300}
                  multiline
                  numberOfLines={3}
                  editable={!isSubmitting}
                />
                <ThemedText type="small" style={styles.helperText}>
                  {description.length}/300 characters
                </ThemedText>
              </View>
            </ThemedView>

            {/* Members Section */}
            <ThemedView type="backgroundElement" style={styles.formCard}>
              <View style={styles.fieldGroup}>
                <ThemedText type="smallBold" style={styles.label}>
                  Add Members by Email (Optional)
                </ThemedText>
                <ThemedText type="small" style={styles.noticeText}>
                  Added emails must belong to registered LendLocal accounts. You are automatically included as the creator.
                </ThemedText>

                <View style={styles.emailInputRow}>
                  <TextInput
                    style={[styles.input, styles.emailInputFlex]}
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="member@example.com"
                    placeholderTextColor="#64748B"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isSubmitting}
                    onSubmitEditing={handleAddEmail}
                  />
                  <TouchableOpacity
                    style={styles.addEmailBtn}
                    onPress={handleAddEmail}
                    disabled={isSubmitting || !emailInput.trim()}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.addEmailBtnText}>Add</ThemedText>
                  </TouchableOpacity>
                </View>

                {memberEmails.length > 0 ? (
                  <View style={styles.chipContainer}>
                    {memberEmails.map((email) => (
                      <View key={email} style={styles.chip}>
                        <ThemedText type="small" style={styles.chipText} numberOfLines={1}>
                          {email}
                        </ThemedText>
                        <TouchableOpacity
                          onPress={() => handleRemoveEmail(email)}
                          style={styles.chipRemove}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          disabled={isSubmitting}
                        >
                          <ThemedText style={styles.chipRemoveText}>✕</ThemedText>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </ThemedView>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
              onPress={handleCreate}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={styles.submitBtnText}>Create Group</ThemedText>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
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
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  cancelBtn: {
    paddingVertical: Spacing.one,
  },
  cancelText: {
    color: '#94A3B8',
    fontSize: 15,
  },
  headerTitle: {
    fontSize: 17,
  },
  headerSpacer: {
    width: 50,
  },
  errorCard: {
    backgroundColor: '#EF44441A',
    borderColor: '#EF444466',
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
  },
  formCard: {
    padding: Spacing.four,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  fieldGroup: {
    gap: Spacing.one,
  },
  label: {
    fontSize: 14,
  },
  required: {
    color: '#EF4444',
  },
  input: {
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
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  helperText: {
    opacity: 0.5,
    fontSize: 11,
    textAlign: 'right',
  },
  noticeText: {
    opacity: 0.7,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: Spacing.one,
  },
  emailInputRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  emailInputFlex: {
    flex: 1,
  },
  addEmailBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  addEmailBtnText: {
    color: '#F8FAFC',
    fontWeight: '600',
    fontSize: 14,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderColor: '#3B82F64D',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    gap: 6,
    maxWidth: '100%',
  },
  chipText: {
    fontSize: 12,
    color: '#93C5FD',
  },
  chipRemove: {
    paddingHorizontal: 2,
  },
  chipRemoveText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  submitBtn: {
    backgroundColor: '#2563EB',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: Spacing.two,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
