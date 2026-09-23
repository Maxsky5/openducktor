import { randomUUID } from "node:crypto";
import {
  type AzureDevOpsConnectionState,
  type AzureDevOpsDeviceCode,
  type AzureDevOpsRepository,
  type HostEventPayload,
  type RepoConfig,
} from "@openducktor/contracts";
import {
  azureDevOpsCollectionUrl,
  azureDevOpsConnectionConfigurationFingerprint,
  azureDevOpsRepositoryKey,
} from "@openducktor/core";
import { type AccountInfo, type DeviceCodeRequest } from "@azure/msal-node";
import { Effect, Fiber } from "effect";
import {
  HostOperationError,
  type HostError,
  HostValidationError,
  errorMessage,
  toHostOperationError,
} from "../../../effect/host-errors";
import type { AzureDevOpsConnectionPort } from "../../../ports/azure-devops-connection-port";
import { loadConnection, saveConnection } from "./connection-storage";
import { createAzureDevOpsConnectionScopeGate } from "./connection-scope-gate";
import { validatePat } from "./pat-validation";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";
import {
  createAzureDevOpsPublicClient,
  type AzureDevOpsPublicClientFactory,
} from "./public-client";

const AZURE_DEVOPS_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798/.default";
type SignInAttempt = {
  request: DeviceCodeRequest;
  scope: string;
  cancelled: boolean;
  fiber?: Fiber.RuntimeFiber<void, never>;
};

