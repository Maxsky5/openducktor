import { createHash } from "node:crypto";
import path from "node:path";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { toHostOperationError } from "../../../effect/host-errors";

const SERVICE_NAME = "OpenDucktor Azure DevOps";

export type AzureDevOpsProtectedStorage = {
  readConnection(
    scope: string,
  ): Effect.Effect<string | null, ReturnType<typeof toHostOperationError>>;
  open(
    scope: string,
    record: "connection" | "msal",
  ): Effect.Effect<IPersistence, ReturnType<typeof toHostOperationError>>;
};

export const createAzureDevOpsProtectedStorage = ({ configDir }: { configDir: string }) => {
  const directory = path.join(configDir, "credentials", "azure-devops");
  const recordName = (scope: string, record: "connection" | "msal") => {
    const key = createHash("sha256").update(scope).digest("hex");
    return `${key}.${record}`;
  };
  const recordPath = (name: string) => path.join(directory, `${name}.cache`);

  const createPersistence = async (scope: string, record: "connection" | "msal") => {
    const {
      DataProtectionScope,
      FilePersistenceWithDataProtection,
      KeychainPersistence,
      LibSecretPersistence,
    } = await import("@azure/msal-node-extensions");
    const name = recordName(scope, record);
    const cachePath = recordPath(name);
    // PersistenceCreator validates through a shared test.cache file and credential.
    // Concurrent opens can overwrite or delete that validation data.
    switch (process.platform) {
      case "darwin":
        return KeychainPersistence.create(cachePath, SERVICE_NAME, name);
      case "win32":
        return FilePersistenceWithDataProtection.create(cachePath, DataProtectionScope.CurrentUser);
      case "linux":
        return LibSecretPersistence.create(cachePath, SERVICE_NAME, name);
      default:
        throw new Error(`Azure DevOps credential storage is unavailable on ${process.platform}.`);
    }
  };

  return {
    readConnection(scope: string) {
      return Effect.tryPromise({
        try: async () => {
          const persistence = await createPersistence(scope, "connection");
          return persistence.load();
        },
        catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.load"),
      });
    },
    open(scope: string, record: "connection" | "msal") {
      return Effect.tryPromise({
        try: () => createPersistence(scope, record),
        catch: (cause) =>
          toHostOperationError(cause, "azureDevOps.protectedStorage.open", {
            record,
            message: "The operating system secure credential store is unavailable.",
          }),
      });
    },
  } satisfies AzureDevOpsProtectedStorage;
};
