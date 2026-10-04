import { describe, expect, mock, test, spyOn } from "bun:test";
import {
  PublicClientApplication,
  type DeviceCodeRequest,
  type AuthenticationResult,
} from "@azure/msal-node";
import type { IPersistence } from "@azure/msal-node-extensions";
import { repoConfigSchema, type AzureDevOpsRepository } from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
import { HostOperationError } from "../../../effect/host-errors";
import type { AzureDevOpsCredentialIndex, AzureDevOpsCredentialScope } from "./credential-index";
import type { AzureDevOpsProtectedStorage } from "./protected-storage";
import { connectionScope } from "./connection";
import { createWorkspaceProviderSetupCredentials } from "./setup-credentials";

const repository: AzureDevOpsRepository = {
  providerId: "azure_devops",
  deployment: "server",
  serviceUrl: "https://ado.example.test/tfs",
  organization: "collection",
  project: "project",
  name: "repo",
};
const source = repoConfigSchema.parse({
  workspaceId: "setup",
  workspaceName: "Setup",
  repoPath: "/repo",
  git: { provider: { id: "azure_devops", enabled: true, repository } },
});
const destination = repoConfigSchema.parse({ ...source, workspaceId: "repo" });
const logger = new PublicClientApplication({ auth: { clientId: "client" } }).getLogger();
function harness() {
  const records = new Map<string, string>();
  const scopes = new Map<string, AzureDevOpsCredentialScope>();
  let rejectPat = false;
  let failIndex = false;
  let failDelete = false;
  const persistence = (key: string): IPersistence => ({
    save: async (value) => {
      records.set(key, value);
    },
    load: async () => records.get(key) ?? null,
    delete: async () => {
      if (failDelete) throw new Error("Delete unavailable");
      return records.delete(key);
    },
    reloadNecessary: async () => false,
    getFilePath: () => key,
    getLogger: () => logger,
    verifyPersistence: async () => true,
    createForPersistenceValidation: async () => persistence(key),
  });
  const open = mock((scope: string, record: "connection" | "msal") =>
    Effect.succeed(persistence(`${scope}:${record}`)),
  );
  const storage: AzureDevOpsProtectedStorage = {
    readConnection: (scope) => Effect.succeed(records.get(`${scope}:connection`) ?? null),
    open,
  };
  const index: AzureDevOpsCredentialIndex = {
    list: () => Effect.succeed([...scopes.values()]),
    forget: (_workspaceId, scope) =>
      Effect.sync(() => {
        scopes.delete(scope);
      }),
    register: (_workspaceId, scope) =>
      Effect.suspend(() => {
        scopes.set(scope.scope, scope);
        return failIndex
          ? Effect.fail(
              new HostOperationError({ operation: "index", message: "Index unavailable" }),
            )
          : Effect.void;
      }),
  };
  const fetchImplementation = mock(async () =>
    Response.json(
      { id: "repo-id", name: "repo", project: { id: "project-id", name: "project" } },
      { status: rejectPat ? 401 : 200 },
    ),
  );
  const connected = Promise.withResolvers<void>();
  const events = mock(() => connected.resolve());
  const adapter = createWorkspaceProviderSetupCredentials({
    clientId: "client",
    protectedStorage: storage,
    credentialIndex: index,
    fetchImplementation,
    publishConnectionState: events,
  });
  return {
    adapter,
    records,
    scopes,
    open,
    events,
    connected: connected.promise,
    fetchImplementation,
    rejectPat: (value: boolean) => {
      rejectPat = value;
    },
    failIndex: (value: boolean) => {
      failIndex = value;
    },
    failDelete: (value: boolean) => {
      failDelete = value;
    },
  };
}

