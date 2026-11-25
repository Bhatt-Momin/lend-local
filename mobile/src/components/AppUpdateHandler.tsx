/**
 * AppUpdateHandler.tsx — In-App Update Prompt & Downloader for LendLocal Android
 *
 * Checks for updates on boot, presents a non-blocking prompt, downloads the APK
 * with real-time progress & cancellation, verifies SHA-256 file integrity, and
 * triggers the native Android package installer.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  checkAppUpdate,
  downloadUpdateApk,
  cancelUpdateDownload,
  verifyApkChecksum,
  canRequestPackageInstalls,
  openInstallPermissionSettings,
  installApk,
  openApkDownload,
  getInstalledVersionInfo,
  AppVersionManifest,
  DownloadProgress,
  UpdatePhase,
} from '../services/updateService';
import { setDismissedUpdateVersionCode, getDismissedUpdateVersionCode } from '../services/secureStore';
import { Brand } from '../constants/theme';

export function AppUpdateHandler() {
  const [manifest, setManifest] = useState<AppVersionManifest | null>(null);
  const [isMandatory, setIsMandatory] = useState(false);
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [progress, setProgress] = useState<DownloadProgress>({
    totalBytesWritten: 0,
    totalBytesExpectedToWrite: 0,
    percent: 0,
  });
  const [statusMessage, setStatusMessage] = useState('');

  const { version: installedVersion, versionCode: installedVersionCode } = getInstalledVersionInfo();

  useEffect(() => {
    let isMounted = true;

    async function verifyUpdate() {
      const result = await checkAppUpdate();
      if (isMounted && result.hasUpdate && result.manifest) {
        const dismissedCode = await getDismissedUpdateVersionCode();
        if (!result.isMandatory && dismissedCode !== null && dismissedCode >= result.manifest.versionCode) {
          // User has already dismissed this or a newer version - do not show modal
          setVisible(false);
          return;
        }
        setManifest(result.manifest);
        setIsMandatory(result.isMandatory);
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

  const handleStartUpdate = async () => {
    setPhase('downloading');
    setStatusMessage('Downloading update...');
    setProgress({ totalBytesWritten: 0, totalBytesExpectedToWrite: 0, percent: 0 });

    try {
      // 1. Download APK with real-time progress callback
      const localFileUri = await downloadUpdateApk(manifest, (prog) => {
        setProgress(prog);
      });

      // 2. Verify SHA-256 checksum integrity
      setPhase('verifying');
      setStatusMessage('Verifying package checksum...');
      await verifyApkChecksum(localFileUri, manifest.sha256);

      // 3. Check Android Install Unknown Apps permission
      setPhase('installing');
      setStatusMessage('Launching package installer...');

      const hasInstallPermission = await canRequestPackageInstalls();
      if (!hasInstallPermission) {
        Alert.alert(
          'Permission Required',
          'To install updates, please allow LendLocal to install unknown apps in system settings.',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => setPhase('idle') },
            {
              text: 'Open Settings',
              onPress: async () => {
                await openInstallPermissionSettings();
                setPhase('idle');
              },
            },
          ]
        );
        return;
      }

      // 4. Trigger native installation intent
      await installApk(localFileUri);
      setPhase('idle');
    } catch (err: any) {
      console.warn('[AppUpdateHandler] Update installation failed:', err);
      setPhase('error');
      setStatusMessage(err?.message || 'Failed to complete update');

      Alert.alert(
        'Update Installation Failed',
        err?.message || 'Could not download and verify the update.',
        manifest.releasesPageUrl
          ? [
              { text: 'Retry', onPress: () => setPhase('idle') },
              {
                text: 'Releases Page',
                onPress: () => {
                  if (manifest.releasesPageUrl) {
                    openApkDownload(manifest.releasesPageUrl);
                  }
                },
              },
            ]
          : [{ text: 'OK', onPress: () => setPhase('idle') }]
      );
    }
  };

  const handleCancelDownload = async () => {
    await cancelUpdateDownload();
    setPhase('idle');
    setStatusMessage('');
    setProgress({ totalBytesWritten: 0, totalBytesExpectedToWrite: 0, percent: 0 });
  };

  const handleDismiss = () => {
    if (isMandatory || phase === 'downloading') return;
    setDismissedUpdateVersionCode(manifest.versionCode);
    setVisible(false);
  };

  const isBusy = phase === 'downloading' || phase === 'verifying' || phase === 'installing';

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
          {isMandatory ? (
            <View style={styles.mandatoryBadge}>
              <Text style={styles.mandatoryBadgeText}>Required Update</Text>
            </View>
          ) : null}

          <Text style={styles.versionTag}>
            Installed: v{installedVersion} (Build {installedVersionCode}) → Latest: v{manifest.latestVersion} (Build {manifest.versionCode})
          </Text>

          {manifest.sha256 ? (
            <Text style={styles.checksumText} numberOfLines={1}>
              SHA-256: {manifest.sha256.slice(0, 16)}...
            </Text>
          ) : null}

          {/* Download Progress & Status View */}
          {isBusy ? (
            <View style={styles.progressContainer}>
              <View style={styles.statusRow}>
                <ActivityIndicator size="small" color={Brand.primary} />
                <Text style={styles.statusText}>{statusMessage}</Text>
              </View>

              {phase === 'downloading' ? (
                <>
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${Math.max(2, progress.percent)}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.progressMetricsRow}>
                    <Text style={styles.progressPercent}>{progress.percent}%</Text>
                    <Text style={styles.progressBytes}>
                      {progress.totalBytesExpectedToWrite > 0
                        ? `${(progress.totalBytesWritten / 1048576).toFixed(1)} / ${(
                            progress.totalBytesExpectedToWrite / 1048576
                          ).toFixed(1)} MB`
                        : `${(progress.totalBytesWritten / 1048576).toFixed(1)} MB`}
                    </Text>
                  </View>
                </>
              ) : null}
            </View>
          ) : (
            <View style={styles.notesContainer}>
              <Text style={styles.notesHeader}>What&apos;s New:</Text>
              <ScrollView style={styles.notesScroll} showsVerticalScrollIndicator={false}>
                <Text style={styles.notesText}>{manifest.releaseNotes}</Text>
              </ScrollView>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            {phase === 'downloading' ? (
              <TouchableOpacity
                style={styles.cancelDownloadButton}
                onPress={handleCancelDownload}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Cancel downloading update"
              >
                <Text style={styles.cancelDownloadButtonText}>Cancel Download</Text>
              </TouchableOpacity>
            ) : (
              <>
                {!isMandatory && !isBusy ? (
                  <TouchableOpacity
                    style={styles.laterButton}
                    onPress={handleDismiss}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Remind me later about this update"
                  >
                    <Text style={styles.laterButtonText}>Later</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.downloadButton,
                    isMandatory ? styles.downloadButtonFull : undefined,
                    isBusy ? styles.buttonDisabled : undefined,
                  ]}
                  onPress={handleStartUpdate}
                  activeOpacity={0.8}
                  disabled={isBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Download and install application update"
                >
                  <Text style={styles.downloadButtonText}>
                    {isBusy ? 'Processing...' : 'Download & Install'}
                  </Text>
                </TouchableOpacity>
              </>
            )}
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
  mandatoryBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 8,
  },
  mandatoryBadgeText: {
    color: '#F87171',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  versionTag: {
    fontSize: 12,
    fontWeight: '600',
    color: Brand.primary,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  checksumText: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 12,
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
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  notesScroll: {
    maxHeight: 90,
  },
  notesText: {
    fontSize: 13,
    color: '#CBD5E1',
    lineHeight: 18,
  },
  progressContainer: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  statusText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '500',
  },
  progressBarTrack: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Brand.primary,
    borderRadius: 4,
  },
  progressMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  progressPercent: {
    color: Brand.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  progressBytes: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  actionRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  laterButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterButtonText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  downloadButton: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadButtonFull: {
    flex: 1,
  },
  downloadButtonText: {
    color: '#030507',
    fontSize: 14,
    fontWeight: '700',
  },
  cancelDownloadButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelDownloadButtonText: {
    color: '#F87171',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
