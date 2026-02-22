import { describe, expect, test } from "bun:test";
import {
  agentRuntimeSummarySchema,
  agentSessionRecordSchema,
  gitBranchSchema,
  gitCurrentBranchSchema,
  gitPushSummarySchema,
  gitWorktreeSummarySchema,
  repoConfigSchema,
  runEventSchema,
  taskCardSchema,
} from "./index";

describe("runtime schemas", () => {
  test("task card parses workflow status from host payloads", () => {
    const parsed = taskCardSchema.parse({
      id: "task-1",
      title: "Sample",
      description: "",
      status: "spec_ready",
      priority: 2,
      issueType: "task",
      labels: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.status).toBe("spec_ready");
    expect(parsed.aiReviewEnabled).toBe(true);
    expect(parsed.availableActions).toEqual([]);
    expect(parsed.notes).toBe("");
    expect(parsed.documentSummary.spec.has).toBe(false);
    expect(parsed.documentSummary.plan.has).toBe(false);
    expect(parsed.documentSummary.qaReport.has).toBe(false);
  });

  test("task card coerces unsupported issue types to task", () => {
    const parsed = taskCardSchema.parse({
      id: "task-2",
      title: "Legacy type",
      description: "",
      status: "open",
      priority: 2,
      issueType: "decision",
      labels: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.issueType).toBe("task");
  });

  test("task card parses document summary flags and updated timestamps", () => {
    const parsed = taskCardSchema.parse({
      id: "task-3",
      title: "Docs",
      status: "open",
      priority: 2,
      issueType: "task",
      labels: [],
      documentSummary: {
        spec: { has: true, updatedAt: "2026-02-20T12:00:00.000Z" },
        plan: { has: false, updatedAt: null },
        qaReport: { has: true, updatedAt: "2026-02-20T13:00:00.000Z" },
      },
      updatedAt: "2026-02-20T13:00:00.000Z",
      createdAt: "2026-02-20T12:00:00.000Z",
    });

    expect(parsed.documentSummary.spec.has).toBe(true);
    expect(parsed.documentSummary.spec.updatedAt).toBe("2026-02-20T12:00:00.000Z");
    expect(parsed.documentSummary.plan.updatedAt).toBeUndefined();
    expect(parsed.documentSummary.qaReport.has).toBe(true);
  });

  test("permission_required event accepts null command", () => {
    const parsed = runEventSchema.parse({
      type: "permission_required",
      runId: "run-1",
      message: "permission prompt",
      command: null,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.type).toBe("permission_required");
    expect(parsed.command).toBeUndefined();
  });

  test("repo config accepts null worktree base path", () => {
    const parsed = repoConfigSchema.parse({
      worktreeBasePath: null,
      branchPrefix: "obp",
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
    });

    expect(parsed.worktreeBasePath).toBeUndefined();
    expect(parsed.agentDefaults).toEqual({
      spec: undefined,
      planner: undefined,
      build: undefined,
      qa: undefined,
    });
  });

  test("repo config parses agent defaults", () => {
    const parsed = repoConfigSchema.parse({
      worktreeBasePath: "/tmp/wt",
      branchPrefix: "obp",
      trustedHooks: true,
      hooks: { preStart: [], postComplete: [] },
      agentDefaults: {
        spec: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          opencodeAgent: "build",
        },
      },
    });

    expect(parsed.agentDefaults.spec?.providerId).toBe("openai");
    expect(parsed.agentDefaults.spec?.modelId).toBe("gpt-5");
    expect(parsed.agentDefaults.spec?.variant).toBe("high");
    expect(parsed.agentDefaults.spec?.opencodeAgent).toBe("build");
  });

  test("git schemas parse branch and current branch payloads", () => {
    const branch = gitBranchSchema.parse({
      name: "main",
      isCurrent: true,
      isRemote: false,
    });
    const current = gitCurrentBranchSchema.parse({
      name: null,
      detached: true,
    });

    expect(branch.name).toBe("main");
    expect(branch.isCurrent).toBe(true);
    expect(current.name).toBeUndefined();
    expect(current.detached).toBe(true);
  });

  test("git schemas parse worktree and push payloads", () => {
    const worktree = gitWorktreeSummarySchema.parse({
      branch: "feature/task-1",
      worktreePath: "/tmp/worktrees/task-1",
    });
    const push = gitPushSummarySchema.parse({
      remote: "origin",
      branch: "feature/task-1",
      output: "Everything up-to-date",
    });

    expect(worktree.branch).toBe("feature/task-1");
    expect(push.remote).toBe("origin");
  });

  test("agent runtime summary parses host payload", () => {
    const parsed = agentRuntimeSummarySchema.parse({
      runtimeId: "runtime-1",
      repoPath: "/repo",
      taskId: "task-1",
      role: "planner",
      workingDirectory: "/repo",
      port: 4100,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.runtimeId).toBe("runtime-1");
    expect(parsed.port).toBe(4100);
  });

  test("agent session record parses persisted history payload", () => {
    const parsed = agentSessionRecordSchema.parse({
      sessionId: "obp-session-1",
      externalSessionId: "session-opencode-1",
      taskId: "task-1",
      role: "spec",
      scenario: "spec_initial",
      status: "idle",
      startedAt: "2026-02-18T17:11:00.000Z",
      updatedAt: "2026-02-18T17:14:00.000Z",
      endedAt: null,
      runtimeId: "runtime-1",
      runId: null,
      baseUrl: "http://127.0.0.1:4173",
      workingDirectory: "/repo",
      selectedModel: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        opencodeAgent: "architect",
      },
    });

    expect(parsed.role).toBe("spec");
    expect(parsed.scenario).toBe("spec_initial");
    expect(parsed.externalSessionId).toBe("session-opencode-1");
    expect(parsed.selectedModel?.modelId).toBe("gpt-5");
  });
});
