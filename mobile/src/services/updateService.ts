/**
 * updateService.ts — In-App Update Checker for LendLocal Android
 *
 * Inspects installed application version code via Expo Constants and queries
 * the backend /api/app-version manifest.
 *
 * Safety Invariants:
 * - Network errors are handled gracefully and never block app execution.
 * - Comparing uses numeric versionCode (monotonic integer), not semver string parsing.
 * - Opens downloads only via verified HTTPS URLs.
 * - Leaves actual installation and user authorization to the Android OS Package Installer.
 */

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { apiRequest } from './client';

export interface AppVersionManifest {
  latestVersion: string;
  versionCode: number;
  releaseNotes: string;
  apkUrl: string;
  releasesPageUrl?: string;
  minSupportedVersion?: string;
  publishedAt?: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  installedVersion: string;
  installedVersionCode: number;
  manifest: AppVersionManifest | null;
  error?: string;
}

/**
 * Returns the currently running app version and Android versionCode.
 */
export function getInstalledVersionInfo() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const versionCode = Constants.expoConfig?.android?.versionCode ?? 1;
  return { version, versionCode };
}

/**
 * Queries the backend for version manifest and compares installed versionCode.
 */
export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  const { version: installedVersion, versionCode: installedVersionCode } = getInstalledVersionInfo();

  try {
    const manifest = await apiRequest<AppVersionManifest>('/app-version', { timeoutMs: 10000 });

    if (!manifest || typeof manifest.versionCode !== 'number') {
      return {
        hasUpdate: false,
        installedVersion,
        installedVersionCode,
        manifest: null,
      };
    }

    const hasUpdate = manifest.versionCode > installedVersionCode;

    return {
      hasUpdate,
      installedVersion,
      installedVersionCode,
      manifest,
    };
  } catch (err: any) {
    // Graceful fallback: Network issues must never block the app
    return {
      hasUpdate: false,
      installedVersion,
      installedVersionCode,
      manifest: null,
      error: err?.message || 'Failed to check for updates',
    };
  }
}

/**
 * Safely triggers the Android package download / installer flow via supported linking.
 */
export async function openApkDownload(apkUrl: string): Promise<boolean> {
  if (!apkUrl || typeof apkUrl !== 'string' || !apkUrl.startsWith('https://')) {
    console.warn('Refusing to open invalid or non-HTTPS APK URL:', apkUrl);
    return false;
  }

  try {
    await Linking.openURL(apkUrl);
    return true;
  } catch (err) {
    console.warn('Failed to open APK URL via system linker:', err);
    return false;
  }
}
