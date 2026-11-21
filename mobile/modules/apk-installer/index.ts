import { requireOptionalNativeModule } from 'expo-modules-core';

export interface ApkInstallerNativeModule {
  canRequestPackageInstalls(): Promise<boolean>;
  openInstallPermissionSettings(): Promise<void>;
  installApk(contentUriString: string): Promise<boolean>;
  getFileSha256(uriString: string): Promise<string>;
}

const ApkInstaller = requireOptionalNativeModule<ApkInstallerNativeModule>('ApkInstaller');

export default ApkInstaller;
