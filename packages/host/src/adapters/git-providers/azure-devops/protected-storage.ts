import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { toHostOperationError } from "../../../effect/host-errors";

const SERVICE_NAME = "OpenDucktor Azure DevOps";

export type AzureDevOpsProtectedStorage = {
  hasSavedRecord(
    scope: string,
    record: "connection" | "msal",
  ): Effect.Effect<boolean, ReturnType<typeof toHostOperationError>>;
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
    hasSavedRecord(scope: string, record: "connection" | "msal") {
      return Effect.tryPromise({
        try: async () => {
          try {
            const marker = await stat(recordPath(scope, record));
            // MSAL creates an empty cache file before it saves credentials on each supported OS.
            return marker.size > 0;
          } catch (cause) {
            if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
              return false;
            }
            throw cause;
          }
        },
        catch: (cause) =>
          toHostOperationError(cause, "azureDevOps.protectedStorage.check", { record }),
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
