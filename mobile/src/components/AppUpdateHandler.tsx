/**
 * AppUpdateHandler.tsx — In-App Update Prompt Modal for LendLocal Android
 *
 * Checks for updates on application boot and presents a non-blocking prompt
 * when a newer Android versionCode is published in the version manifest.
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
  Platform,
} from 'react-native';
import { checkAppUpdate, openApkDownload, AppVersionManifest } from '../services/updateService';
import { Brand, Surfaces } from '../constants/theme';

export function AppUpdateHandler() {
  const [manifest, setManifest] = useState<AppVersionManifest | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function verifyUpdate() {
      const result = await checkAppUpdate();
      if (isMounted && result.hasUpdate && result.manifest) {
        setManifest(result.manifest);
        setVisible(true);
      }
    }

    verifyUpdate();

    return () => {
      isMounted = false;
    };
  }, []);

  if (!visible || !manifest) {
    return null;
  }

  const handleDownload = () => {
    openApkDownload(manifest.apkUrl);
  };

  const handleDismiss = () => {
    setVisible(false);
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={handleDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>🚀</Text>
          </View>

          <Text style={styles.title}>Update Available</Text>
          <Text style={styles.versionTag}>
            Version {manifest.latestVersion} (Build {manifest.versionCode})
          </Text>

          <View style={styles.notesContainer}>
            <Text style={styles.notesHeader}>What's New:</Text>
            <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator={false}>
              <Text style={styles.notesText}>{manifest.releaseNotes}</Text>
            </ScrollView>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.laterButton}
              onPress={handleDismiss}
              activeOpacity={0.7}
            >
              <Text style={styles.laterButtonText}>Later</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.downloadButton}
              onPress={handleDownload}
              activeOpacity={0.8}
            >
              <Text style={styles.downloadButtonText}>Download Update</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0A0E14',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 28,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    marginBottom: 4,
    textAlign: 'center',
  },
  versionTag: {
    fontSize: 13,
    fontWeight: '600',
    color: Brand.primary,
    marginBottom: 16,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  notesContainer: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    padding: 14,
    marginBottom: 20,
    maxHeight: 140,
  },
  notesHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7A93A6',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  notesScroll: {
    maxHeight: 90,
  },
  notesText: {
    fontSize: 13,
    color: '#D1D9E0',
    lineHeight: 19,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  laterButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7A93A6',
  },
  downloadButton: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Brand.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  downloadButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#030507',
  },
});
