/* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- These tests use partial MSAL persistence fakes and Bun fetch mocks. */
import { describe, expect, mock, test } from "bun:test";
import { repoConfigSchema, type AzureDevOpsRepository } from "@openducktor/contracts";
import type { IPersistence } from "@azure/msal-node-extensions";
import type { AuthenticationResult, DeviceCodeRequest } from "@azure/msal-node";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";
import type { AzureDevOpsCredentialIndex } from "./credential-index";
import { createAzureDevOpsConnectionAdapter } from "./connection";
import { azureDevOpsRepositoryKey } from "@openducktor/core";

const repository: AzureDevOpsRepository = {
  providerId: "azure_devops",
  deployment: "server",
  serviceUrl: "https://ado.example.test/installation",
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
const repositoryResponse = (configured: AzureDevOpsRepository = repository) => ({
  id: "repository-1",
  name: configured.name,
  project: { id: "project-1", name: configured.project },
});

const createCredentialIndex = (): AzureDevOpsCredentialIndex => ({
  register: () => Effect.void,
  list: () => Effect.succeed([]),
  forget: () => Effect.void,
});

describe("Azure DevOps connection", () => {
  test("removes a workspace without opening secure storage when no credential exists", async () => {
    const open = mock(() => Effect.die("Unexpected protected storage open"));
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage: { readConnection: () => Effect.succeed(null), open },
    });

    await Effect.runPromise(
      connection.removeWorkspaceCredentials(repoConfigSchema.parse({ ...repoConfig, git: {} })),
    );

    expect(open).not.toHaveBeenCalled();
  });

  test("does not index a PAT when secure storage cannot open", async () => {
    const scopes = new Map<string, { scope: string; deployment: "services" | "server" }>();
    const open = mock(() => Effect.die("Secure storage is unavailable"));
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: {
        register: (_workspaceId, credential) =>
          Effect.sync(() => void scopes.set(credential.scope, credential)),
        list: () => Effect.succeed([...scopes.values()]),
        forget: (_workspaceId, scope) => Effect.sync(() => void scopes.delete(scope)),
      },
      protectedStorage: { readConnection: () => Effect.succeed(null), open },
      fetchImplementation: mock(async () =>
        Response.json(repositoryResponse()),
      ) as unknown as typeof fetch,
    });

    await expect(
      Effect.runPromise(connection.replacePat(repoConfig, repository, "secret")),
    ).rejects.toThrow();
    expect(scopes.size).toBe(0);
    await Effect.runPromise(
      connection.removeWorkspaceCredentials(repoConfigSchema.parse({ ...repoConfig, git: {} })),
    );
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("reports a new repository as disconnected without opening protected storage", async () => {
    const open = mock(() => Effect.die("Unexpected protected storage open"));
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: () => Effect.succeed(null),
        open,
      },
    });

    await expect(Effect.runPromise(connection.getState(repoConfig, repository))).resolves.toEqual({
      status: "disconnected",
    });
    await expect(
      Effect.runPromise(connection.getAuthorization(repoConfig, repository)),
    ).rejects.toThrow("requires a personal access token");
    expect(open).not.toHaveBeenCalled();
  });

  test("rejects a mixed-case HTTP Server address before sending the PAT", async () => {
    const httpRepository: AzureDevOpsRepository = {
      ...repository,
      serviceUrl: "HTTP://ADO.Example.test/installation",
    };
    const httpRepoConfig = repoConfigSchema.parse({
      ...repoConfig,
      git: { provider: { id: "azure_devops", enabled: true, repository: httpRepository } },
    });
    const fetchImplementation = mock(async () => new Response(null, { status: 200 }));
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: () => Effect.succeed(null),
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
      Effect.runPromise(connection.replacePat(httpRepoConfig, httpRepository, "secret")),
    ).rejects.toThrow("Confirm the unencrypted Azure DevOps Server connection");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  test("keeps the working PAT when replacement validation fails", async () => {
    const records = new Map<string, string>();
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => records.delete(`${scope}:${record}`),
        } as unknown as IPersistence),
    };
    const fetchImplementation = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      const header = new Headers(init?.headers).get("Authorization");
      return Response.json(repositoryResponse(), {
        status: header === `Basic ${btoa(":working")}` ? 200 : 401,
      });
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await Effect.runPromise(connection.replacePat(repoConfig, repository, "working"));
    await expect(
      Effect.runPromise(connection.replacePat(repoConfig, repository, "rejected")),
    ).rejects.toThrow("prior connection remains active");
    await expect(
      Effect.runPromise(connection.getAuthorization(repoConfig, repository)),
    ).resolves.toEqual({
      headerValue: `Basic ${btoa(":working")}`,
      account: null,
    });
  });

  test("removes an indexed PAT after the workspace changes provider", async () => {
    const records = new Map<string, string>();
    const scopes = new Map<string, { scope: string; deployment: "services" | "server" }>();
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => records.delete(`${scope}:${record}`),
        } as IPersistence),
    };
    const credentialIndex: AzureDevOpsCredentialIndex = {
      register: (_workspaceId, credential) =>
        Effect.sync(() => void scopes.set(credential.scope, credential)),
      list: () => Effect.succeed([...scopes.values()]),
      forget: (_workspaceId, scope) => Effect.sync(() => void scopes.delete(scope)),
    };
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex,
      protectedStorage,
      fetchImplementation: mock(async () =>
        Response.json(repositoryResponse()),
      ) as unknown as typeof fetch,
    });

    await Effect.runPromise(connection.replacePat(repoConfig, repository, "secret"));
    const switchedConfig = repoConfigSchema.parse({ ...repoConfig, git: {} });
    await Effect.runPromise(connection.removeWorkspaceCredentials(switchedConfig));

    await expect(Effect.runPromise(connection.getState(repoConfig, repository))).resolves.toEqual({
      status: "disconnected",
    });
    expect(scopes.size).toBe(0);
  });

  test("removes a PAT for the current repository when the credential index is empty", async () => {
    const deleted: string[] = [];
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: () => Effect.succeed(null),
        open: (scope, record) =>
          Effect.succeed({
            save: async () => undefined,
            load: async () => null,
            delete: async () => {
              deleted.push(`${scope}:${record}`);
              return true;
            },
          } as unknown as IPersistence),
      },
    });

    await Effect.runPromise(connection.removeWorkspaceCredentials(repoConfig));

    expect(deleted).toEqual([
      `${repoConfig.workspaceId}\n${repoConfig.repoPath}\n${azureDevOpsRepositoryKey(repository)}:connection`,
    ]);
  });

  test.each([
    ["a generic success page", new Response("OK", { status: 200 })],
    ["another repository", Response.json(repositoryResponse({ ...repository, name: "other" }))],
  ])("does not save a PAT when Azure returns %s", async (_description, response) => {
    const save = mock(async (_contents: string) => undefined);
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: () => Effect.succeed(null),
        open: () =>
          Effect.succeed({
            save,
            load: async () => null,
            delete: async () => false,
          } as unknown as IPersistence),
      },
      fetchImplementation: mock(async () => response) as unknown as typeof fetch,
    });

    await expect(
      Effect.runPromise(connection.replacePat(repoConfig, repository, "secret")),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });

  test("uses a PAT for Azure DevOps Services without Microsoft sign-in", async () => {
    const servicesRepository: AzureDevOpsRepository = {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
      project: "Desktop",
      name: "app",
    };
    const servicesRepoConfig = repoConfigSchema.parse({
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      git: { provider: { id: "azure_devops", enabled: true, repository: servicesRepository } },
    });
    const records = new Map<string, string>();
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
      open: (scope, record) =>
        Effect.succeed({
          save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
          load: async () => records.get(`${scope}:${record}`) ?? null,
          delete: async () => records.delete(`${scope}:${record}`),
        } as IPersistence),
    };
    const fetchImplementation = mock(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Basic ${btoa(":secret")}`);
      return Response.json(repositoryResponse(servicesRepository));
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    await Effect.runPromise(
      connection.replacePat(servicesRepoConfig, servicesRepository, "secret"),
    );

    await expect(
      Effect.runPromise(connection.getAuthorization(servicesRepoConfig, servicesRepository)),
    ).resolves.toEqual({
      headerValue: `Basic ${btoa(":secret")}`,
      account: null,
    });
    await expect(
      Effect.runPromise(connection.getState(servicesRepoConfig, servicesRepository)),
    ).resolves.toEqual({ status: "connected", account: null });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
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
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: () => Effect.succeed(null),
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
          Effect.either(connection.replacePat(repoConfig, repository, "secret")),
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
      readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
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
      credentialIndex: createCredentialIndex(),
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

  test("stops pending Microsoft sign-in before host shutdown completes", async () => {
    const cloudRepository: AzureDevOpsRepository = {
      ...repository,
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
    };
    const cloudRepoConfig = repoConfigSchema.parse({
      ...repoConfig,
      git: { provider: { id: "azure_devops", enabled: true, repository: cloudRepository } },
    });
    const records = new Map<string, string>();
    const tokenResult = Promise.withResolvers<AuthenticationResult | null>();
    const events: unknown[] = [];
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: "client-id",
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
        open: (scope, record) =>
          Effect.succeed({
            save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
            load: async () => records.get(`${scope}:${record}`) ?? null,
            delete: async () => records.delete(`${scope}:${record}`),
          } as IPersistence),
      },
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
            return tokenResult.promise as never;
          },
        } as never),
    });

    await Effect.runPromise(connection.startCloudSignIn(cloudRepoConfig, cloudRepository));
    await Effect.runPromise(connection.shutdown());
    tokenResult.resolve({
      account: { homeAccountId: "account-1", username: "ada@example.test" },
    } as never);
    await Promise.resolve();

    expect([...records.keys()].filter((key) => key.endsWith(":connection"))).toEqual([]);
    expect(events).toEqual([]);
  });

  test("clears a failed Microsoft sign-in after a valid cloud PAT is saved", async () => {
    const cloudRepository: AzureDevOpsRepository = {
      ...repository,
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "OpenDucktor",
    };
    const cloudRepoConfig = repoConfigSchema.parse({
      ...repoConfig,
      git: { provider: { id: "azure_devops", enabled: true, repository: cloudRepository } },
    });
    const records = new Map<string, string>();
    const failure = Promise.withResolvers<void>();
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: "client-id",
      credentialIndex: createCredentialIndex(),
      protectedStorage: {
        readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
        open: (scope, record) =>
          Effect.succeed({
            save: async (contents: string) => void records.set(`${scope}:${record}`, contents),
            load: async () => records.get(`${scope}:${record}`) ?? null,
            delete: async () => records.delete(`${scope}:${record}`),
          } as IPersistence),
      },
      fetchImplementation: mock(async () =>
        Response.json(repositoryResponse(cloudRepository)),
      ) as unknown as typeof fetch,
      publishConnectionState: () => failure.resolve(),
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
            throw new Error("sign-in denied");
          },
        } as never),
    });

    await Effect.runPromise(connection.startCloudSignIn(cloudRepoConfig, cloudRepository));
    await failure.promise;
    await Effect.runPromise(connection.replacePat(cloudRepoConfig, cloudRepository, "secret"));

    await expect(
      Effect.runPromise(connection.getState(cloudRepoConfig, cloudRepository)),
    ).resolves.toEqual({
      status: "connected",
      account: null,
    });
  });

  test("does not restore a PAT replacement that was in flight when disconnect started", async () => {
    const records = new Map<string, string>();
    const operations: string[] = [];
    const protectedStorage: AzureDevOpsProtectedStorage = {
      readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
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
      return Response.json(repositoryResponse());
    });
    const connection = createAzureDevOpsConnectionAdapter({
      clientId: undefined,
      credentialIndex: createCredentialIndex(),
      protectedStorage,
      fetchImplementation: fetchImplementation as unknown as typeof fetch,
    });

    const replacement = Effect.runPromise(
      connection.replacePat(repoConfig, repository, "replacement"),
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
      readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
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
      credentialIndex: createCredentialIndex(),
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