export const createAzureDevOpsConnectionAdapter = ({
  clientId,
  protectedStorage,
  fetchImplementation = fetch,
  publishConnectionState,
  publicClientFactory = createAzureDevOpsPublicClient,
}: {
  clientId: string | undefined;
  protectedStorage: AzureDevOpsProtectedStorage;
  fetchImplementation?: typeof fetch;
  publishConnectionState?: (
    event: HostEventPayload<"openducktor://azure-devops-connection-updated">,
  ) => void;
  publicClientFactory?: AzureDevOpsPublicClientFactory;
}): AzureDevOpsConnectionPort => {
  const attempts = new Map<string, SignInAttempt>();
  const pendingByScope = new Map<string, AzureDevOpsDeviceCode>();
  const errorsByScope = new Map<string, string>();
  const scopeGate = createAzureDevOpsConnectionScopeGate();

  const clearPendingAttempt = (attemptId: string, scope: string): void => {
    if (pendingByScope.get(scope)?.attemptId === attemptId) {
      pendingByScope.delete(scope);
    }
  };

  const cancelAttempt = (attemptId: string, attempt: SignInAttempt): void => {
    attempt.cancelled = true;
    attempt.request.cancel = true;
    scopeGate.invalidate(attempt.scope);
    if (attempts.get(attemptId) === attempt) {
      attempts.delete(attemptId);
    }
    clearPendingAttempt(attemptId, attempt.scope);
  };

  const cancelScopeAttempts = (scope: string) =>
    Effect.gen(function* () {
      const fibers: Fiber.RuntimeFiber<void, never>[] = [];
      for (const [attemptId, attempt] of attempts) {
        if (attempt.scope === scope) {
          cancelAttempt(attemptId, attempt);
          if (attempt.fiber) fibers.push(attempt.fiber);
        }
      }
      yield* Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
    });

  const getAuthorization: AzureDevOpsConnectionPort["getAuthorization"] = (
    repoConfig,
    repository,
  ) => {
    const scope = connectionScope(repoConfig, repository);
    const generation = scopeGate.currentGeneration(scope);
    return scopeGate.run(
      scope,
      Effect.gen(function* () {
        yield* scopeGate.requireCurrent(scope, generation);
        yield* requireConnectionTransport(repoConfig, repository);
        const connection = yield* loadConnection(protectedStorage, scope);
        if (connection?.kind === "server_pat") {
          yield* scopeGate.requireCurrent(scope, generation);
          return {
            headerValue: `Basic ${Buffer.from(`:${connection.pat}`).toString("base64")}`,
            account: null,
          };
        }

        if (repository.deployment === "server") {
          return yield* Effect.fail(
            new HostValidationError({
              field: "git.provider.connection",
              message:
                "Azure DevOps Server requires a personal access token in repository settings.",
            }),
          );
        }

        const configuredClientId = yield* requireClientId(clientId);
        if (connection?.kind !== "cloud") {
          return yield* Effect.fail(
            new HostValidationError({
              field: "git.provider.connection",
              message:
                "Sign in with a work or school account, or add a personal access token for this Azure DevOps organization.",
            }),
          );
        }
        const application = yield* publicClientFactory(configuredClientId, protectedStorage, scope);
        const accounts = yield* tryMsal(() => application.getAllAccounts(), "list cached accounts");
        const account = accounts.find(
          (candidate) => candidate.homeAccountId === connection.homeAccountId,
        );
        if (!account) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "git.provider.connection",
              message: "The saved Azure DevOps account is no longer available. Sign in again.",
            }),
          );
        }
        const result = yield* tryMsal(
          () => application.acquireTokenSilent({ account, scopes: [AZURE_DEVOPS_SCOPE] }),
          "renew Azure DevOps access",
        );
        if (!result?.accessToken) {
          return yield* Effect.fail(
            new HostOperationError({
              operation: "azureDevOps.connection.acquireTokenSilent",
              message:
                "Microsoft Entra did not return an Azure DevOps access token. Sign in again.",
            }),
          );
        }
        yield* scopeGate.requireCurrent(scope, generation);
        return { headerValue: `Bearer ${result.accessToken}`, account: connection.account };
      }),
    );
  };

  return {
    getAuthorization,
    getState(repoConfig, repository) {
      return Effect.gen(function* () {
        const scope = connectionScope(repoConfig, repository);
        const pending = pendingByScope.get(scope);
        if (pending) {
          return { status: "pending", deviceCode: pending } satisfies AzureDevOpsConnectionState;
        }
        const failure = errorsByScope.get(scope);
        if (failure) {
          return { status: "error", reason: failure } satisfies AzureDevOpsConnectionState;
        }
        const connection = yield* loadConnection(protectedStorage, scope);
        if (!connection) {
          return { status: "disconnected" } satisfies AzureDevOpsConnectionState;
        }
        return {
          status: "connected",
          account: connection.kind === "cloud" ? connection.account : null,
        } satisfies AzureDevOpsConnectionState;
      });
    },
    replacePat(repoConfig, repository, pat) {
      return Effect.gen(function* () {
        const value = pat.trim();
        if (!value) {
          return yield* Effect.fail(
            new HostValidationError({
              field: "pat",
              message: "Enter an Azure DevOps personal access token.",
            }),
          );
        }
        const scope = connectionScope(repoConfig, repository);
        const generation = scopeGate.currentGeneration(scope);
        yield* scopeGate.run(
          scope,
          Effect.gen(function* () {
            yield* scopeGate.requireCurrent(scope, generation);
            yield* requireConnectionTransport(repoConfig, repository);
            yield* validatePat(fetchImplementation, repository, value);
            yield* scopeGate.requireCurrent(scope, generation);
            yield* saveConnection(protectedStorage, scope, {
              kind: "server_pat",
              pat: value,
            });
            errorsByScope.delete(scope);
          }),
        );
      });
    },
    startCloudSignIn(repoConfig, repository) {
      return Effect.gen(function* () {
        if (repository.deployment !== "services") {
          return yield* Effect.fail(
            new HostValidationError({
              field: "git.provider.connection",
              message: "Microsoft Entra sign-in is supported only for Azure DevOps Services.",
            }),
          );
        }
        const configuredClientId = yield* requireClientId(clientId);
        const scope = connectionScope(repoConfig, repository);
        yield* cancelScopeAttempts(scope);
        const generation = scopeGate.invalidate(scope);
        const application = yield* publicClientFactory(configuredClientId, protectedStorage, scope);
        const attemptId = randomUUID();
        return yield* Effect.async<AzureDevOpsDeviceCode, HostError>((resume) => {
          let codeReturned = false;
          let attempt: SignInAttempt;
          const request: DeviceCodeRequest = {
            scopes: [AZURE_DEVOPS_SCOPE],
            deviceCodeCallback(response) {
              const deviceCode = {
                attemptId,
                verificationUri: response.verificationUri,
                userCode: response.userCode,
                expiresAt: new Date(Date.now() + response.expiresIn * 1_000).toISOString(),
              };
              if (attempt.cancelled || attempts.get(attemptId) !== attempt) {
                return;
              }
              codeReturned = true;
              pendingByScope.set(scope, deviceCode);
              errorsByScope.delete(scope);
              resume(Effect.succeed(deviceCode));
            },
          };
          attempt = { request, scope, cancelled: false };
          attempts.set(attemptId, attempt);
          const persistence = scopeGate
            .run(
              scope,
              Effect.gen(function* () {
                yield* scopeGate.requireCurrent(scope, generation);
                const result = yield* tryMsal(
                  () => application.acquireTokenByDeviceCode(request),
                  "complete Azure DevOps sign-in",
                );
                if (attempt.cancelled || attempts.get(attemptId) !== attempt) {
                  return null;
                }
                const account = result?.account;
                if (!account) {
                  return yield* Effect.fail(
                    new HostOperationError({
                      operation: "azureDevOps.connection.startSignIn",
                      message: "Microsoft Entra sign-in completed without an account.",
                    }),
                  );
                }
                yield* scopeGate.requireCurrent(scope, generation);
                yield* saveConnection(protectedStorage, scope, {
                  kind: "cloud",
                  homeAccountId: account.homeAccountId,
                  account: accountLabel(account),
                });
                yield* scopeGate.requireCurrent(scope, generation);
                return account;
              }),
            )
            .pipe(
              Effect.tap((account) =>
                Effect.sync(() => {
                  if (attempt.cancelled || attempts.get(attemptId) !== attempt || !account) return;
                  attempts.delete(attemptId);
                  clearPendingAttempt(attemptId, scope);
                  errorsByScope.delete(scope);
                  publishConnectionState?.(
                    connectionUpdate(repoConfig, repository, attemptId, {
                      status: "connected",
                      account: accountLabel(account),
                    }),
                  );
                }),
              ),
              Effect.catchAll((cause) =>
                Effect.sync(() => {
                  if (attempt.cancelled || attempts.get(attemptId) !== attempt) return;
                  attempts.delete(attemptId);
                  clearPendingAttempt(attemptId, scope);
                  const message = `Microsoft Entra sign-in failed: ${errorMessage(cause)}`;
                  errorsByScope.set(scope, message);
                  publishConnectionState?.(
                    connectionUpdate(repoConfig, repository, attemptId, {
                      status: "error",
                      reason: message,
                    }),
                  );
                  if (!codeReturned) {
                    resume(
                      Effect.fail(
                        toHostOperationError(cause, "azureDevOps.connection.startSignIn", {
                          message,
                        }),
                      ),
                    );
                  }
                }),
              ),
              Effect.asVoid,
            );
          attempt.fiber = Effect.runFork(persistence);
        });
      });
    },
    cancelCloudSignIn(attemptId) {
      return Effect.gen(function* () {
        const attempt = attempts.get(attemptId);
        if (attempt) {
          cancelAttempt(attemptId, attempt);
          if (attempt.fiber) yield* Fiber.interrupt(attempt.fiber);
        }
      });
    },
    shutdown() {
      return Effect.gen(function* () {
        const fibers: Fiber.RuntimeFiber<void, never>[] = [];
        for (const [attemptId, attempt] of attempts) {
          cancelAttempt(attemptId, attempt);
          if (attempt.fiber) fibers.push(attempt.fiber);
        }
        yield* Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { discard: true });
      });
    },
    disconnect(repoConfig, repository) {
      return Effect.gen(function* () {
        const scope = connectionScope(repoConfig, repository);
        scopeGate.invalidate(scope);
        yield* cancelScopeAttempts(scope);
        pendingByScope.delete(scope);
        errorsByScope.delete(scope);
        yield* scopeGate.run(
          scope,
          Effect.gen(function* () {
            const connectionStore = yield* protectedStorage.open(scope, "connection");
            yield* Effect.tryPromise({
              try: () => connectionStore.delete(),
              catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.disconnect"),
            });
            if (repository.deployment !== "services") {
              return;
            }
            const msalStore = yield* protectedStorage.open(scope, "msal");
            yield* Effect.tryPromise({
              try: () => msalStore.delete(),
              catch: (cause) => toHostOperationError(cause, "azureDevOps.connection.disconnect"),
            });
          }),
        );
      });
    },
  };
};

