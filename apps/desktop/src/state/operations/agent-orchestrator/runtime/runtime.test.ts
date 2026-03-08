import { beforeEach, describe, expect, test } from "bun:test";
import type { RunSummary } from "@openducktor/contracts";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import { host } from "../../host";
import { createDeferred, withTimeout } from "../test-utils";
import {
  createEnsureRuntime,
  loadRepoDefaultModel,
  loadRepoPromptOverrides,
  loadTaskDocuments,
} from "./runtime";

const runningRunFixture: RunSummary = {
  runId: "run-1",
  repoPath: "/tmp/repo",
  taskId: "task-1",
  branch: "obp/task-1",
  worktreePath: "/tmp/repo/worktree",
  port: 4444,
  state: "running",
  lastMessage: null,
  startedAt: "2026-02-22T08:00:00.000Z",
};

describe("agent-orchestrator-runtime", () => {
  beforeEach(() => {
    host.workspaceGetRepoConfig = async () => ({
      defaultRuntimeKind: "opencode",
      branchPrefix: "obp",
      defaultTargetBranch: "main",
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    });
  });

  test("reuses running build run without starting another", async () => {
    let refreshCalls = 0;
    let buildStartCalls = 0;

    const originalBuildStart = host.buildStart;
    host.buildStart = async () => {
      buildStartCalls += 1;
      return runningRunFixture;
    };

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [runningRunFixture] },
        refreshTaskData: async () => {
          refreshCalls += 1;
        },
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "build");
      expect(runtime).toEqual({
        runtimeKind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
      expect(buildStartCalls).toBe(0);
      expect(refreshCalls).toBe(0);
    } finally {
      host.buildStart = originalBuildStart;
    }
  });

  test("does not reuse running build run from a different repo", async () => {
    let refreshCalls = 0;
    let buildStartCalls = 0;

    const originalBuildStart = host.buildStart;
    host.buildStart = async () => {
      buildStartCalls += 1;
      return runningRunFixture;
    };

    const foreignRepoRun: RunSummary = {
      ...runningRunFixture,
      repoPath: "/tmp/other-repo",
      runId: "run-foreign",
    };

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [foreignRepoRun] },
        refreshTaskData: async () => {
          refreshCalls += 1;
        },
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "build");
      expect(runtime.runId).toBe("run-1");
      expect(buildStartCalls).toBe(1);
      expect(refreshCalls).toBe(1);
    } finally {
      host.buildStart = originalBuildStart;
    }
  });

  test("starts build run and refreshes task data when no run exists", async () => {
    let refreshCalls = 0;
    let buildStartCalls = 0;

    const originalBuildStart = host.buildStart;
    host.buildStart = async () => {
      buildStartCalls += 1;
      return runningRunFixture;
    };

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [] },
        refreshTaskData: async () => {
          refreshCalls += 1;
        },
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "build");
      expect(runtime.runId).toBe("run-1");
      expect(buildStartCalls).toBe(1);
      expect(refreshCalls).toBe(1);
    } finally {
      host.buildStart = originalBuildStart;
    }
  });

  test("returns build runtime without waiting for refresh completion", async () => {
    const refreshDeferred = createDeferred<void>();

    const originalBuildStart = host.buildStart;
    host.buildStart = async () => runningRunFixture;

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [] },
        refreshTaskData: async () => refreshDeferred.promise,
      });

      const runtimePromise = ensureRuntime("/tmp/repo", "task-1", "build");
      const raceResult = await withTimeout(runtimePromise, 20);
      refreshDeferred.resolve();

      expect(raceResult).toEqual({
        runtimeKind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
      await expect(runtimePromise).resolves.toEqual({
        runtimeKind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
    } finally {
      refreshDeferred.resolve();
      host.buildStart = originalBuildStart;
    }
  });

  test("reuses the matching running build runtime when a working-directory override is provided", async () => {
    let buildStartCalls = 0;
    let repoRuntimeEnsureCalls = 0;

    const originalBuildStart = host.buildStart;
    const originalRepoRuntimeEnsure = host.runtimeEnsure;
    host.buildStart = async () => {
      buildStartCalls += 1;
      return runningRunFixture;
    };
    host.runtimeEnsure = async () => {
      repoRuntimeEnsureCalls += 1;
      return {
        kind: "opencode",
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "planner",
        endpoint: "http://127.0.0.1:4666",
        port: 4666,
        workingDirectory: "/tmp/repo/shared",
        startedAt: "2026-02-22T08:00:00.000Z",
      };
    };

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [runningRunFixture] },
        refreshTaskData: async () => {},
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
        workingDirectoryOverride: "/tmp/repo/worktree",
      });
      expect(runtime).toEqual({
        runtimeKind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
      expect(buildStartCalls).toBe(0);
      expect(repoRuntimeEnsureCalls).toBe(0);
    } finally {
      host.buildStart = originalBuildStart;
      host.runtimeEnsure = originalRepoRuntimeEnsure;
    }
  });

  test("uses the shared repo runtime for build role when a working-directory override is provided without a matching run", async () => {
    let buildStartCalls = 0;
    let repoRuntimeEnsureCalls = 0;

    const originalBuildStart = host.buildStart;
    const originalRepoRuntimeEnsure = host.runtimeEnsure;
    host.buildStart = async () => {
      buildStartCalls += 1;
      return runningRunFixture;
    };
    host.runtimeEnsure = async () => {
      repoRuntimeEnsureCalls += 1;
      return {
        kind: "opencode",
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "planner",
        endpoint: "http://127.0.0.1:4666",
        port: 4666,
        workingDirectory: "/tmp/repo/shared",
        startedAt: "2026-02-22T08:00:00.000Z",
      };
    };

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [] },
        refreshTaskData: async () => {},
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
        workingDirectoryOverride: "/tmp/repo/conflict-worktree",
      });
      expect(runtime).toEqual({
        runtimeKind: "opencode",
        runtimeId: "runtime-shared",
        runId: null,
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4666",
          workingDirectory: "/tmp/repo/conflict-worktree",
        },
        runtimeEndpoint: "http://127.0.0.1:4666",
        workingDirectory: "/tmp/repo/conflict-worktree",
      });
      expect(buildStartCalls).toBe(0);
      expect(repoRuntimeEnsureCalls).toBe(1);
    } finally {
      host.buildStart = originalBuildStart;
      host.runtimeEnsure = originalRepoRuntimeEnsure;
    }
  });

  test("reuses the running build runtime when the override points at the repo root", async () => {
    let repoRuntimeEnsureCalls = 0;

    const originalRepoRuntimeEnsure = host.runtimeEnsure;
    host.runtimeEnsure = async () => {
      repoRuntimeEnsureCalls += 1;
      return {
        kind: "opencode",
        runtimeId: "runtime-shared",
        repoPath: "/tmp/repo",
        taskId: "task-1",
        role: "planner",
        endpoint: "http://127.0.0.1:4666",
        port: 4666,
        workingDirectory: "/tmp/repo/shared",
        startedAt: "2026-02-22T08:00:00.000Z",
      };
    };

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [runningRunFixture] },
        refreshTaskData: async () => {},
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "build", {
        workingDirectoryOverride: "/tmp/repo",
      });
      expect(runtime).toEqual({
        runtimeKind: "opencode",
        runtimeId: null,
        runId: "run-1",
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4444",
          workingDirectory: "/tmp/repo/worktree",
        },
        runtimeEndpoint: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
      expect(repoRuntimeEnsureCalls).toBe(0);
    } finally {
      host.runtimeEnsure = originalRepoRuntimeEnsure;
    }
  });

  test("propagates repo config loading errors when default model lookup fails", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    host.workspaceGetRepoConfig = async () => {
      throw new Error("missing config");
    };

    try {
      await expect(loadRepoDefaultModel("/tmp/repo", "build")).rejects.toThrow("missing config");
    } finally {
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    }
  });

  test("maps repo role defaults into model selection", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    host.workspaceGetRepoConfig = async () => ({
      defaultRuntimeKind: "opencode" as const,
      branchPrefix: "obp",
      defaultTargetBranch: "main",
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {
        build: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "builder",
        },
      },
    });

    try {
      const selection = await loadRepoDefaultModel("/tmp/repo", "build");
      expect(selection).toEqual({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "builder",
      });
    } finally {
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    }
  });

  test("loads effective prompt overrides by merging global and repository values", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    host.workspaceGetRepoConfig = async () => ({
      defaultRuntimeKind: "opencode" as const,
      branchPrefix: "obp",
      defaultTargetBranch: "main",
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: {
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
      },
      agentDefaults: {},
    });
    host.workspaceGetSettingsSnapshot = async () => ({
      repos: {},
      globalPromptOverrides: {
        "kickoff.spec_initial": {
          template: "global kickoff {{task.id}}",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    try {
      const overrides = await loadRepoPromptOverrides("/tmp/repo");
      expect(overrides["kickoff.spec_initial"]?.template).toBe("global kickoff {{task.id}}");
      expect(overrides["kickoff.spec_initial"]?.baseVersion).toBe(1);
      expect(overrides["kickoff.planner_initial"]?.template).toBe("repo planner {{task.id}}");
    } finally {
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    }
  });

  test("resolves effective overrides deterministically for every prompt template id", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;

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

    host.workspaceGetRepoConfig = async () => ({
      defaultRuntimeKind: "opencode" as const,
      branchPrefix: "obp",
      defaultTargetBranch: "main",
      trustedHooks: false,
      hooks: {
        preStart: [],
        postComplete: [],
      },
      worktreeFileCopies: [],
      promptOverrides: repoPromptOverrides,
      agentDefaults: {},
    });
    host.workspaceGetSettingsSnapshot = async () => ({
      repos: {},
      globalPromptOverrides,
    });

    try {
      const overrides = await loadRepoPromptOverrides("/tmp/repo");
      for (const [index, templateId] of agentPromptTemplateIdValues.entries()) {
        const expectedTemplate = index % 2 === 0 ? `repo ${templateId}` : `global ${templateId}`;
        expect(overrides[templateId]?.template).toBe(expectedTemplate);
      }
    } finally {
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
      host.workspaceGetSettingsSnapshot = originalWorkspaceGetSettingsSnapshot;
    }
  });

  test("uses qa runtime for qa role", async () => {
    const originalRuntimeStart = host.runtimeStart;
    host.runtimeStart = async () => ({
      kind: "opencode",
      runtimeId: "runtime-qa",
      repoPath: "/tmp/repo",
      taskId: "task-1",
      role: "qa",
      port: 4555,
      workingDirectory: "/tmp/repo/qa",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
      lastMessage: null,
    });

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [] },
        refreshTaskData: async () => {},
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "qa");
      expect(runtime).toEqual({
        runtimeKind: "opencode",
        runtimeId: "runtime-qa",
        runId: null,
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4555",
          workingDirectory: "/tmp/repo/qa",
        },
        runtimeEndpoint: "http://127.0.0.1:4555",
        workingDirectory: "/tmp/repo/qa",
      });
    } finally {
      host.runtimeStart = originalRuntimeStart;
    }
  });

  test("uses shared repo runtime for non-build non-qa roles", async () => {
    const originalRepoRuntimeEnsure = host.runtimeEnsure;
    host.runtimeEnsure = async () => ({
      kind: "opencode",
      runtimeId: "runtime-shared",
      repoPath: "/tmp/repo",
      taskId: "task-1",
      role: "planner",
      port: 4666,
      workingDirectory: "/tmp/repo/shared",
      status: "running",
      startedAt: "2026-02-22T08:00:00.000Z",
      lastMessage: null,
    });

    try {
      const ensureRuntime = createEnsureRuntime({
        runsRef: { current: [] },
        refreshTaskData: async () => {},
      });

      const runtime = await ensureRuntime("/tmp/repo", "task-1", "planner");
      expect(runtime).toEqual({
        runtimeKind: "opencode",
        runtimeId: "runtime-shared",
        runId: null,
        runtimeConnection: {
          endpoint: "http://127.0.0.1:4666",
          workingDirectory: "/tmp/repo/shared",
        },
        runtimeEndpoint: "http://127.0.0.1:4666",
        workingDirectory: "/tmp/repo/shared",
      });
    } finally {
      host.runtimeEnsure = originalRepoRuntimeEnsure;
    }
  });

  test("propagates task document loading errors", async () => {
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;

    host.specGet = async () => ({ markdown: "spec", updatedAt: null });
    host.planGet = async () => {
      throw new Error("plan unavailable");
    };
    host.qaGetReport = async () => ({ markdown: "qa", updatedAt: null });

    try {
      await expect(loadTaskDocuments("/tmp/repo", "task-1")).rejects.toThrow("plan unavailable");
    } finally {
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
    }
  });
});
