import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
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
  const recordPath = (scope: string, record: "connection" | "msal") => {
    const key = createHash("sha256").update(scope).digest("hex");
    return path.join(configDir, "credentials", "azure-devops", `${key}.${record}.cache`);
  };

  return {
    readConnection(scope: string) {
      return Effect.tryPromise({
        try: async () => {
          const {
            DataProtectionScope,
            FilePersistenceWithDataProtection,
            KeychainPersistence,
            LibSecretPersistence,
          } = await import("@azure/msal-node-extensions");
          const key = createHash("sha256").update(scope).digest("hex");
          const cachePath = recordPath(scope, "connection");
          let persistence: IPersistence;
          switch (process.platform) {
            case "darwin":
              persistence = await KeychainPersistence.create(
                cachePath,
                SERVICE_NAME,
                `${key}.connection`,
              );
              break;
            case "win32":
              persistence = await FilePersistenceWithDataProtection.create(
                cachePath,
                DataProtectionScope.CurrentUser,
              );
              break;
            case "linux":
              persistence = await LibSecretPersistence.create(
                cachePath,
                SERVICE_NAME,
                `${key}.connection`,
              );
              break;
            default:
              throw new Error(
                `Azure DevOps credential storage is unavailable on ${process.platform}.`,
              );
          }
          return persistence.load();
        },
        catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.load"),
      });
    },
    open(scope: string, record: "connection" | "msal") {
      return Effect.tryPromise({
        try: async () => {
          const { DataProtectionScope, PersistenceCreator } =
            await import("@azure/msal-node-extensions");
          const directory = path.join(configDir, "credentials", "azure-devops");
          await mkdir(directory, { recursive: true });
          const key = createHash("sha256").update(scope).digest("hex");
          return PersistenceCreator.createPersistence({
            cachePath: recordPath(scope, record),
            dataProtectionScope: DataProtectionScope.CurrentUser,
            serviceName: SERVICE_NAME,
            accountName: `${key}.${record}`,
            usePlaintextFileOnLinux: false,
          });
        },
        catch: (cause) =>
          toHostOperationError(cause, "azureDevOps.protectedStorage.open", {
            record,
            message: "The operating system secure credential store is unavailable.",
          }),
      });
    },
  } satisfies AzureDevOpsProtectedStorage;
};
