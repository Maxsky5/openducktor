/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- These tests use partial MSAL persistence fakes and Bun fetch mocks. */
import { describe, expect, mock, test } from "bun:test";
import { repoConfigSchema, type AzureDevOpsRepository } from "@openducktor/contracts";
import type { IPersistence } from "@azure/msal-node-extensions";
import type { AuthenticationResult, DeviceCodeRequest } from "@azure/msal-node";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";
import { createAzureDevOpsConnectionAdapter } from "./connection";
import { azureDevOpsRepositoryKey } from "./repository-identity";

const repository: AzureDevOpsRepository = {
  providerId: "azure_devops",
  deployment: "server",
  serviceUrl: "https://ado.example.test/tfs",
  organization: "DefaultCollection",
  project: "Desktop",
  name: "app",
};
const repoConfig = repoConfigSchema.parse({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  git: { provider: { id: "azure_devops", enabled: true, repository } },
});

describe("Azure DevOps connection", () => {
  test("rejects a mixed-case HTTP Server address before sending the PAT", async () => {
    const httpRepository: AzureDevOpsRepository = {
      ...repository,
      serviceUrl: "HTTP://ADO.Example.test/tfs",
    };
    const httpRepoConfig = repoConfigSchema.parse({
      ...repoConfig,
      git: { provider: { id: "azure_devops", enabled: true, repository: httpRepository } },
    });
    const fetchImplementation = mock(async () => new Response(null, { status: 200 }));
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      protectedStorage: {
        open: () =>
          Effect.succeed({
            save: async () => undefined,
            load: async () => null,
            delete: async () => false,
          } as unknown as IPersistence),
      },
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await expect(
      Effect.runPromise(connection.replaceServerPat(httpRepoConfig, httpRepository, "secret")),
    ).rejects.toThrow("Confirm the unencrypted Azure DevOps Server connection");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test("keeps the working PAT when replacement validation fails", async () => {
    const records = new Map<string, string>();
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => records.delete(`${scope}:${record}`),
        } as IPersistence),
    };
    const fetchImplementation = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("Authorization");
      return new Response(null, { status: header === `Basic ${btoa(":working")}` ? 200 : 401 });
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      protectedStorage,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await Effect.runPromise(connection.replaceServerPat(repoConfig, repository, "working"));
    await expect(
      Effect.runPromise(connection.replaceServerPat(repoConfig, repository, "rejected")),
    ).rejects.toThrow("prior connection remains active");
    await expect(
      Effect.runPromise(connection.getAuthorization(repoConfig, repository)),
    ).resolves.toEqual({
      headerValue: `Basic ${btoa(":working")}`,
      account: null,
    });
  });

  test("aborts PAT validation that exceeds the Azure DevOps deadline", async () => {
    const started = Promise.withResolvers<AbortSignal | undefined>();
    const fetchImplementation = mock((_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      started.resolve(signal);
      if (!signal) {
        return Promise.reject(new Error("Missing request abort signal"));
      }
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      protectedStorage: {
        open: () =>
          Effect.succeed({
            save: async () => undefined,
            load: async () => null,
            delete: async () => false,
          } as unknown as IPersistence),
      },
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const replacement = yield* Effect.fork(
          Effect.either(connection.replaceServerPat(repoConfig, repository, "secret")),
        );
        const signal = yield* Effect.promise(() => started.promise);
        expect(signal).toBeInstanceOf(AbortSignal);
        yield* TestClock.adjust("30 seconds");
        const result = yield* Fiber.join(replacement);
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left.message).toContain("timed out after 30 seconds");
        }
        expect(signal?.aborted).toBe(true);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  test("does not save or publish a cloud sign-in that completed after cancellation", async () => {
    const cloudRepository: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop",
      name: "app",
    };
    const cloudRepoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      git: { provider: { id: "azure_devops", enabled: true, repository: cloudRepository } },
    });
    const records = new Map<string, string>();
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => records.delete(`${scope}:${record}`),
        } as IPersistence),
    };
    let resolveToken!: (value: AuthenticationResult | null) => void;
    const tokenResult = new Promise<AuthenticationResult | null>((resolve) => {
      resolveToken = resolve;
    });
    const events: unknown[] = [];
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: "client-id",
      protectedStorage,
      publishConnectionState: (event) => events.push(event),
      publicClientFactory: () =>
        Effect.succeed({
          getAllAccounts: async () => [],
          acquireTokenSilent: async () => null,
          acquireTokenByDeviceCode: async (request: DeviceCodeRequest) => {
            request.deviceCodeCallback?.({
              verificationUri: "https://microsoft.com/devicelogin",
              userCode: "CODE",
              expiresIn: 900,
            } as never);
            return tokenResult as never;
          },
        } as never),
    });

    const deviceCode = await Effect.runPromise(
      connection.startCloudSignIn(cloudRepoConfig, cloudRepository),
    );
    await Effect.runPromise(connection.cancelCloudSignIn(deviceCode.attemptId));
    resolveToken({
      account: {
        homeAccountId: "account-1",
        username: "ada@example.test",
        name: "Ada Lovelace",
      },
    } as never);
    await Promise.resolve();
    await Promise.resolve();

    await expect(
      Effect.runPromise(connection.getState(cloudRepoConfig, cloudRepository)),
    ).resolves.toEqual({ status: "disconnected" });
    expect([...records.keys()].filter((key) => key.endsWith(":connection"))).toEqual([]);
    expect(events).toEqual([]);
  });

  test("does not restore a PAT replacement that was in flight when disconnect started", async () => {
    const records = new Map<string, string>();
    const operations: string[] = [];
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => {
            operations.push(`save:${record}`);
            records.set(`${scope}:${record}`, contents);
          },
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => {
            operations.push(`delete:${record}`);
            return records.delete(`${scope}:${record}`);
          },
        } as IPersistence),
    };
    let finishValidation!: () => void;
    const validation = new Promise<void>((resolve) => {
      finishValidation = resolve;
    });
    const fetchImplementation = mock(async () => {
      await validation;
      return new Response(null, { status: 200 });
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      protectedStorage,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    const replacement = Effect.runPromise(
      connection.replaceServerPat(repoConfig, repository, "replacement"),
    );
    while (fetchImplementation.mock.calls.length === 0) {
      await Promise.resolve();
    }
    const disconnect = Effect.runPromise(connection.disconnect(repoConfig, repository));
    await Promise.resolve();
    await Promise.resolve();
    finishValidation();
    const [replacementResult, disconnectResult] = await Promise.allSettled([
      replacement,
      disconnect,
    ]);

    expect(replacementResult.status).toBe("rejected");
    expect(disconnectResult).toEqual({ status: "fulfilled", value: undefined });
    await expect(Effect.runPromise(connection.getState(repoConfig, repository))).resolves.toEqual({
      status: "disconnected",
    });
    expect(operations.at(-1)).toBe("delete:connection");
  });

  test("does not restore an MSAL cache write that was in flight when disconnect started", async () => {
    const cloudRepository: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop",
      name: "app",
    };
    const cloudRepoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      git: { provider: { id: "azure_devops", enabled: true, repository: cloudRepository } },
    });
    const records = new Map<string, string>();
    const protectedStorage: AzureDevOpsProtectedStorage = {
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => records.delete(`${scope}:${record}`),
        } as IPersistence),
    };
    const account = {
      homeAccountId: "account-1",
      username: "ada@example.test",
      name: "Ada Lovelace",
    };
    let finishRenewal!: () => void;
    const renewal = new Promise<void>((resolve) => {
      finishRenewal = resolve;
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: "client-id",
      protectedStorage,
      publicClientFactory: (_clientId, storage, scope) =>
        Effect.succeed({
          getAllAccounts: async () => [account] as never,
          acquireTokenByDeviceCode: async () => null,
          acquireTokenSilent: async () => {
            await renewal;
            const cache = await Effect.runPromise(storage.open(scope, "msal"));
            await cache.save("late-cache");
            return { accessToken: "access-token", account } as never;
          },
        }),
    });
    const scope = [
      cloudRepoConfig.workspaceId,
      cloudRepoConfig.repoPath,
      azureDevOpsRepositoryKey(cloudRepository),
    ].join("\n");
    const connectionStore = await Effect.runPromise(protectedStorage.open(scope, "connection"));
    await connectionStore.save(
      JSON.stringify({
        kind: "cloud",
        homeAccountId: account.homeAccountId,
        account: account.name,
      }),
    );

    const authorization = Effect.runPromise(
      connection.getAuthorization(cloudRepoConfig, cloudRepository),
    );
    await Promise.resolve();
    await Promise.resolve();
    const disconnect = Effect.runPromise(connection.disconnect(cloudRepoConfig, cloudRepository));
    await Promise.resolve();
    await Promise.resolve();
    finishRenewal();
    const [authorizationResult, disconnectResult] = await Promise.allSettled([
      authorization,
      disconnect,
    ]);

    expect(authorizationResult.status).toBe("rejected");
    expect(disconnectResult).toEqual({ status: "fulfilled", value: undefined });
    expect([...records.keys()].filter((key) => key.endsWith(":msal"))).toEqual([]);
  });
});
