import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  agentPromptTemplateIdValues,
  type RepoConfig,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { clearAppQueryClient } from "@/lib/query-client";
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { createDeferred, withTimeout } from "../test-utils";
import { createEnsureRuntime, loadRepoDefaultModel, loadRepoPromptOverrides } from "./runtime";

const taskBootstrapFixture = {
  bootstrapId: "bootstrap-1",
  role: "build" as const,
  runtimeKind: "opencode" as const,
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
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
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
): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    globalPromptOverrides,
  });

describe("agent-orchestrator-runtime", () => {
  let runtimeHost: NonNullable<Parameters<typeof createEnsureRuntime>[0]["hostClient"]>;
  let repoConfigLoader: NonNullable<Parameters<typeof createEnsureRuntime>[0]["repoConfigLoader"]>;

  beforeEach(async () => {
    await clearAppQueryClient();
    repoConfigLoader = async () => createRepoConfig();
    runtimeHost = {
      taskSessionBootstrapPrepare: async (_repoPath, _taskId, role, runtimeKind, target) => ({
        ...taskBootstrapFixture,
        role,
        runtimeKind,
        workingDirectory: target ?? taskBootstrapFixture.workingDirectory,
      }),
      taskSessionBootstrapComplete: async () => undefined,
      taskSessionBootstrapAbort: async () => undefined,
    };
  });

  test("starts build bootstrap and refreshes task data when no target worktree is provided", async () => {
    const refreshTaskData = mock(async () => {});
    let prepareCalls = 0;

    runtimeHost.taskSessionBootstrapPrepare = async (_repoPath, _taskId, role, runtimeKind) => {
      prepareCalls += 1;
      return { ...taskBootstrapFixture, role, runtimeKind };
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
      refreshTaskData,
    });

    const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
      workspaceId: "workspace-1",
    });

    expect(runtime).toMatchObject({
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(prepareCalls).toBe(1);
    expect(refreshTaskData).not.toHaveBeenCalled();
    await runtime.bootstrap?.complete();
    expect(refreshTaskData).toHaveBeenCalledWith("/tmp/repo", "task-1");
  });

  test("invalidates a cached missing worktree after Spec bootstrap completes", async () => {
    const queryClient = new QueryClient();
    const queryKey = taskWorktreeQueryKeys.taskWorktree({
      repoPath: "/tmp/repo",
      taskId: "task-1",
    });
    queryClient.setQueryData(queryKey, null);
    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      queryClient,
      repoConfigLoader,
      refreshTaskData: async () => {},
    });
    const runtime = await ensureRuntime("/tmp/repo", "task-1", "spec", {
      workspaceId: "workspace-1",
    });
    await runtime.bootstrap?.complete();
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  test("returns build runtime without waiting for refresh completion", async () => {
    const refreshDeferred = createDeferred<void>();

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
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

    expect(raceResult).toMatchObject({
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
    await expect(runtimePromise).resolves.toBe(raceResult);
  });

  test("propagates build startup transport errors before returning an unusable stdio runtime", async () => {
    runtimeHost.taskSessionBootstrapPrepare = async () => {
      throw new Error("Runtime build session startup requires a local_http runtime route");
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "build", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("Runtime build session startup requires a local_http runtime route");
  });

  test("fails before build start when repo and role runtime defaults are missing", async () => {
    repoConfigLoader = async () =>
      createRepoConfig({
        defaultRuntimeKind: undefined as never,
        agentDefaults: {},
      });
    runtimeHost.taskSessionBootstrapPrepare = mock(async () => taskBootstrapFixture);

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "build", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow(
      "Runtime kind is not configured for build sessions. Select a build agent runtime or repository default runtime before starting a session.",
    );
    expect(runtimeHost.taskSessionBootstrapPrepare).not.toHaveBeenCalled();
  });

  test("passes an explicit fresh target through canonical bootstrap validation", async () => {
    let receivedTarget: string | undefined;
    runtimeHost.taskSessionBootstrapPrepare = async (
      _repoPath,
      _taskId,
      role,
      runtimeKind,
      target,
    ) => {
      receivedTarget = target;
      return {
        ...taskBootstrapFixture,
        role,
        runtimeKind,
        workingDirectory: target ?? "/tmp/repo/worktree",
      };
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
      refreshTaskData: async () => {},
    });

    const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
      workspaceId: "workspace-1",
      targetWorkingDirectory: "/tmp/repo/conflict-worktree",
    });

    expect(runtime).toMatchObject({
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/conflict-worktree",
    });
    expect(receivedTarget).toBe("/tmp/repo/conflict-worktree");
  });

  test("lets qa create or reuse the canonical task worktree through bootstrap", async () => {
    let preparedRole = "";
    runtimeHost.taskSessionBootstrapPrepare = async (_repoPath, _taskId, role, runtimeKind) => {
      preparedRole = role;
      return { ...taskBootstrapFixture, role, runtimeKind };
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
      refreshTaskData: async () => {},
    });

    const runtime = await ensureRuntime("/tmp/repo", "task-1", "qa", {
      workspaceId: "workspace-1",
    });

    expect(runtime).toMatchObject({
      runtimeKind: "opencode",
      workingDirectory: "/tmp/repo/worktree",
    });
    expect(preparedRole).toBe("qa");
  });

  test("propagates actionable qa bootstrap failures", async () => {
    runtimeHost.taskSessionBootstrapPrepare = async () => {
      throw new Error("Canonical task worktree path is occupied by another repository");
    };

    const ensureRuntime = createEnsureRuntime({
      hostClient: runtimeHost,
      repoConfigLoader,
      refreshTaskData: async () => {},
    });

    await expect(
      ensureRuntime("/tmp/repo", "task-1", "qa", {
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("occupied by another repository");
  });

  test("propagates repo config loading errors when default model lookup fails", async () => {
    const failingRepoConfigLoader = async () => {
      throw new Error("missing config");
    };

    await expect(
      loadRepoDefaultModel("/tmp/repo", "build", failingRepoConfigLoader),
    ).rejects.toThrow("missing config");
  });

  test("maps repo role defaults into model selection", async () => {
    const selection = await loadRepoDefaultModel("/tmp/repo", "build", async () =>
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