describe("workspace setup credentials", () => {
  test("transfers the accepted replacement PAT after a partial transfer", async () => {
    const h = harness();
    await Effect.runPromise(h.adapter.connection.replacePat(source, repository, "original"));
    h.failIndex(true);
    await expect(Effect.runPromise(h.adapter.transfer(source, destination))).rejects.toThrow(
      "Index unavailable",
    );
    await Effect.runPromise(h.adapter.connection.replacePat(source, repository, "replacement"));
    h.failIndex(false);
    await Effect.runPromise(h.adapter.transfer(source, destination));
    await Effect.runPromise(h.adapter.complete(source));
    expect(h.records.get(`${connectionScope(destination, repository)}:connection`)).toBe(
      JSON.stringify({ kind: "server_pat", pat: "replacement" }),
    );
    expect(h.scopes.size).toBe(1);
  });
  test("transfers a cloud cache, protects an existing cache, and drops it after PAT replacement", async () => {
    const cloudRepository: AzureDevOpsRepository = {
      ...repository,
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "org",
    };
    const config = repoConfigSchema.parse({
      ...source,
      git: { provider: { ...source.git.provider, repository: cloudRepository } },
    });
    const target = repoConfigSchema.parse({ ...config, workspaceId: "repo" });
    const result: AuthenticationResult = {
      authority: "https://login.microsoftonline.com/common",
      uniqueId: "local",
      tenantId: "tenant",
      scopes: [],
      account: {
        homeAccountId: "home",
        environment: "login.microsoftonline.com",
        tenantId: "tenant",
        username: "user",
        localAccountId: "local",
      },
      idToken: "",
      idTokenClaims: {},
      accessToken: "token",
      fromCache: false,
      expiresOn: null,
      correlationId: "correlation",
      tokenType: "Bearer",
    };
    const acquire = spyOn(
      PublicClientApplication.prototype,
      "acquireTokenByDeviceCode",
    ).mockImplementation(async (request) => {
      request.deviceCodeCallback?.({
        verificationUri: "https://microsoft.com/devicelogin",
        userCode: "CODE",
        expiresIn: 60,
        interval: 5,
        message: "Sign in",
        deviceCode: "device",
      });
      return result;
    });
    try {
      const h = harness();
      await Effect.runPromise(h.adapter.connection.startCloudSignIn(config, cloudRepository));
      await h.connected;
      expect(h.open).not.toHaveBeenCalled();
      const key = `${connectionScope(target, cloudRepository)}:msal`;
      h.records.set(key, "existing-cache");
      await expect(Effect.runPromise(h.adapter.transfer(config, target))).rejects.toThrow(
        "did not replace",
      );
      await Effect.runPromise(h.adapter.release(config));
      expect(h.records.get(key)).toBe("existing-cache");

      const accepted = harness();
      await Effect.runPromise(
        accepted.adapter.connection.startCloudSignIn(config, cloudRepository),
      );
      await accepted.connected;
      await Effect.runPromise(accepted.adapter.transfer(config, target));
      expect(JSON.parse(accepted.records.get(key) ?? "null")).toHaveProperty("Account");
      await Effect.runPromise(accepted.adapter.complete(config));
      expect(accepted.records.size).toBe(2);

      const replacement = harness();
      await Effect.runPromise(
        replacement.adapter.connection.startCloudSignIn(config, cloudRepository),
      );
      await replacement.connected;
      replacement.failIndex(true);
      await expect(Effect.runPromise(replacement.adapter.transfer(config, target))).rejects.toThrow(
        "Index unavailable",
      );
      expect(replacement.records.has(key)).toBe(true);
      await Effect.runPromise(
        replacement.adapter.connection.replacePat(config, cloudRepository, "pat"),
      );
      replacement.failIndex(false);
      replacement.failDelete(true);
      await expect(Effect.runPromise(replacement.adapter.transfer(config, target))).rejects.toThrow(
        "Delete unavailable",
      );
      expect(replacement.records.has(key)).toBe(true);
      replacement.failDelete(false);
      await Effect.runPromise(replacement.adapter.transfer(config, target));
      expect(replacement.records.has(key)).toBe(false);
      expect(replacement.records.size).toBe(1);
      expect(
        JSON.parse(
          replacement.records.get(`${connectionScope(target, cloudRepository)}:connection`) ??
            "null",
        ),
      ).toMatchObject({ kind: "server_pat", pat: "pat" });
    } finally {
      acquire.mockRestore();
    }
  });
  test("releases a cloud attempt before Microsoft returns its device code", async () => {
    const h = harness();
    const cloudRepository: AzureDevOpsRepository = {
      ...repository,
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "org",
    };
    const config = repoConfigSchema.parse({
      ...source,
      git: { provider: { ...source.git.provider, repository: cloudRepository } },
    });
    const entered = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<null>();
    const acquire = spyOn(
      PublicClientApplication.prototype,
      "acquireTokenByDeviceCode",
    ).mockImplementation(async () => {
      entered.resolve();
      return completion.promise;
    });
    try {
      const start = Effect.runFork(h.adapter.connection.startCloudSignIn(config, cloudRepository));
      await entered.promise;
      await Effect.runPromise(h.adapter.release(config));
      const result = await Effect.runPromise(Fiber.await(start));
      expect(result._tag).toBe("Failure");
      completion.resolve(null);
      expect(h.open).not.toHaveBeenCalled();
      expect(h.events).not.toHaveBeenCalled();
    } finally {
      acquire.mockRestore();
    }
  });
  test("stages PATs in memory and retains a working PAT after failed validation", async () => {
    const h = harness();
    await Effect.runPromise(h.adapter.connection.replacePat(source, repository, "working"));
    h.rejectPat(true);
    await expect(
      Effect.runPromise(h.adapter.connection.replacePat(source, repository, "rejected")),
    ).rejects.toThrow("prior connection remains active");
    expect(
      (await Effect.runPromise(h.adapter.connection.getAuthorization(source, repository)))
        .headerValue,
    ).toBe(`Basic ${btoa(":working")}`);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.scopes.size).toBe(0);
    await Effect.runPromise(h.adapter.release(source));
    expect(h.open).not.toHaveBeenCalled();
  });
  test("retries an index failure using its own records and keeps accepted credentials after completion", async () => {
    const h = harness();
    await Effect.runPromise(h.adapter.connection.replacePat(source, repository, "working"));
    h.failIndex(true);
    await expect(Effect.runPromise(h.adapter.transfer(source, destination))).rejects.toThrow(
      "Index unavailable",
    );
    expect(h.records.size).toBe(1);
    h.failIndex(false);
    await Effect.runPromise(h.adapter.transfer(source, destination));
    await Effect.runPromise(h.adapter.complete(source));
    await Effect.runPromise(h.adapter.release(source));
    expect(h.records.get(`${connectionScope(destination, repository)}:connection`)).toBe(
      JSON.stringify({ kind: "server_pat", pat: "working" }),
    );
    expect(h.scopes.size).toBe(1);
  });
  test("preserves pre-existing credentials on a rejected transfer and discard", async () => {
    const h = harness();
    const key = `${connectionScope(destination, repository)}:connection`;
    h.records.set(key, "existing");
    await Effect.runPromise(h.adapter.connection.replacePat(source, repository, "working"));
    await expect(Effect.runPromise(h.adapter.transfer(source, destination))).rejects.toThrow(
      "did not replace",
    );
    await Effect.runPromise(h.adapter.release(source));
    expect(h.records.get(key)).toBe("existing");
    expect(h.open).not.toHaveBeenCalled();
  });
  test("retains transfer ownership until failed cleanup can finish", async () => {
    const h = harness();
    await Effect.runPromise(h.adapter.connection.replacePat(source, repository, "working"));
    h.failIndex(true);
    await expect(Effect.runPromise(h.adapter.transfer(source, destination))).rejects.toThrow();
    h.failDelete(true);
    await expect(Effect.runPromise(h.adapter.release(source))).rejects.toThrow(
      "Delete unavailable",
    );
    h.failDelete(false);
    await Effect.runPromise(h.adapter.release(source));
    expect(h.records.size).toBe(0);
    expect(h.scopes.size).toBe(0);
  });
  test("requires collection-specific HTTP consent before sending a PAT", async () => {
    const h = harness();
    const httpRepository = { ...repository, serviceUrl: "http://ado.example.test/tfs" };
    const config = repoConfigSchema.parse({
      ...source,
      git: {
        provider: {
          ...source.git.provider,
          repository: httpRepository,
          settings: { httpConsentCollectionUrl: "http://ado.example.test/tfs/other" },
        },
      },
    });
    await expect(
      Effect.runPromise(h.adapter.connection.replacePat(config, httpRepository, "secret")),
    ).rejects.toThrow("Confirm the unencrypted");
    expect(h.fetchImplementation).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
  });
  test("cancels an owned cloud attempt and ignores a late Microsoft callback", async () => {
    const h = harness();
    const cloudRepository: AzureDevOpsRepository = {
      ...repository,
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "org",
    };
    const config = repoConfigSchema.parse({
      ...source,
      git: { provider: { ...source.git.provider, repository: cloudRepository } },
    });
    const requests: DeviceCodeRequest[] = [];
    const completion = Promise.withResolvers<null>();
    const acquire = spyOn(
      PublicClientApplication.prototype,
      "acquireTokenByDeviceCode",
    ).mockImplementation(async (value) => {
      requests.push(value);
      value.deviceCodeCallback?.({
        verificationUri: "https://microsoft.com/devicelogin",
        userCode: "CODE",
        expiresIn: 60,
        interval: 5,
        message: "Sign in",
        deviceCode: "device",
      });
      return completion.promise;
    });
    try {
      await Effect.runPromise(h.adapter.connection.startCloudSignIn(config, cloudRepository));
      await Effect.runPromise(h.adapter.release(config));
      expect(requests[0]?.cancel).toBe(true);
      completion.resolve(null);
      await Promise.resolve();
      expect(h.events).not.toHaveBeenCalled();
      expect(h.open).not.toHaveBeenCalled();
      expect(
        await Effect.runPromise(h.adapter.connection.getState(config, cloudRepository)),
      ).toEqual({ status: "disconnected" });
    } finally {
      acquire.mockRestore();
    }
  });
});