const requireClientId = (clientId: string | undefined) =>
  clientId
    ? Effect.succeed(clientId)
    : Effect.fail(
        new HostValidationError({
          field: "OPENDUCKTOR_AZURE_DEVOPS_CLIENT_ID",
          message:
            "Azure DevOps Services sign-in is unavailable because the OpenDucktor Entra client ID is not configured.",
        }),
      );

const requireConnectionTransport = (repoConfig: RepoConfig, repository: AzureDevOpsRepository) =>
  Effect.gen(function* () {
    const collectionUrl = azureDevOpsCollectionUrl(repository);
    const transportProtocol = new URL(collectionUrl).protocol;
    if (repository.deployment === "services" && transportProtocol !== "https:") {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.repository.serviceUrl",
          message: "Azure DevOps Services requires HTTPS.",
        }),
      );
    }
    if (
      repository.deployment === "server" &&
      transportProtocol === "http:" &&
      repoConfig.git.provider?.httpConsentCollectionUrl !== collectionUrl
    ) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "git.provider.httpConsentCollectionUrl",
          message: `Confirm the unencrypted Azure DevOps Server connection for ${collectionUrl} before sending credentials.`,
        }),
      );
    }
  });

const connectionScope = (repoConfig: RepoConfig, repository: AzureDevOpsRepository): string =>
  [repoConfig.workspaceId, repoConfig.repoPath, azureDevOpsRepositoryKey(repository)].join("\n");

const connectionUpdate = (
  repoConfig: RepoConfig,
  repository: AzureDevOpsRepository,
  attemptId: string,
  state: AzureDevOpsConnectionState,
): HostEventPayload<"openducktor://azure-devops-connection-updated"> => ({
  workspaceId: repoConfig.workspaceId,
  repoPath: repoConfig.repoPath,
  providerId: "azure_devops",
  configurationFingerprint: azureDevOpsConnectionConfigurationFingerprint(
    repoConfig.workspaceId,
    repoConfig.repoPath,
    repository,
  ),
  attemptId,
  state,
});

const tryMsal = <T>(operation: () => Promise<T>, label: string) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      toHostOperationError(cause, "azureDevOps.connection.msal", {
        message: `Failed to ${label}. Sign in with Microsoft Entra again.`,
      }),
  });

const accountLabel = (account: AccountInfo): string | null =>
  account.username || account.name || null;
