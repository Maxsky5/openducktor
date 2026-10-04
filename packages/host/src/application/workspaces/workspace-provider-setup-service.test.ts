import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import {
  type GlobalConfig,
  type AzureDevOpsDeviceCode,
  type GitProviderHealth,
  type AzureDevOpsConnectionState,
  type WorkspaceProviderSetupSelection,
  type WorkspaceProviderSetupCommit,
} from "@openducktor/contracts";
import { azureDevOpsConnectionConfigurationFingerprint } from "@openducktor/core";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError, type HostError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceProviderSetupCredentialsPort } from "../../ports/workspace-provider-setup-credentials-port";
import { createWorkspaceSettingsService } from "./workspace-settings-service";
import { createWorkspaceProviderSetupService } from "./workspace-provider-setup-service";

const azureSelection = {
  kind: "configured",
  config: {
    id: "azure_devops",
    enabled: true,
    autoDetected: false,
    repository: {
      providerId: "azure_devops",
      deployment: "services",
      serviceUrl: "https://dev.azure.com",
      organization: "org",
      project: "project",
      name: "repo",
    },
  },
} satisfies WorkspaceProviderSetupSelection;
const githubSelection = {
  kind: "configured",
  config: {
    id: "github",
    enabled: true,
    autoDetected: false,
    repository: { host: "github.com", owner: "owner", name: "repo" },
  },
} satisfies WorkspaceProviderSetupSelection;
const healthy: GitProviderHealth = {
  providerId: "azure_devops",
  enabled: true,
  available: true,
  authenticated: true,
  repositoryMappingValid: true,
  executablePath: null,
  version: null,
  account: null,
};
const unavailable: GitProviderHealth = {
  ...healthy,
  available: false,
  reason: "Provider unavailable",
};
const failure = () =>
  new HostOperationError({ operation: "test.write", message: "Storage unavailable" });
function harness() {
  let config: GlobalConfig = createDefaultGlobalConfig();
  let failWrite = false;
  const write = mock((next: GlobalConfig) =>
    Effect.suspend(() => {
      if (failWrite) return Effect.fail(failure());
      config = structuredClone(next);
      return Effect.void;
    }),
  );
  const port: SettingsConfigPort = {
    readConfig: () => Effect.sync(() => structuredClone(config)),
    writeConfig: write,
    canonicalizePath: (value) => Effect.succeed(value),
    pathExists: () => Effect.succeed(true),
    defaultWorktreeBasePath: (id) => `/worktrees/${id}`,
    defaultRepoWorktreeBasePath: () => "/worktrees/repo",
    resolveConfiguredPath: (value) => value,
    join: (...parts) => parts.join("/"),
  };
  let health: GitProviderHealth = { ...healthy };
  const checkHealth = mock((): Effect.Effect<GitProviderHealth, HostError> =>
    Effect.sync(() => health),
  );
  let connection: AzureDevOpsConnectionState = { status: "disconnected" };
  let failRelease = false;
  let failTransfer = false;
  const transfer = mock(() =>
    Effect.suspend(() => (failTransfer ? Effect.fail(failure()) : Effect.void)),
  );
  const release = mock(() =>
    Effect.suspend(() => (failRelease ? Effect.fail(failure()) : Effect.void)),
  );
  const complete = mock(() => Effect.void);
  const credentials: WorkspaceProviderSetupCredentialsPort = {
    transfer,
    release,
    complete,
    connection: {
      getState: () => Effect.sync(() => connection),
      getAuthorization: () => Effect.succeed({ headerValue: "secret", account: null }),
      replacePat: () =>
        Effect.sync(() => {
          connection = { status: "connected", account: null };
        }),
      startCloudSignIn: () =>
        Effect.sync(() => {
          const code = {
            attemptId: crypto.randomUUID(),
            verificationUri: "https://microsoft.com/devicelogin",
            userCode: "CODE",
            expiresAt: "2099-01-01T00:00:00Z",
          };
          connection = { status: "pending", deviceCode: code };
          return code;
        }),
      cancelCloudSignIn: () =>
        Effect.sync(() => {
          connection = { status: "disconnected" };
        }),
      disconnect: () => Effect.void,
      removeWorkspaceCredentials: () => Effect.void,
      shutdown: () => Effect.void,
    },
  };
  const publish = mock(() => undefined);
  const service = createWorkspaceProviderSetupService({
    git: {
      canonicalizePath: (value) => Effect.succeed(value),
      isGitRepository: () => Effect.succeed(true),
    },
    newSetupId: () => crypto.randomUUID(),
    detectRepositories: () => Effect.succeed({ outcome: "none", candidates: [] }),
    settings: createWorkspaceSettingsService(port),
    credentials,
    github: { health: () => ({ getStatus: checkHealth }) },
    azure: { health: () => ({ getStatus: checkHealth }) },
    areas: { list: () => Effect.succeed(["project\\area"]) },
    inspectGithub: () =>
      Effect.succeed({
        executablePath: null,
        version: null,
        authenticated: false,
        account: null,
        reason: "Install gh",
      }),
    publish,
  });
  return {
    service,
    credentials,
    write,
    transfer,
    release,
    complete,
    publish,
    checkHealth,
    config: () => config,
    failWrite: (value: boolean) => {
      failWrite = value;
    },
    failTransfer: (value: boolean) => {
      failTransfer = value;
    },
    failRelease: (value: boolean) => {
      failRelease = value;
    },
    setHealth: (value: GitProviderHealth) => {
      health = value;
    },
  };
}
const details = (ref: { setupId: string; revision: number }): WorkspaceProviderSetupCommit => ({
  setupId: ref.setupId,
  revision: ref.revision,
  workspaceId: "repo",
  workspaceName: "Repository",
  agentDefaults: {},
  defaultModel: { runtimeKind: "opencode", providerId: "provider", modelId: "model" },
});

