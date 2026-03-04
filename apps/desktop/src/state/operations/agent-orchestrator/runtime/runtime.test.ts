import { describe, expect, test } from "bun:test";
import type { RunSummary } from "@openducktor/contracts";
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
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
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
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
      await expect(runtimePromise).resolves.toEqual({
        runtimeId: null,
        runId: "run-1",
        baseUrl: "http://127.0.0.1:4444",
        workingDirectory: "/tmp/repo/worktree",
      });
    } finally {
      refreshDeferred.resolve();
      host.buildStart = originalBuildStart;
    }
  });

  test("returns null default model when repo config is unavailable", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    host.workspaceGetRepoConfig = async () => {
      throw new Error("missing config");
    };

    try {
      const selection = await loadRepoDefaultModel("/tmp/repo", "build");
      expect(selection).toBeNull();
    } finally {
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    }
  });

  test("maps repo role defaults into model selection", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    host.workspaceGetRepoConfig = async () => ({
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
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          opencodeAgent: "builder",
        },
      },
    });

    try {
      const selection = await loadRepoDefaultModel("/tmp/repo", "build");
      expect(selection).toEqual({
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        opencodeAgent: "builder",
      });
    } finally {
      host.workspaceGetRepoConfig = originalWorkspaceGetRepoConfig;
    }
  });

  test("loads effective prompt overrides by merging global and repository values", async () => {
    const originalWorkspaceGetRepoConfig = host.workspaceGetRepoConfig;
    const originalWorkspaceGetSettingsSnapshot = host.workspaceGetSettingsSnapshot;
    host.workspaceGetRepoConfig = async () => ({
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

  test("uses qa runtime for qa role", async () => {
    const originalOpencodeRuntimeStart = host.opencodeRuntimeStart;
    host.opencodeRuntimeStart = async () => ({
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
        runtimeId: "runtime-qa",
        runId: null,
        baseUrl: "http://127.0.0.1:4555",
        workingDirectory: "/tmp/repo/qa",
      });
    } finally {
      host.opencodeRuntimeStart = originalOpencodeRuntimeStart;
    }
  });

  test("uses shared repo runtime for non-build non-qa roles", async () => {
    const originalRepoRuntimeEnsure = host.opencodeRepoRuntimeEnsure;
    host.opencodeRepoRuntimeEnsure = async () => ({
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
        runtimeId: "runtime-shared",
        runId: null,
        baseUrl: "http://127.0.0.1:4666",
        workingDirectory: "/tmp/repo/shared",
      });
    } finally {
      host.opencodeRepoRuntimeEnsure = originalRepoRuntimeEnsure;
    }
  });

  test("loads task documents and falls back to empty strings on errors", async () => {
    const originalSpecGet = host.specGet;
    const originalPlanGet = host.planGet;
    const originalQaGetReport = host.qaGetReport;

    host.specGet = async () => ({ markdown: "spec", updatedAt: null });
    host.planGet = async () => {
      throw new Error("plan unavailable");
    };
    host.qaGetReport = async () => ({ markdown: "qa", updatedAt: null });

    try {
      const docs = await loadTaskDocuments("/tmp/repo", "task-1");
      expect(docs).toEqual({
        specMarkdown: "spec",
        planMarkdown: "",
        qaMarkdown: "qa",
      });
    } finally {
      host.specGet = originalSpecGet;
      host.planGet = originalPlanGet;
      host.qaGetReport = originalQaGetReport;
    }
  });
});
