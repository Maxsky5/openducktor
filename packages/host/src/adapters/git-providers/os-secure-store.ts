import type { IPersistence } from "@azure/msal-node-extensions";

/**
 * Opens one record in the OS secure store: the macOS Keychain, Windows DPAPI, or Linux libsecret.
 * The cache file marks the record. On Windows, it holds the encrypted record.
 */
export const openOsSecurePersistence = async ({
  cachePath,
  serviceName,
  accountName,
  providerLabel,
}: {
  cachePath: string;
  serviceName: string;
  accountName: string;
  providerLabel: string;
}): Promise<IPersistence> => {
  const {
    DataProtectionScope,
    FilePersistenceWithDataProtection,
    KeychainPersistence,
    LibSecretPersistence,
  } = await import("@azure/msal-node-extensions");
  // PersistenceCreator validates through a shared test.cache file and credential.
  // Concurrent opens can overwrite or delete that validation data.
  switch (process.platform) {
    case "darwin":
      return KeychainPersistence.create(cachePath, serviceName, accountName);
    case "win32":
      return FilePersistenceWithDataProtection.create(cachePath, DataProtectionScope.CurrentUser);
    case "linux":
      return LibSecretPersistence.create(cachePath, serviceName, accountName);
    default:
      throw new Error(`${providerLabel} credential storage is unavailable on ${process.platform}.`);
  }
};
