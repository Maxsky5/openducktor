import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  agentPromptTemplateIdValues,
  type BuildSessionBootstrap,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type RuntimeInstanceSummary,
  type SettingsSnapshot,
  type TaskWorktreeSummary,
} from "@openducktor/contracts";
import { clearAppQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";
import { createDeferred, withTimeout } from "../test-utils";
import {
  createEnsureRuntime,
  loadRepoDefaultModel,
  loadRepoPromptOverrides,
  resolveRuntimeRouteConnection,
  setRuntimeRepoConfigLoaderForTest,
} from "./runtime";

const buildBootstrapFixture: BuildSessionBootstrap = {
  runtimeKind: "opencode",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  workingDirectory: "/tmp/repo/worktree",
};

const sharedRuntimeFixture: RuntimeInstanceSummary = {
  kind: "opencode",
  runtimeId: "runtime-shared",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/tmp/repo/shared",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4666",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
};

const taskWorktreeFixture: TaskWorktreeSummary = {
  workingDirectory: "/tmp/repo/worktree",
};

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/tmp/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "obp",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
  trustedHooks: false,
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const createPromptOverrideRepoConfig = (
  promptOverrides: RepoConfig["promptOverrides"],
): RepoConfig =>
  createRepoConfig({
    promptOverrides,
  });

const createPromptOverrideSettingsSnapshot = (
  globalPromptOverrides: SettingsSnapshot["globalPromptOverrides"],
): SettingsSnapshot => ({
  theme: "light",
  git: { defaultMergeMethod: "merge_commit" },
  chat: { showThinkingMessages: false },
  kanban: { doneVisibleDays: 1 },
  autopilot: { rules: [] },
  workspaces: {},
  globalPromptOverrides,
});

describe("agent-orchestrator-runtime", () => {
  let restoreRuntimeRepoConfigLoader: (() => void) | null = null;
  let runtimeHost: NonNullable<Parameters<typeof createEnsureRuntime>[0]["hostClient"]>;

  beforeEach(async () => {
    restoreRuntimeRepoConfigLoader?.();
    await clearAppQueryClient();
    restoreRuntimeRepoConfigLoader = setRuntimeRepoConfigLoaderForTest(async () =>
      createRepoConfig(),
    );
    host.workspaceList = async () => [
      {
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/tmp/repo",
        isActive: true,
        hasConfig: true,
        configuredWorktreeBasePath: null,
        defaultWorktreeBasePath: "/tmp/worktrees/repo",
        effectiveWorktreeBasePath: "/tmp/worktrees/repo",
      },
    ];
    host.workspaceGetRepoConfig = async () => createRepoConfig();
    runtimeHost = {
      runtimeEnsure: async () => sharedRuntimeFixture,
      buildStart: async () => buildBootstrapFixture,
      taskWorktreeGet: async () => taskWorktreeFixture,
    };
  });

  afterEach(() => {
    restoreRuntimeRepoConfigLoader?.();
    restoreRuntimeRepoConfigLoader = null;
  });

  test("resolves runtime route connections through one shared boundary helper", () => {
    expect(
      resolveRuntimeRouteConnection(
        {
          type: "local_http",
          endpoint: "http://127.0.0.1:4555",
        },
        "/tmp/repo/worktree",
      ),
    ).toEqual({
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4555",
        workingDirectory: "/tmp/repo/worktree",
      },
    });
  });

  test("starts build bootstrap and refreshes task data when no target worktree is provided", async () => {
    let refreshCalls = 0;
    let buildStartCalls = 0;

    runtimeHost.buildStart = async () => {
      buildStartCalls += 1;
      return buildBootstrapFixture;
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {
        refreshCalls += 1;
      },
    });

    const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
      workspaceId: "workspace-1",
    });

    expect(runtime).toEqual({
      runtimeKind: "opencode",
      runtimeId: null,
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      },
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(buildStartCalls).toBe(1);
    expect(refreshCalls).toBe(1);
  });

  test("returns build runtime without waiting for refresh completion", async () => {
    const refreshDeferred = createDeferred<void>();

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => refreshDeferred.promise,
    });

    const runtimePromise = ensureRuntime("/tmp/repo", "task-1", "build", {
      workspaceId: "workspace-1",
    });
    const raceResult = await withTimeout(runtimePromise, 20);
    refreshDeferred.resolve();
    if (raceResult === "timeout") {
      throw new Error("Expected runtime resolution before timeout");
    }

    expect(raceResult).toEqual({
      runtimeKind: "opencode",
      runtimeId: null,
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      },
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4444" },
      workingDirectory: "/tmp/repo/worktree",
    });
    await expect(runtimePromise).resolves.toEqual(raceResult);
  });

  test("propagates build startup transport errors before returning an unusable stdio runtime", async () => {
    runtimeHost.buildStart = async () => {
      throw new Error("Runtime build session startup requires a local_http runtime route");
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "build", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Runtime build session startup requires a local_http runtime route");
  });

  test("fails before build start when repo and role runtime defaults are missing", async () => {
    restoreRuntimeRepoConfigLoader?.();
    restoreRuntimeRepoConfigLoader = setRuntimeRepoConfigLoaderForTest(async () =>
      createRepoConfig({
        defaultRuntimeKind: undefined as never,
        agentDefaults: {},
      }),
    );
    runtimeHost.buildStart = mock(async () => buildBootstrapFixture);
    runtimeHost.runtimeEnsure = mock(async () => sharedRuntimeFixture);
    runtimeHost.taskWorktreeGet = mock(async () => taskWorktreeFixture);

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "build", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow(
      "Runtime kind is not configured for build sessions. Select a build agent runtime or repository default runtime before starting a session.",
    );
    expect(runtimeHost.buildStart).not.toHaveBeenCalled();
    expect(runtimeHost.runtimeEnsure).not.toHaveBeenCalled();
    expect(runtimeHost.taskWorktreeGet).not.toHaveBeenCalled();
  });

  test("fails before runtime ensure when repo default runtime is blank", async () => {
    restoreRuntimeRepoConfigLoader?.();
    restoreRuntimeRepoConfigLoader = setRuntimeRepoConfigLoaderForTest(async () =>
      createRepoConfig({
        defaultRuntimeKind: " " as never,
        agentDefaults: {},
      }),
    );
    runtimeHost.buildStart = mock(async () => buildBootstrapFixture);
    runtimeHost.runtimeEnsure = mock(async () => sharedRuntimeFixture);
    runtimeHost.taskWorktreeGet = mock(async () => taskWorktreeFixture);

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "spec", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow(
      "Runtime kind is not configured for spec sessions. Select a spec agent runtime or repository default runtime before starting a session.",
    );
    expect(runtimeHost.buildStart).not.toHaveBeenCalled();
    expect(runtimeHost.runtimeEnsure).not.toHaveBeenCalled();
    expect(runtimeHost.taskWorktreeGet).not.toHaveBeenCalled();
  });

  test("uses shared repo runtime for build role when a target working directory is provided", async () => {
    let buildStartCalls = 0;
    let repoRuntimeEnsureCalls = 0;

    runtimeHost.buildStart = async () => {
      buildStartCalls += 1;
      return buildBootstrapFixture;
    };
    runtimeHost.runtimeEnsure = async () => {
      repoRuntimeEnsureCalls += 1;
      return sharedRuntimeFixture;
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {},
    });

    const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
      workspaceId: "workspace-1",
      targetWorkingDirectory: "/tmp/repo/conflict-worktree",
    });

    expect(runtime).toEqual({
      runtimeKind: "opencode",
      runtimeId: "runtime-shared",
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4666",
        workingDirectory: "/tmp/repo/conflict-worktree",
      },
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4666" },
      workingDirectory: "/tmp/repo/conflict-worktree",
    });
    expect(buildStartCalls).toBe(0);
    expect(repoRuntimeEnsureCalls).toBe(1);
  });

  test("uses task worktree for qa when builder worktree exists", async () => {
    let continuationCalls = 0;
    let repoRuntimeEnsureCalls = 0;

    runtimeHost.taskWorktreeGet = async () => {
      continuationCalls += 1;
      return taskWorktreeFixture;
    };
    runtimeHost.runtimeEnsure = async () => {
      repoRuntimeEnsureCalls += 1;
      return sharedRuntimeFixture;
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {},
    });

    const runtime = await ensureRuntime("/tmp/repo", "task-1", "qa", {
      workspaceId: "workspace-1",
    });

    expect(runtime).toEqual({
      runtimeKind: "opencode",
      runtimeId: "runtime-shared",
      runtimeConnection: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4666",
        workingDirectory: "/tmp/repo/worktree",
      },
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:4666" },
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(continuationCalls).toBe(1);
    expect(repoRuntimeEnsureCalls).toBe(1);
  });

  test("throws actionable error when qa has no task worktree", async () => {
    runtimeHost.taskWorktreeGet = async () => null;

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "qa", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Builder continuation cannot start until a builder worktree exists");
  });

  test("propagates repo config loading errors when default model lookup fails", async () => {
    restoreRuntimeRepoConfigLoader?.();
    restoreRuntimeRepoConfigLoader = setRuntimeRepoConfigLoaderForTest(async () => {
      throw new Error("missing config");
    });

    await expect(loadRepoDefaultModel("/tmp/repo", "build")).rejects.toThrow("missing config");
  });

  test("maps repo role defaults into model selection", async () => {
    restoreRuntimeRepoConfigLoader?.();
    restoreRuntimeRepoConfigLoader = setRuntimeRepoConfigLoaderForTest(async () =>
      createRepoConfig({
        agentDefaults: {
          build: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "builder",
          },
        },
      }),
    );

    const selection = await loadRepoDefaultModel("/tmp/repo", "build");
    expect(selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "builder",
    });
  });

  test("loads effective prompt overrides by merging global and repository values", async () => {
    const repoConfig = createPromptOverrideRepoConfig({
      "kickoff.planner_initial": {
        template: "repo planner {{task.id}}",
        baseVersion: 1,
        enabled: true,
      },
      "kickoff.spec_initial": {
        template: "repo disabled {{task.id}}",
        baseVersion: 1,
        enabled: false,
      },
    });
    const snapshot = createPromptOverrideSettingsSnapshot({
      "kickoff.spec_initial": {
        template: "global kickoff {{task.id}}",
        baseVersion: 1,
        enabled: true,
      },
    });

    const overrides = await loadRepoPromptOverrides("/tmp/repo", {
      loadRepoConfig: async () => repoConfig,
      loadSettingsSnapshot: async () => snapshot,
    });

    expect(overrides["kickoff.spec_initial"]?.template).toBe("global kickoff {{task.id}}");
    expect(overrides["kickoff.spec_initial"]?.baseVersion).toBe(1);
    expect(overrides["kickoff.planner_initial"]?.template).toBe("repo planner {{task.id}}");
  });

  test("resolves effective overrides deterministically for every prompt template id", async () => {
    const globalPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId) => [
        templateId,
        {
          template: `global ${templateId}`,
          baseVersion: 1,
          enabled: true,
        },
      ]),
    );
    const repoPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId, index) => [
        templateId,
        {
          template: `repo ${templateId}`,
          baseVersion: 1,
          enabled: index % 2 === 0,
        },
      ]),
    );

    const overrides = await loadRepoPromptOverrides("/tmp/repo", {
      loadRepoConfig: async () => createPromptOverrideRepoConfig(repoPromptOverrides),
      loadSettingsSnapshot: async () => createPromptOverrideSettingsSnapshot(globalPromptOverrides),
    });

    for (const [index, templateId] of agentPromptTemplateIdValues.entries()) {
      const override = overrides[templateId];
      expect(override).toBeDefined();
      expect(override?.template).toBe(
        index % 2 === 0 ? `repo ${templateId}` : `global ${templateId}`,
      );
    }
  });
});
