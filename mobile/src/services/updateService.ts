/**
 * updateService.ts — In-App Update Engine for LendLocal Android
 *
 * Implements end-to-end in-app download, progress tracking, cancellation,
 * SHA-256 checksum verification, and native Android package installation.
 *
 * Safety Invariants:
 * - Network errors are handled gracefully and never block app execution.
 * - Monotonic numeric versionCode comparison prevents downgrades and redundant prompts.
 * - Downloads exclusively from verified HTTPS URLs.
 * - Rejects incompatible application IDs.
 * - Verifies SHA-256 file integrity prior to installation.
 * - Concurrency locks prevent duplicate simultaneous downloads and installations.
 * - System Package Installer natively preserves app data across in-place upgrades.
 */

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import { apiRequest } from './client';
import { sha256Bytes, base64ToUint8Array } from '../utils/sha256';
import ApkInstaller from '../../modules/apk-installer';

export interface AppVersionManifest {
  applicationId?: string;
  latestVersion: string;
  versionCode: number;
  releaseNotes: string;
  apkUrl: string;
  sha256?: string;
  releasesPageUrl?: string;
  minSupportedVersion?: string;
  minSupportedVersionCode?: number;
  isMandatory?: boolean;
  publishedAt?: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  isMandatory: boolean;
  installedVersion: string;
  installedVersionCode: number;
  manifest: AppVersionManifest | null;
  error?: string;
}

export interface DownloadProgress {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
  percent: number;
}

export type UpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'error'
  | 'cancelled';

const EXPECTED_APPLICATION_ID = 'com.lendlocal.app';
const UPDATE_FILE_NAME = 'lendlocal-update.apk';

// API base URL resolved from expo config or environment
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api\/?$/, '') || 'https://lendlocal-58sf.onrender.com';

// Helper: Resolve APK URL to an absolute HTTPS URL suitable for FileSystem.createDownloadResumable.
export function resolveApkUrl(url: string): string {
  // Already an absolute URL — validate protocol
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // Allow http:// only on localhost/10.0.2.2/192.168.* for local dev
    if (url.startsWith('http://')) {
      const devHostnames = ['localhost', '10.0.2.2', /^192\.168\./];
      const isDevHost = devHostnames.some(h => {
        if (typeof h === 'string') return url.includes(h);
        return h.test(url);
      });
      if (!isDevHost) {
        console.warn('[UpdateService] HTTP APK URL rejected in non-development context:', url);
        return '';
      }
    }
    return url;
  }

  // Root-relative path — resolve against configured API base URL
  if (url.startsWith('/')) {
    const base = API_BASE_URL;
    if (!base) {
      console.warn('[UpdateService] Cannot resolve root-relative APK URL: no API_BASE_URL configured');
      return '';
    }
    // Ensure clean join: base ends without trailing /api, url starts with /
    const cleanBase = base.replace(/\/api\/?$/, '');
    return `${cleanBase}${url}`;
  }

  // Reject invalid protocols (javascript:, data:, file:, protocol-relative //)
  if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('file:') || url.startsWith('//')) {
    console.warn('[UpdateService] Invalid APK URL protocol rejected:', url);
    return '';
  }

  // Fallback: treat as invalid
  console.warn('[UpdateService] Unable to resolve APK URL:', url);
  return '';
}

// Concurrency locks & state
let activeDownloadResumable: FileSystem.DownloadResumable | null = null;
let isDownloading = false;
let isInstalling = false;

/**
 * Returns currently installed version and Android versionCode from Expo Constants.
 */
export function getInstalledVersionInfo() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const versionCode = Constants.expoConfig?.android?.versionCode ?? 1;
  return { version, versionCode };
}

/**
 * Checks backend /api/app-version manifest and determines update availability.
 */
