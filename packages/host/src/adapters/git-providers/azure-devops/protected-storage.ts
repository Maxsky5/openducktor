import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { toHostOperationError } from "../../../effect/host-errors";

const SERVICE_NAME = "OpenDucktor Azure DevOps";

export type AzureDevOpsProtectedStorage = {
  open(
    scope: string,
    record: "connection" | "msal",
  ): Effect.Effect<IPersistence, ReturnType<typeof toHostOperationError>>;
};

export const createAzureDevOpsProtectedStorage = ({ configDir }: { configDir: string }) =>
  ({
    open(scope: string, record: "connection" | "msal") {
      return Effect.tryPromise({
        try: async () => {
          const { DataProtectionScope, PersistenceCreator } =
            await import("@azure/msal-node-extensions");
          const key = createHash("sha256").update(scope).digest("hex");
          const directory = path.join(configDir, "credentials", "azure-devops");
          await mkdir(directory, { recursive: true });
          return PersistenceCreator.createPersistence({
            cachePath: path.join(directory, `${key}.${record}.cache`),
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
  }) satisfies AzureDevOpsProtectedStorage;
