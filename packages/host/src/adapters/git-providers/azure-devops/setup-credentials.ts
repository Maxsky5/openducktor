import type { IPersistence } from "@azure/msal-node-extensions";
import { PublicClientApplication } from "@azure/msal-node";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../../effect/host-errors";
import type { WorkspaceProviderSetupCredentialsPort } from "../../../ports/workspace-provider-setup-credentials-port";
import { createAzureDevOpsConnectionAdapter, connectionScope } from "./connection";
import type { AzureDevOpsCredentialIndex } from "./credential-index";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";
import type { AzureDevOpsPublicClientFactory } from "./public-client";
import type { AzureDevOpsFetch } from "./rest-client";

/** Stages credentials in memory and tracks each protected write so cleanup removes only owned data. */
export const createWorkspaceProviderSetupCredentials = (input: {
  clientId: string | undefined;
  protectedStorage: AzureDevOpsProtectedStorage;
  credentialIndex: AzureDevOpsCredentialIndex;
  fetchImplementation?: AzureDevOpsFetch;
  publishConnectionState: NonNullable<
    Parameters<typeof createAzureDevOpsConnectionAdapter>[0]["publishConnectionState"]
  >;
}): WorkspaceProviderSetupCredentialsPort => {
  const records = new Map<string, string>();
  const applications = new Map<string, PublicClientApplication>();
  const transfers = new Map<
    string,
    {
      sourceScope: string;
      workspaceId: string;
      connection: boolean;
      cache: boolean;
      index: boolean;
      connectionOwned: boolean;
      cacheOwned: boolean;
      indexOwned: boolean;
    }
  >();
  const memoryStore = (key: string): IPersistence => ({
    save: async (value) => {
      records.set(key, value);
      for (const transfer of transfers.values()) {
        if (key !== `${transfer.sourceScope}\nconnection`) continue;
        transfer.connection = false;
        transfer.cache = false;
      }
    },
    load: async () => records.get(key) ?? null,
    delete: async () => records.delete(key),
    reloadNecessary: async () => false,
    getFilePath: () => key,
    getLogger: () => new PublicClientApplication({ auth: { clientId: "memory" } }).getLogger(),
    verifyPersistence: async () => true,
    createForPersistenceValidation: async () => memoryStore(key),
  });
  const memoryStorage: AzureDevOpsProtectedStorage = {
    readConnection: (scope) => Effect.sync(() => records.get(`${scope}\nconnection`) ?? null),
    open: (scope, record) => Effect.succeed(memoryStore(`${scope}\n${record}`)),
  };
  const publicClientFactory: AzureDevOpsPublicClientFactory = (clientId, _storage, scope) =>
    Effect.sync(() => {
      let application = applications.get(scope);
      if (!application) {
        application = new PublicClientApplication({
          auth: { clientId, authority: "https://login.microsoftonline.com/common" },
        });
        applications.set(scope, application);
      }
      return application;
    });
  const stagedConnection = createAzureDevOpsConnectionAdapter({
    ...input,
    protectedStorage: memoryStorage,
    credentialIndex: {
      register: () => Effect.void,
      list: () => Effect.succeed([]),
      forget: () => Effect.void,
    },
    publicClientFactory,
  });
  const connection = {
    ...stagedConnection,
    replacePat: (...args: Parameters<typeof stagedConnection.replacePat>) =>
      stagedConnection.replacePat(...args).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            applications.delete(connectionScope(args[0], args[1]));
          }),
        ),
      ),
  };
  return {
    connection,
    complete(source) {
      return Effect.gen(function* () {
        const repository = source.git.provider?.repository;
        if (repository && "deployment" in repository) {
          const scope = connectionScope(source, repository);
          yield* connection.removeWorkspaceCredentials(source);
          applications.delete(scope);
          records.delete(`${scope}\nconnection`);
          for (const [destination, transfer] of transfers)
            if (transfer.sourceScope === scope) transfers.delete(destination);
        }
      });
    },
    release(source) {
      return Effect.gen(function* () {
        yield* connection.removeWorkspaceCredentials(source);
        const repository = source.git.provider?.repository;
        if (repository && "deployment" in repository) {
          const scope = connectionScope(source, repository);
          for (const [destination, transfer] of transfers) {
            if (transfer.sourceScope !== scope) continue;
            for (const record of ["connection", "msal"] as const) {
              const owned =
                record === "connection" ? transfer.connectionOwned : transfer.cacheOwned;
              if (!owned) continue;
              const store = yield* input.protectedStorage.open(destination, record);
              yield* Effect.tryPromise({
                try: () => store.delete(),
                catch: (cause) =>
                  toHostOperationError(cause, "workspaceProviderSetup.cleanupTransfer", {
                    message: "Failed to discard credentials saved by this setup. Retry cleanup.",
                  }),
              });
              if (record === "connection") transfer.connectionOwned = false;
              else transfer.cacheOwned = false;
            }
            if (transfer.indexOwned)
              yield* input.credentialIndex.forget(transfer.workspaceId, destination);
            transfers.delete(destination);
          }
          applications.delete(scope);
          records.delete(`${scope}\nconnection`);
        }
      });
    },
    transfer(source, destination) {
      return Effect.gen(function* () {
        const repository = source.git.provider?.repository;
        if (!repository || !("deployment" in repository)) return;
        const from = connectionScope(source, repository);
        const to = connectionScope(destination, repository);
        const payload = records.get(`${from}\nconnection`);
        if (!payload)
          return yield* new HostValidationError({
            message: "The setup connection is unavailable. Connect again before saving.",
          });
        let progress = transfers.get(to);
        if (!progress) {
          const existing = yield* input.protectedStorage.readConnection(to);
          const scopes = yield* input.credentialIndex.list(destination.workspaceId);
          if (existing !== null || scopes.some((entry) => entry.scope === to)) {
            return yield* new HostValidationError({
              message:
                "Azure credentials already exist for this workspace. Open Settings to review them. Setup did not replace them.",
            });
          }
          progress = {
            sourceScope: from,
            workspaceId: destination.workspaceId,
            connection: false,
            cache: false,
            index: false,
            cacheOwned: false,
            connectionOwned: false,
            indexOwned: false,
          };
          transfers.set(to, progress);
        }
        // Mark ownership before writing because a failed write can leave a record.
        if (!progress.cache) {
          const application = applications.get(from);
          if (application) {
            const cache = yield* Effect.try({
              try: () => application.getTokenCache().serialize(),
              catch: (cause) =>
                toHostOperationError(cause, "workspaceProviderSetup.serializeCache", {
                  message: "Failed to prepare the Microsoft token cache. Retry creation.",
                }),
            });
            const store = yield* input.protectedStorage.open(to, "msal");
            if (!progress.cacheOwned) {
              const existingCache = yield* Effect.tryPromise({
                try: () => store.load(),
                catch: (cause) => toHostOperationError(cause, "workspaceProviderSetup.readCache"),
              });
              if (existingCache !== null)
                return yield* new HostValidationError({
                  message:
                    "A Microsoft token cache already exists for this workspace. Open Settings to review it. Setup did not replace it.",
                });
            }
            progress.cacheOwned = true;
            yield* Effect.tryPromise({
              try: () => store.save(cache),
              catch: (cause) =>
                toHostOperationError(cause, "workspaceProviderSetup.transferCache", {
                  message:
                    "Workspace settings saved. Failed to save the Microsoft token cache. Retry creation.",
                }),
            });
          } else if (progress.cacheOwned) {
            const store = yield* input.protectedStorage.open(to, "msal");
            yield* Effect.tryPromise({
              try: () => store.delete(),
              catch: (cause) =>
                toHostOperationError(cause, "workspaceProviderSetup.removeReplacedCache", {
                  message: "Failed to remove the replaced Microsoft token cache. Retry creation.",
                }),
            });
            progress.cacheOwned = false;
          }
          progress.cache = true;
        }
        if (!progress.connection) {
          const store = yield* input.protectedStorage.open(to, "connection");
          progress.connectionOwned = true;
          yield* Effect.tryPromise({
            try: () => store.save(payload),
            catch: (cause) =>
              toHostOperationError(cause, "workspaceProviderSetup.transferConnection", {
                message:
                  "Workspace settings saved. Failed to save Azure credentials. Retry creation.",
              }),
          });
          progress.connection = true;
        }
        if (!progress.index) {
          progress.indexOwned = true;
          yield* input.credentialIndex.register(destination.workspaceId, {
            scope: to,
            deployment: repository.deployment,
          });
          progress.index = true;
        }
      });
    },
  };
};