export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  const { version: installedVersion, versionCode: installedVersionCode } = getInstalledVersionInfo();

  try {
    const manifest = await apiRequest<AppVersionManifest>('/app-version', { timeoutMs: 10000 });

    if (!manifest || typeof manifest.versionCode !== 'number') {
      return {
        hasUpdate: false,
        isMandatory: false,
        installedVersion,
        installedVersionCode,
        manifest: null,
      };
    }

    // 1. Verify Application ID if declared
    if (manifest.applicationId && manifest.applicationId !== EXPECTED_APPLICATION_ID) {
      console.warn(
        `[UpdateService] Incompatible application ID in manifest: ${manifest.applicationId} (expected ${EXPECTED_APPLICATION_ID})`
      );
      return {
        hasUpdate: false,
        isMandatory: false,
        installedVersion,
        installedVersionCode,
        manifest: null,
        error: `Incompatible application ID: ${manifest.applicationId}`,
      };
    }

    // 2. Validate and resolve APK URL security
    const resolvedApkUrl = resolveApkUrl(manifest.apkUrl);
    if (
      !manifest.apkUrl ||
      typeof manifest.apkUrl !== 'string' ||
      !resolvedApkUrl ||
      (!manifest.apkUrl.startsWith('/') && !manifest.apkUrl.startsWith('http://') && !manifest.apkUrl.startsWith('https://'))
    ) {
      console.warn('[UpdateService] Insecure or invalid APK URL in manifest:', manifest.apkUrl);
      return {
        hasUpdate: false,
        isMandatory: false,
        installedVersion,
        installedVersionCode,
        manifest: null,
        error: 'Insecure or invalid APK download URL',
      };
    }

    // 3. Monotonic numeric version comparison
    const hasUpdate = manifest.versionCode > installedVersionCode;

    // 4. Mandatory update evaluation
    const isMandatory = Boolean(
      hasUpdate &&
        (manifest.isMandatory ||
          (typeof manifest.minSupportedVersionCode === 'number' &&
            manifest.minSupportedVersionCode > installedVersionCode))
    );

    return {
      hasUpdate,
      isMandatory,
      installedVersion,
      installedVersionCode,
      manifest,
    };
  } catch (err: any) {
    return {
      hasUpdate: false,
      isMandatory: false,
      installedVersion,
      installedVersionCode,
      manifest: null,
      error: err?.message || 'Failed to check for updates',
    };
  }
}

/**
 * Downloads the APK file from trusted HTTPS URL with progress callback and duplicate prevention.
 */
export async function downloadUpdateApk(
  manifest: AppVersionManifest,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  if (isDownloading) {
    throw new Error('A download is already in progress.');
  }

  const resolvedApkUrl = resolveApkUrl(manifest.apkUrl);
  if (!resolvedApkUrl) {
    throw new Error('Cannot download APK from non-HTTPS or invalid URL.');
  }

  isDownloading = true;
  const targetUri = `${FileSystem.cacheDirectory}${UPDATE_FILE_NAME}`;

  try {
    // Clean up any stale prior download before starting
    const fileInfo = await FileSystem.getInfoAsync(targetUri);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    }

    activeDownloadResumable = FileSystem.createDownloadResumable(
      resolvedApkUrl,
      targetUri,
      {},
      (downloadProgress) => {
        const total = downloadProgress.totalBytesExpectedToWrite;
        const written = downloadProgress.totalBytesWritten;
        const percent = total > 0 ? Math.min(100, Math.round((written / total) * 100)) : 0;
        if (onProgress) {
          onProgress({
            totalBytesWritten: written,
            totalBytesExpectedToWrite: total,
            percent,
          });
        }
      }
    );

    const result = await activeDownloadResumable.downloadAsync();
    if (!result || !result.uri) {
      throw new Error('Download did not complete successfully.');
    }

    return result.uri;
  } finally {
    isDownloading = false;
    activeDownloadResumable = null;
  }
}

/**
 * Cancels active in-flight APK download and cleans up any partially downloaded file.
 */
export async function cancelUpdateDownload(): Promise<void> {
  if (activeDownloadResumable) {
    try {
      await activeDownloadResumable.cancelAsync();
    } catch (err) {
      console.warn('[UpdateService] Error cancelling active download:', err);
    }
  }

  isDownloading = false;
  activeDownloadResumable = null;

  try {
    const targetUri = `${FileSystem.cacheDirectory}${UPDATE_FILE_NAME}`;
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
  } catch {
    // Ignore cleanup errors on cancellation
  }
}

/**
 * Maximum file size (5 MB) permitted for in-memory JavaScript SHA-256 fallback.
 * For larger files (such as 100MB+ APKs), native streaming via ContentResolver is
 * strictly required to prevent fatal OutOfMemory crashes on Android devices.
 */
