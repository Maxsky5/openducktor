import { createHash } from "node:crypto";
import path from "node:path";
import type { IPersistence } from "@azure/msal-node-extensions";
import { Effect } from "effect";
import { toHostOperationError } from "../../../effect/host-errors";
import { openOsSecurePersistence } from "../os-secure-store";

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

  const createPersistence = (scope: string, record: "connection" | "msal") => {
    const name = recordName(scope, record);
    return openOsSecurePersistence({
      cachePath: recordPath(name),
      serviceName: SERVICE_NAME,
      accountName: name,
      providerLabel: "Azure DevOps",
    });
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