describe("workspace provider setup", () => {
  test.each(["github", "azure_devops"] as const)(
    "creates an unchanged %s workspace with accepted readiness after the provider becomes unavailable",
    async (providerId) => {
      const h = harness();
      const selection = providerId === "github" ? githubSelection : azureSelection;
      let ref = await Effect.runPromise(h.service.begin("/repo"));
      ref = await Effect.runPromise(h.service.set(ref, selection));
      if (providerId === "azure_devops") await Effect.runPromise(h.service.pat(ref, "token"));
      h.setHealth({ ...healthy, providerId });
      expect((await Effect.runPromise(h.service.status(ref))).health?.available).toBe(true);
      h.setHealth({ ...unavailable, providerId });
      const result = await Effect.runPromise(h.service.commit(details(ref)));
      expect(result.phase).toBe("complete");
      expect(h.config().workspaces.repo?.git.provider).toEqual(selection.config);
      expect(h.checkHealth).toHaveBeenCalledTimes(1);
    },
  );
  test.each(["selection", "PAT", "sign-in", "disconnect"] as const)(
    "checks readiness again after a %s change",
    async (change) => {
      const h = harness();
      let ref = await Effect.runPromise(h.service.begin("/repo"));
      ref = await Effect.runPromise(h.service.set(ref, azureSelection));
      await Effect.runPromise(h.service.pat(ref, "first-token"));
      await Effect.runPromise(h.service.status(ref));
      switch (change) {
        case "selection":
          ref = await Effect.runPromise(
            h.service.set(ref, {
              ...azureSelection,
              config: {
                ...azureSelection.config,
                repository: { ...azureSelection.config.repository, name: "other-repo" },
              },
            }),
          );
          break;
        case "PAT":
          await Effect.runPromise(h.service.pat(ref, "replacement-token"));
          break;
        case "sign-in":
          await Effect.runPromise(h.service.signIn(ref));
          break;
        case "disconnect":
          await Effect.runPromise(h.service.disconnect(ref));
      }
      h.setHealth(unavailable);
      const result = await Effect.runPromise(h.service.commit(details(ref)));
      expect(result.registrationSaved).toBe(false);
      expect(result.error).toContain("Provider unavailable");
      expect(h.checkHealth).toHaveBeenCalledTimes(2);
      expect(h.write).not.toHaveBeenCalled();
    },
  );
  test.each(["unhealthy", "failed"] as const)(
    "does not reuse an earlier success after a %s readiness check",
    async (result) => {
      const h = harness();
      let ref = await Effect.runPromise(h.service.begin("/repo"));
      ref = await Effect.runPromise(h.service.set(ref, azureSelection));
      await Effect.runPromise(h.service.pat(ref, "token"));
      await Effect.runPromise(h.service.status(ref));
      h.setHealth(unavailable);
      if (result === "failed") {
        h.checkHealth.mockImplementationOnce(() => Effect.fail(failure()));
        await expect(Effect.runPromise(h.service.status(ref))).rejects.toThrow(
          "Storage unavailable",
        );
      } else {
        expect((await Effect.runPromise(h.service.status(ref))).health?.available).toBe(false);
      }
      const outcome = await Effect.runPromise(h.service.commit(details(ref)));
      expect(outcome.registrationSaved).toBe(false);
      expect(outcome.error).toContain("Provider unavailable");
      expect(h.write).not.toHaveBeenCalled();
    },
  );
  test("does not reuse a late readiness reply after the repository changes", async () => {
    const h = harness();
    let ref = await Effect.runPromise(h.service.begin("/repo"));
    ref = await Effect.runPromise(h.service.set(ref, azureSelection));
    await Effect.runPromise(h.service.pat(ref, "token"));
    await Effect.runPromise(h.service.status(ref));
    const entered = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<GitProviderHealth>();
    h.checkHealth.mockImplementationOnce(() =>
      Effect.gen(function* () {
        entered.resolve();
        return yield* Effect.promise(() => finish.promise);
      }),
    );
    const checking = Effect.runPromise(Effect.either(h.service.status(ref)));
    await entered.promise;
    ref = await Effect.runPromise(
      h.service.set(ref, {
        ...azureSelection,
        config: {
          ...azureSelection.config,
          repository: { ...azureSelection.config.repository, name: "other-repo" },
        },
      }),
    );
    h.setHealth(unavailable);
    finish.resolve(healthy);
    expect((await checking)._tag).toBe("Left");
    const outcome = await Effect.runPromise(h.service.commit(details(ref)));
    expect(outcome.registrationSaved).toBe(false);
    expect(outcome.error).toContain("Provider unavailable");
    expect(h.checkHealth).toHaveBeenCalledTimes(3);
    expect(h.write).not.toHaveBeenCalled();
  });
  test("uses corrected details and models after an unsaved attempt", async () => {
    const h = harness();
    const ref = await Effect.runPromise(h.service.begin("/repo"));
    h.failWrite(true);
    const failed = await Effect.runPromise(h.service.commit(details(ref)));
    expect(failed.registrationSaved).toBe(false);
    h.failWrite(false);
    const corrected = {
      ...details(ref),
      workspaceId: "corrected",
      workspaceName: "Corrected repository",
      defaultModel: { runtimeKind: "codex" as const, providerId: "openai", modelId: "o3" },
    };
    const result = await Effect.runPromise(h.service.commit(corrected));
    expect(result.workspace?.workspaceId).toBe("corrected");
    expect(h.config().workspaces.corrected).toMatchObject({
      workspaceName: "Corrected repository",
      defaultModel: corrected.defaultModel,
    });
    expect(h.config().workspaces.repo).toBeUndefined();
  });
  test("cancels sign-in startup on departure and holds the setup lock until cleanup finishes", async () => {
    const h = harness();
    let ref = await Effect.runPromise(h.service.begin("/repo"));
    ref = await Effect.runPromise(h.service.set(ref, azureSelection));
    const entered = Promise.withResolvers<void>();
    const releasing = Promise.withResolvers<void>();
    const finishCleanup = Promise.withResolvers<void>();
    let cancel = () => {};
    h.credentials.connection.startCloudSignIn = () =>
      Effect.async<AzureDevOpsDeviceCode, HostError>((resume) => {
        cancel = () => resume(Effect.fail(failure()));
        entered.resolve();
      });
    h.release.mockImplementation(() =>
      Effect.gen(function* () {
        cancel();
        releasing.resolve();
        yield* Effect.promise(() => finishCleanup.promise);
      }),
    );
    const start = Effect.runPromise(Effect.either(h.service.signIn(ref)));
    await entered.promise;
    const discard = Effect.runPromise(h.service.discard(ref.setupId));
    await releasing.promise;
    expect((await start)._tag).toBe("Left");
    await expect(Effect.runPromise(h.service.set(ref, { kind: "none" }))).rejects.toThrow(
      "operation is running",
    );
    finishCleanup.resolve();
    await discard;
    await expect(Effect.runPromise(h.service.status(ref))).rejects.toThrow("no longer active");
    expect(h.write).not.toHaveBeenCalled();
  });
  test("reads and cancellation never register; skip saves details and models in one write", async () => {
    const h = harness();
    const ref = await Effect.runPromise(h.service.begin("/repo"));
    await Effect.runPromise(h.service.detect(ref));
    await Effect.runPromise(h.service.github(ref, "github.com"));
    expect(h.write).not.toHaveBeenCalled();
    const result = await Effect.runPromise(h.service.commit(details(ref)));
    expect(result.phase).toBe("complete");
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.config().workspaces.repo?.git).toEqual({});
    expect(h.config().workspaces.repo?.defaultModel).toEqual(details(ref).defaultModel);
    expect(h.transfer).not.toHaveBeenCalled();
    expect(await Effect.runPromise(h.service.commit(details(ref)))).toEqual(result);
    expect(h.write).toHaveBeenCalledTimes(1);
    expect((await Effect.runPromise(h.service.progress(ref.setupId))).progress).toEqual(result);
    await Effect.runPromise(h.service.discard(ref.setupId));
    await expect(Effect.runPromise(h.service.progress(ref.setupId))).rejects.toThrow("not found");
    await Effect.runPromise(h.service.discard(ref.setupId));
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  test("blocks enabled mapping failures and invalid snapshots but accepts disabled settings without authentication", async () => {
    const h = harness();
    let ref = await Effect.runPromise(h.service.begin("/repo"));
    ref = await Effect.runPromise(h.service.set(ref, azureSelection));
    h.setHealth({
      providerId: "azure_devops",
      enabled: true,
      available: false,
      authenticated: true,
      repositoryMappingValid: false,
      executablePath: null,
      version: null,
      account: null,
      reason: "Several remotes match",
    });
    const failed = await Effect.runPromise(h.service.commit(details(ref)));
    expect(failed.error).toContain("Several remotes match");
    expect(h.write).not.toHaveBeenCalled();
    ref = await Effect.runPromise(
      h.service.set(ref, { kind: "incomplete", providerId: "azure_devops" }),
    );
    expect((await Effect.runPromise(h.service.commit(details(ref)))).registrationSaved).toBe(false);
    ref = await Effect.runPromise(
      h.service.set(ref, {
        ...azureSelection,
        config: { ...azureSelection.config, enabled: false },
      }),
    );
    expect((await Effect.runPromise(h.service.commit(details(ref)))).phase).toBe("complete");
    expect(h.config().workspaces.repo?.git.provider?.enabled).toBe(false);
    expect(h.transfer).not.toHaveBeenCalled();
  });
  test("exposes failed writes and resumes credential transfer without registering twice", async () => {
    const h = harness();
    let ref = await Effect.runPromise(h.service.begin("/repo"));
    ref = await Effect.runPromise(h.service.set(ref, azureSelection));
    await Effect.runPromise(h.service.pat(ref, "secret"));
    h.failWrite(true);
    expect((await Effect.runPromise(h.service.commit(details(ref)))).registrationSaved).toBe(false);
    h.failWrite(false);
    h.setHealth(unavailable);
    h.failTransfer(true);
    const partial = await Effect.runPromise(h.service.commit(details(ref)));
    expect(partial).toMatchObject({
      phase: "credentials",
      registrationSaved: true,
      settingsSaved: true,
      credentialsSaved: false,
    });
    expect(partial.workspace?.workspaceId).toBe("repo");
    h.failTransfer(false);
    const outcome = await Effect.runPromise(h.service.commit(details(ref)));
    expect(outcome.phase).toBe("complete");
    expect(Object.keys(h.config().workspaces)).toEqual(["repo"]);
    expect(h.write).toHaveBeenCalledTimes(2);
    expect(h.transfer).toHaveBeenCalledTimes(2);
    expect(h.complete).toHaveBeenCalledTimes(1);
    expect(h.checkHealth).toHaveBeenCalledTimes(1);
    const saved = structuredClone(h.config());
    await Effect.runPromise(h.service.discard(ref.setupId));
    await expect(Effect.runPromise(h.service.progress(ref.setupId))).rejects.toThrow("not found");
    await Effect.runPromise(h.service.discard(ref.setupId));
    expect(h.release).not.toHaveBeenCalled();
    expect(h.config()).toEqual(saved);
  });
  test("keeps cleanup failures retryable and prevents stale revisions and owned sign-in events", async () => {
    const h = harness();
    let ref = await Effect.runPromise(h.service.begin("/repo"));
    ref = await Effect.runPromise(h.service.set(ref, azureSelection));
    const code = await Effect.runPromise(h.service.signIn(ref));
    const event = {
      workspaceId: ref.setupId,
      repoPath: ref.repoPath,
      providerId: "azure_devops" as const,
      configurationFingerprint: azureDevOpsConnectionConfigurationFingerprint(
        ref.setupId,
        ref.repoPath,
        azureSelection.config.repository,
      ),
      attemptId: code.attemptId,
      state: { status: "connected" as const, account: "user" },
    };
    h.service.connectionUpdated(event);
    expect(h.publish).toHaveBeenCalledTimes(1);
    h.failRelease(true);
    await expect(Effect.runPromise(h.service.set(ref, { kind: "none" }))).rejects.toThrow(
      "Storage unavailable",
    );
    h.service.connectionUpdated(event);
    expect(h.publish).toHaveBeenCalledTimes(1);
    await expect(Effect.runPromise(h.service.status(ref))).rejects.toThrow("cleanup failed");
    h.failRelease(false);
    const old = ref;
    ref = await Effect.runPromise(h.service.set(ref, { kind: "none" }));
    await expect(Effect.runPromise(h.service.status(old))).rejects.toThrow("changed");
    await Effect.runPromise(h.service.discard(ref.setupId));
    await Effect.runPromise(h.service.discard(ref.setupId));
    expect(h.write).not.toHaveBeenCalled();
  });
});