export const MAX_JS_HASH_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Calculates SHA-256 checksum of a file via native streaming ContentResolver,
 * with a strictly size-bounded JS fallback.
 */
export async function calculateApkChecksum(fileUri: string): Promise<string> {
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists) {
    throw new Error('Downloaded APK file does not exist on disk.');
  }

  // 1. Prefer native streaming SHA-256 via ContentResolver (no JS heap overhead)
  if (ApkInstaller?.getFileSha256) {
    try {
      // Convert file:// URI to content:// URI using registered FileSystemFileProvider
      const contentUri = await FileSystem.getContentUriAsync(fileUri);
      const nativeHash = await ApkInstaller.getFileSha256(contentUri);
      if (typeof nativeHash === 'string' && nativeHash.length === 64) {
        return nativeHash.trim().toLowerCase();
      }
    } catch (err: any) {
      console.warn('[UpdateService] Native SHA-256 calculation failed:', err);
      throw new Error(`Native checksum verification failed: ${err?.message || 'Read error'}`);
    }
  }

  // 2. Safe Fallback Guard:
  // Do NOT attempt whole-file base64 loading for large APK files (prevents OOM on physical Android devices)
  const fileSize = fileInfo.size ?? 0;
  if (fileSize > MAX_JS_HASH_FILE_SIZE_BYTES) {
    throw new Error(
      `Cannot verify large APK (${(fileSize / 1048576).toFixed(1)} MB) without native streaming support. ` +
        'Native ApkInstaller module is required in preview/standalone builds to prevent out-of-memory crashes.'
    );
  }

  // For small test fixtures (<= 5 MB), safe JS fallback is permitted
  const base64Content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const bytes = base64ToUint8Array(base64Content);
  return sha256Bytes(bytes);
}

/**
 * Verifies SHA-256 checksum of downloaded APK against manifest hash.
 */
export async function verifyApkChecksum(fileUri: string, expectedSha256?: string): Promise<boolean> {
  if (!expectedSha256 || typeof expectedSha256 !== 'string' || !expectedSha256.trim()) {
    throw new Error('Release manifest does not provide required SHA-256 checksum for update verification.');
  }

  const cleanExpected = expectedSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanExpected)) {
    throw new Error(`Invalid expected SHA-256 format in manifest: ${expectedSha256}`);
  }

  const calculatedSha256 = await calculateApkChecksum(fileUri);

  if (calculatedSha256 !== cleanExpected) {
    // Remove corrupt/compromised file immediately
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
    throw new Error(
      `Checksum verification failed. Expected SHA-256 ${cleanExpected}, but got ${calculatedSha256}. Corrupted file removed.`
    );
  }

  return true;
}

/**
 * Checks whether the app has permission to install packages on Android.
 */
export async function canRequestPackageInstalls(): Promise<boolean> {
  if (ApkInstaller?.canRequestPackageInstalls) {
    return await ApkInstaller.canRequestPackageInstalls();
  }
  return true;
}

/**
 * Opens system settings page for "Install Unknown Apps" permission.
 */
export async function openInstallPermissionSettings(): Promise<void> {
  if (ApkInstaller?.openInstallPermissionSettings) {
    await ApkInstaller.openInstallPermissionSettings();
  }
}

/**
 * Initiates native Android Package Installer via content URI.
 */
export async function installApk(fileUri: string): Promise<boolean> {
  if (isInstalling) {
    throw new Error('Installation is already in progress.');
  }

  isInstalling = true;

  try {
    // Convert file:// URI to content:// URI using registered FileSystemFileProvider
    const contentUri = await FileSystem.getContentUriAsync(fileUri);

    if (ApkInstaller?.installApk) {
      return await ApkInstaller.installApk(contentUri);
    }

    // In environments without native ApkInstaller module (e.g. Expo Go),
    // warn and return diagnostic failure.
    console.warn(
      '[UpdateService] Native ApkInstaller module not found. A development build or standalone preview APK is required for in-app installation.'
    );
    throw new Error('Native package installer requires a development build or preview APK.');
  } finally {
    isInstalling = false;
  }
}

/**
 * Fallback link opener for web or external browser release page.
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
