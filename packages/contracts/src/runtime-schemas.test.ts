// @ts-expect-error
import { describe, expect, test } from "bun:test";
import {
  agentSessionPermissionRequestSchema,
  agentSessionRecordSchema,
  agentSessionStopTargetSchema,
  buildContinuationTargetSchema,
  buildContinuationTargetSourceSchema,
  gitBranchSchema,
  gitCommitAllRequestSchema,
  gitCommitAllResultSchema,
  gitCurrentBranchSchema,
  gitDiffScopeSchema,
  gitFetchRemoteRequestSchema,
  gitFetchRemoteResultSchema,
  gitPullBranchRequestSchema,
  gitPullBranchResultSchema,
  gitRebaseBranchRequestSchema,
  gitRebaseBranchResultSchema,
  gitResetWorktreeSelectionRequestSchema,
  gitResetWorktreeSelectionResultSchema,
  gitUpstreamAheadBehindSchema,
  gitWorktreeStatusSchema,
  gitWorktreeStatusSnapshotSchema,
  gitWorktreeStatusSummarySchema,
  gitWorktreeSummarySchema,
  OPENCODE_RUNTIME_DESCRIPTOR,
  repoConfigSchema,
  runEventSchema,
  runSummarySchema,
  runtimeDescriptorSchema,
  runtimeInstanceSummaryRoleSchema,
  runtimeInstanceSummarySchema,
  runtimeTransportSchema,
  slashCommandCatalogSchema,
  taskCardSchema,
} from "./index";

const baseRepoConfigInput = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
};

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
    expect(parsed.targetBranch).toBeUndefined();
    expect(parsed.targetBranchError).toBeUndefined();
    expect(parsed.documentSummary.spec.has).toBe(false);
    expect(parsed.documentSummary.plan.has).toBe(false);
    expect(parsed.documentSummary.qaReport.has).toBe(false);
    expect(parsed.documentSummary.qaReport.verdict).toBe("not_reviewed");
    expect(parsed.agentWorkflows).toEqual({
      spec: { required: false, canSkip: true, available: false, completed: false },
      planner: { required: false, canSkip: true, available: false, completed: false },
      builder: { required: true, canSkip: false, available: false, completed: false },
      qa: { required: false, canSkip: true, available: false, completed: false },
    });
  });

  test("task card rejects unsupported issue types", () => {
    expect(() =>
      taskCardSchema.parse({
        id: "task-2",
        title: "Legacy type",
        description: "",
        status: "open",
        priority: 2,
        issueType: "decision",
        labels: [],
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
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
        qaReport: {
          has: true,
          updatedAt: "2026-02-20T13:00:00.000Z",
          verdict: "approved",
        },
      },
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: false },
        builder: { required: true, canSkip: false, available: true, completed: false },
        qa: { required: true, canSkip: false, available: false, completed: false },
      },
      updatedAt: "2026-02-20T13:00:00.000Z",
      createdAt: "2026-02-20T12:00:00.000Z",
    });

    expect(parsed.documentSummary.spec.has).toBe(true);
    expect(parsed.documentSummary.spec.updatedAt).toBe("2026-02-20T12:00:00.000Z");
    expect(parsed.documentSummary.plan.updatedAt).toBeUndefined();
    expect(parsed.documentSummary.qaReport.has).toBe(true);
    expect(parsed.documentSummary.qaReport.verdict).toBe("approved");
    expect(parsed.agentWorkflows.spec.completed).toBe(true);
  });

  test("task card parses persisted task target branches from host payloads", () => {
    const parsed = taskCardSchema.parse({
      id: "task-4",
      title: "Branch override",
      status: "in_progress",
      priority: 2,
      issueType: "task",
      labels: [],
      targetBranch: {
        remote: "origin",
        branch: "release/2026.04",
      },
      updatedAt: "2026-02-20T13:00:00.000Z",
      createdAt: "2026-02-20T12:00:00.000Z",
    });

    expect(parsed.targetBranch).toEqual({
      remote: "origin",
      branch: "release/2026.04",
    });
  });

  test("task card parses invalid task target branch errors from host payloads", () => {
    const parsed = taskCardSchema.parse({
      id: "task-5",
      title: "Broken branch override",
      status: "in_progress",
      priority: 2,
      issueType: "task",
      labels: [],
      targetBranchError:
        "Invalid openducktor.targetBranch metadata: missing field `branch`. Fix the saved task metadata or choose a valid target branch again.",
      updatedAt: "2026-02-20T13:00:00.000Z",
      createdAt: "2026-02-20T12:00:00.000Z",
    });

    expect(parsed.targetBranch).toBeUndefined();
    expect(parsed.targetBranchError).toContain("Invalid openducktor.targetBranch metadata");
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
    expect(
      "command" in parsed ? (parsed as { command?: unknown }).command : undefined,
    ).toBeUndefined();
  });

  test("repo config accepts null worktree base path", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      worktreeBasePath: null,
      branchPrefix: "obp",
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
    });

    expect(parsed.worktreeBasePath).toBeUndefined();
    expect(parsed.promptOverrides).toEqual({});
    expect(parsed.agentDefaults).toEqual({
      spec: undefined,
      planner: undefined,
      build: undefined,
      qa: undefined,
    });
  });

  test("repo config parses agent defaults", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      worktreeBasePath: "/tmp/wt",
      branchPrefix: "obp",
      trustedHooks: true,
      hooks: { preStart: [], postComplete: [] },
      agentDefaults: {
        spec: {
          runtimeKind: "claude-code",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "build",
        },
      },
    });

    expect(parsed.agentDefaults.spec?.providerId).toBe("openai");
    expect(parsed.agentDefaults.spec?.runtimeKind).toBe("claude-code");
    expect(parsed.agentDefaults.spec?.modelId).toBe("gpt-5");
    expect(parsed.agentDefaults.spec?.variant).toBe("high");
    expect(parsed.agentDefaults.spec?.profileId).toBe("build");
  });

  test("repo config parses prompt overrides and keeps base version metadata", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      worktreeBasePath: "/tmp/wt",
      branchPrefix: "obp",
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      promptOverrides: {
        "kickoff.spec_initial": {
          template: "Custom kickoff for {{task.id}}",
          baseVersion: 1,
          enabled: false,
        },
      },
    });

    expect(parsed.promptOverrides["kickoff.spec_initial"]?.template).toBe(
      "Custom kickoff for {{task.id}}",
    );
    expect(parsed.promptOverrides["kickoff.spec_initial"]?.baseVersion).toBe(1);
    expect(parsed.promptOverrides["kickoff.spec_initial"]?.enabled).toBe(false);
  });

  test("repo config allows empty prompt override templates", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      worktreeBasePath: "/tmp/wt",
      branchPrefix: "obp",
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      promptOverrides: {
        "system.shared.workflow_guards": {
          template: "",
          baseVersion: 1,
          enabled: true,
        },
      },
    });

    expect(parsed.promptOverrides["system.shared.workflow_guards"]?.template).toBe("");
    expect(parsed.promptOverrides["system.shared.workflow_guards"]?.enabled).toBe(true);
  });

  test("repo config normalizes null agent default fields and entries", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      worktreeBasePath: "/tmp/wt",
      branchPrefix: "obp",
      trustedHooks: true,
      hooks: { preStart: [], postComplete: [] },
      agentDefaults: {
        spec: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: null,
          profileId: null,
        },
        planner: null,
      },
    });

    expect(parsed.agentDefaults.spec?.variant).toBeUndefined();
    expect(parsed.agentDefaults.spec?.profileId).toBeUndefined();
    expect(parsed.agentDefaults.planner).toBeUndefined();
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

  test("git commit-all request and result payloads parse for success and no-op", () => {
    const commitRequest = gitCommitAllRequestSchema.parse({
      repoPath: "/repo",
      workingDir: null,
      message: "Build all changes",
    });
    const commitCommitted = gitCommitAllResultSchema.parse({
      outcome: "committed",
      commitHash: "abc123",
      output: "1 file changed",
    });
    const commitNoChanges = gitCommitAllResultSchema.parse({
      outcome: "no_changes",
      output: "nothing to commit",
    });

    expect(commitRequest.repoPath).toBe("/repo");
    expect(commitRequest.workingDir).toBeUndefined();
    expect(commitRequest.message).toBe("Build all changes");
    expect(commitCommitted.outcome).toBe("committed");
    expect(commitNoChanges.outcome).toBe("no_changes");
  });

  test("git commit-all result rejects unknown outcome and malformed committed payloads", () => {
    expect(() =>
      gitCommitAllResultSchema.parse({
        outcome: "failed",
        output: "commit failed",
      }),
    ).toThrow();

    expect(() =>
      gitCommitAllResultSchema.parse({
        outcome: "committed",
        output: "did not include hash",
      }),
    ).toThrow();
  });

  test("git rebase branch request and result payloads parse for all outcomes", () => {
    const rebaseRequest = gitRebaseBranchRequestSchema.parse({
      repoPath: "/repo",
      targetBranch: "origin/main",
      workingDir: "/tmp/worktree",
    });
    const rebaseRebased = gitRebaseBranchResultSchema.parse({
      outcome: "rebased",
      output: "rebased",
    });
    const rebaseUpToDate = gitRebaseBranchResultSchema.parse({
      outcome: "up_to_date",
      output: "up to date",
    });
    const rebaseConflicts = gitRebaseBranchResultSchema.parse({
      outcome: "conflicts",
      conflictedFiles: ["src/index.ts", "src/main.ts"],
      output: "failed with conflicts",
    });

    expect(rebaseRequest.targetBranch).toBe("origin/main");
    expect(rebaseRequest.workingDir).toBe("/tmp/worktree");
    expect(rebaseRebased.outcome).toBe("rebased");
    expect(rebaseUpToDate.outcome).toBe("up_to_date");
    expect(rebaseConflicts.outcome).toBe("conflicts");
  });

  test("git rebase branch result rejects unknown and malformed payloads", () => {
    expect(() =>
      gitRebaseBranchResultSchema.parse({
        outcome: "invalid",
        output: "unknown",
      }),
    ).toThrow();

    expect(() =>
      gitRebaseBranchResultSchema.parse({
        outcome: "rebased",
      }),
    ).toThrow();
  });

  test("git rebase branch result rejects conflicts without file list", () => {
    expect(() =>
      gitRebaseBranchResultSchema.parse({
        outcome: "conflicts",
        output: "failed",
      }),
    ).toThrow();
  });

  test("git pull branch request and result payloads parse for all outcomes", () => {
    const pullRequest = gitPullBranchRequestSchema.parse({
      repoPath: "/repo",
      workingDir: null,
    });
    const pullResult = gitPullBranchResultSchema.parse({
      outcome: "pulled",
      output: "updated local branch",
    });
    const upToDateResult = gitPullBranchResultSchema.parse({
      outcome: "up_to_date",
      output: "Already up to date.",
    });
    const conflictsResult = gitPullBranchResultSchema.parse({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "Automatic merge failed; fix conflicts and then commit the result.",
    });

    expect(pullRequest.repoPath).toBe("/repo");
    expect(pullRequest.workingDir).toBeUndefined();
    expect(pullResult.outcome).toBe("pulled");
    expect(upToDateResult.outcome).toBe("up_to_date");
    expect(conflictsResult.outcome).toBe("conflicts");
  });

  test("git fetch remote request and result payloads parse", () => {
    const fetchRequest = gitFetchRemoteRequestSchema.parse({
      repoPath: "/repo",
      targetBranch: "origin/main",
      workingDir: null,
    });
    const fetchResult = gitFetchRemoteResultSchema.parse({
      outcome: "fetched",
      output: "From origin\n * [new branch]      main -> origin/main",
    });
    const skippedResult = gitFetchRemoteResultSchema.parse({
      outcome: "skipped_no_remote",
      output:
        "Skipped git fetch because no applicable remote is configured for this repo or branch.",
    });

    expect(fetchRequest.repoPath).toBe("/repo");
    expect(fetchRequest.workingDir).toBeUndefined();
    expect(fetchResult.outcome).toBe("fetched");
    expect(fetchResult.output).toContain("origin/main");
    expect(skippedResult.outcome).toBe("skipped_no_remote");
  });

  test("git pull branch result rejects unknown and malformed payloads", () => {
    expect(() =>
      gitPullBranchResultSchema.parse({
        outcome: "invalid",
        output: "unknown",
      }),
    ).toThrow();

    expect(() =>
      gitPullBranchResultSchema.parse({
        outcome: "pulled",
      }),
    ).toThrow();

    expect(() =>
      gitPullBranchResultSchema.parse({
        outcome: "conflicts",
        output: "needs files",
      }),
    ).toThrow();

    expect(() =>
      gitFetchRemoteRequestSchema.parse({
        repoPath: "/repo",
        targetBranch: "   ",
      }),
    ).toThrow();

    expect(() =>
      gitFetchRemoteResultSchema.parse({
        outcome: "fetched",
        output: 12,
      }),
    ).toThrow();

    expect(() =>
      gitFetchRemoteResultSchema.parse({
        outcome: "unknown",
        output: "nope",
      }),
    ).toThrow();
  });

  test("git reset worktree selection schemas parse file and hunk requests", () => {
    const fileReset = gitResetWorktreeSelectionRequestSchema.parse({
      repoPath: "/repo",
      workingDir: null,
      targetBranch: "origin/main",
      snapshot: {
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "fedcba9876543210",
      },
      selection: {
        kind: "file",
        filePath: "src/main.ts",
      },
    });
    const hunkReset = gitResetWorktreeSelectionRequestSchema.parse({
      repoPath: "/repo",
      targetBranch: "origin/main",
      snapshot: {
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "fedcba9876543210",
      },
      selection: {
        kind: "hunk",
        filePath: "src/main.ts",
        hunkIndex: 2,
      },
    });
    const result = gitResetWorktreeSelectionResultSchema.parse({
      affectedPaths: ["src/main.ts"],
    });

    expect(fileReset.workingDir).toBeUndefined();
    expect(fileReset.selection.kind).toBe("file");
    expect(hunkReset.selection.kind).toBe("hunk");
    expect(result.affectedPaths).toEqual(["src/main.ts"]);
  });

  test("git reset worktree selection schemas reject malformed snapshot and selection payloads", () => {
    expect(() =>
      gitResetWorktreeSelectionRequestSchema.parse({
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 0,
          statusHash: "0123456789abcdef",
          diffHash: "fedcba9876543210",
        },
        selection: {
          kind: "file",
          filePath: "src/main.ts",
          hunkIndex: 1,
        },
      }),
    ).toThrow();

    expect(() =>
      gitResetWorktreeSelectionRequestSchema.parse({
        repoPath: "/repo",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 1,
          statusHash: "stale",
          diffHash: "fedcba9876543210",
        },
        selection: {
          kind: "hunk",
          filePath: "src/main.ts",
          hunkIndex: -1,
        },
      }),
    ).toThrow();

    expect(() => gitResetWorktreeSelectionResultSchema.parse({ affectedPaths: [] })).toThrow();
  });

  test("git schemas parse worktree payloads", () => {
    const worktree = gitWorktreeSummarySchema.parse({
      branch: "feature/task-1",
      worktreePath: "/tmp/worktrees/task-1",
    });

    expect(worktree.branch).toBe("feature/task-1");
  });

  test("git worktree status schema parses consolidated snapshot payload", () => {
    const scope = gitDiffScopeSchema.parse("target");
    const upstream = gitUpstreamAheadBehindSchema.parse({
      outcome: "tracking",
      ahead: 2,
      behind: 0,
    });
    const snapshot = gitWorktreeStatusSnapshotSchema.parse({
      effectiveWorkingDir: "/repo",
      targetBranch: "origin/main",
      diffScope: scope,
      observedAtMs: 1731000000000,
      hashVersion: 1,
      statusHash: "0123456789abcdef",
      diffHash: "fedcba9876543210",
    });
    const status = gitWorktreeStatusSchema.parse({
      currentBranch: { name: "feature/task-1", detached: false },
      fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
      fileDiffs: [
        {
          file: "src/main.ts",
          type: "modified",
          additions: 2,
          deletions: 1,
          diff: "@@ -1 +1 @@",
        },
      ],
      targetAheadBehind: { ahead: 1, behind: 3 },
      upstreamAheadBehind: upstream,
      snapshot,
    });

    expect(status.snapshot.diffScope).toBe("target");
    expect(status.upstreamAheadBehind.outcome).toBe("tracking");
    expect(status.targetAheadBehind.behind).toBe(3);
  });

  test("git worktree status summary schema parses lightweight polling payload", () => {
    const summary = gitWorktreeStatusSummarySchema.parse({
      currentBranch: { name: "feature/task-1", detached: false },
      fileStatusCounts: { total: 3, staged: 1, unstaged: 2 },
      targetAheadBehind: { ahead: 1, behind: 3 },
      upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
      snapshot: {
        effectiveWorkingDir: "/repo",
        targetBranch: "origin/main",
        diffScope: "target",
        observedAtMs: 1731000000000,
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "fedcba9876543210",
      },
    });

    expect(summary.fileStatusCounts.total).toBe(3);
    expect(summary.fileStatusCounts.staged).toBe(1);
    expect(summary.fileStatusCounts.unstaged).toBe(2);
    expect(summary.snapshot.diffScope).toBe("target");
  });

  test("git worktree status snapshot schema rejects malformed hash metadata", () => {
    expect(() =>
      gitWorktreeStatusSnapshotSchema.parse({
        effectiveWorkingDir: "/repo",
        targetBranch: "origin/main",
        diffScope: "target",
        observedAtMs: 1731000000000,
        hashVersion: 1,
        statusHash: "status-hash",
        diffHash: "fedcba9876543210",
      }),
    ).toThrow();

    expect(() =>
      gitWorktreeStatusSnapshotSchema.parse({
        effectiveWorkingDir: "/repo",
        targetBranch: "origin/main",
        diffScope: "target",
        observedAtMs: 1731000000000,
        hashVersion: 1,
        statusHash: "0123456789abcdef",
        diffHash: "xyz",
      }),
    ).toThrow();
  });

  test("git upstream schema parses untracked outcome", () => {
    const upstream = gitUpstreamAheadBehindSchema.parse({
      outcome: "untracked",
      ahead: 4,
    });

    expect(upstream.outcome).toBe("untracked");
    if (upstream.outcome === "untracked") {
      expect(upstream.ahead).toBe(4);
    }
  });

  test("agent runtime summary parses host payload", () => {
    const parsed = runtimeInstanceSummarySchema.parse({
      kind: "opencode",
      runtimeId: "runtime-1",
      repoPath: "/repo",
      taskId: null,
      role: "workspace",
      workingDirectory: "/repo",
      runtimeRoute: {
        type: "local_http",
        endpoint: "http://127.0.0.1:4100",
      },
      startedAt: "2026-01-01T00:00:00.000Z",
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
    });

    expect(parsed.runtimeId).toBe("runtime-1");
    expect(parsed.runtimeRoute).toEqual({
      type: "local_http",
      endpoint: "http://127.0.0.1:4100",
    });
    expect(parsed.descriptor.capabilities.supportsSlashCommands).toBe(true);
    expect(parsed.descriptor.capabilities.supportsFileSearch).toBe(true);
    expect(parsed.descriptor.readOnlyRoleBlockedTools).toContain("apply_patch");
    expect(parsed.descriptor.readOnlyRoleBlockedTools).not.toContain("bash");
    expect(parsed.descriptor.workflowToolAliasesByCanonical.odt_set_spec).toEqual([
      "openducktor_odt_set_spec",
      "functions.openducktor_odt_set_spec",
    ]);
  });

  test("runtime descriptor rejects workflow alias collisions across canonical tools", () => {
    expect(() =>
      runtimeDescriptorSchema.parse({
        ...OPENCODE_RUNTIME_DESCRIPTOR,
        workflowToolAliasesByCanonical: {
          ...OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
          odt_set_spec: ["openducktor_odt_set_spec"],
          odt_set_plan: ["openducktor_odt_set_spec"],
        },
      }),
    ).toThrow('assigned to canonical tool \\"odt_set_spec\\"');
  });

  test("runtime descriptor rejects canonical odt tool ids inside workflow alias metadata", () => {
    expect(() =>
      runtimeDescriptorSchema.parse({
        ...OPENCODE_RUNTIME_DESCRIPTOR,
        workflowToolAliasesByCanonical: {
          ...OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
          odt_set_spec: ["odt_set_spec"],
        },
      }),
    ).toThrow("Runtime workflow aliases must not repeat canonical odt_* tool IDs.");
  });

  test("runtime descriptor reports only the canonical-id validation issue for repeated canonical aliases", () => {
    const result = runtimeDescriptorSchema.safeParse({
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      workflowToolAliasesByCanonical: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
        odt_set_spec: ["odt_set_spec"],
        odt_set_plan: ["odt_set_spec"],
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues).toHaveLength(2);
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["workflowToolAliasesByCanonical", "odt_set_spec", 0],
          message: "Runtime workflow aliases must not repeat canonical odt_* tool IDs.",
        }),
        expect.objectContaining({
          path: ["workflowToolAliasesByCanonical", "odt_set_plan", 0],
          message: "Runtime workflow aliases must not repeat canonical odt_* tool IDs.",
        }),
      ]),
    );
  });

  test("runtime descriptor rejects unknown workflow alias keys", () => {
    const result = runtimeDescriptorSchema.safeParse({
      ...OPENCODE_RUNTIME_DESCRIPTOR,
      workflowToolAliasesByCanonical: {
        ...OPENCODE_RUNTIME_DESCRIPTOR.workflowToolAliasesByCanonical,
        odt_set_specc: ["openducktor_odt_set_spec"],
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unrecognized_keys",
          keys: ["odt_set_specc"],
          path: ["workflowToolAliasesByCanonical"],
        }),
      ]),
    );
  });

  test("runtime route and connection schemas accept stdio transports", () => {
    expect(
      runtimeInstanceSummarySchema.parse({
        kind: "opencode",
        runtimeId: "runtime-stdio",
        repoPath: "/repo",
        taskId: null,
        role: "workspace",
        workingDirectory: "/repo",
        runtimeRoute: {
          type: "stdio",
        },
        startedAt: "2026-01-01T00:00:00.000Z",
        descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      }).runtimeRoute,
    ).toEqual({ type: "stdio" });

    expect(
      runtimeTransportSchema.parse({
        type: "stdio",
        workingDirectory: "/repo",
      }),
    ).toEqual({
      type: "stdio",
      workingDirectory: "/repo",
    });
  });

  test("runtime connection schema rejects malformed stdio payloads", () => {
    expect(() =>
      runtimeTransportSchema.parse({
        type: "stdio",
        endpoint: "http://127.0.0.1:4444",
        workingDirectory: "/repo",
      }),
    ).toThrow();
  });

  test("run summary accepts missing generic port semantics", () => {
    const parsed = runSummarySchema.parse({
      runId: "run-1",
      runtimeKind: "opencode",
      runtimeRoute: {
        type: "stdio",
      },
      repoPath: "/repo",
      taskId: "task-1",
      branch: "feature/runtime-route",
      worktreePath: "/repo/.worktrees/task-1",
      state: "running",
      lastMessage: null,
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(parsed.port).toBeUndefined();
    expect(parsed.runtimeRoute).toEqual({ type: "stdio" });
  });

  test("slash command catalog parses runtime command metadata", () => {
    const parsed = slashCommandCatalogSchema.parse({
      commands: [
        {
          id: "review",
          trigger: "review",
          title: "review",
          description: "Review changes",
          source: "command",
          hints: ["$ARGUMENTS"],
        },
      ],
    });

    expect(parsed.commands).toEqual([
      {
        id: "review",
        trigger: "review",
        title: "review",
        description: "Review changes",
        source: "command",
        hints: ["$ARGUMENTS"],
      },
    ]);
  });

  test("slash command catalog rejects malformed triggers", () => {
    expect(() =>
      slashCommandCatalogSchema.parse({
        commands: [
          {
            id: "review",
            trigger: "/review now",
            title: "review",
            hints: [],
          },
        ],
      }),
    ).toThrow("Trigger must be a single token without a leading slash");
  });

  test("slash command catalog rejects duplicate ids and triggers", () => {
    expect(() =>
      slashCommandCatalogSchema.parse({
        commands: [
          {
            id: "review",
            trigger: "review",
            title: "review",
            hints: [],
          },
          {
            id: "review",
            trigger: "review",
            title: "review again",
            hints: [],
          },
        ],
      }),
    ).toThrow("Duplicate slash command id: review");
  });

  test("agent runtime role and buildContinuationTarget schemas enforce boundaries", () => {
    expect(runtimeInstanceSummaryRoleSchema.parse("workspace")).toBe("workspace");
    expect(() => runtimeInstanceSummaryRoleSchema.parse("planner")).toThrow();
    expect(buildContinuationTargetSourceSchema.parse("active_build_run")).toBe("active_build_run");
    expect(
      buildContinuationTargetSchema.parse({
        workingDirectory: "/repo/worktrees/task-1",
        source: "builder_session",
      }),
    ).toEqual({
      workingDirectory: "/repo/worktrees/task-1",
      source: "builder_session",
    });
    expect(() =>
      buildContinuationTargetSchema.parse({
        workingDirectory: "   ",
        source: "active_build_run",
      }),
    ).toThrow();
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
      runtimeKind: "opencode",
      runId: null,
      workingDirectory: "/repo",
      selectedModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "architect",
      },
    });

    expect(parsed.role).toBe("spec");
    expect(parsed.scenario).toBe("spec_initial");
    expect(parsed.externalSessionId).toBe("session-opencode-1");
    expect(parsed.runtimeKind).toBe("opencode");
    expect(parsed.selectedModel?.modelId).toBe("gpt-5");
  });

  test("agent session record parses compact persisted payload with explicit runtime kind", () => {
    const parsed = agentSessionRecordSchema.parse({
      sessionId: "obp-session-2",
      role: "planner",
      scenario: "planner_initial",
      startedAt: "2026-02-18T17:11:00.000Z",
      runtimeKind: "claude-code",
      workingDirectory: "/repo",
    });

    expect(parsed.role).toBe("planner");
    expect(parsed.scenario).toBe("planner_initial");
    expect(parsed.externalSessionId).toBeUndefined();
    expect(parsed.runtimeKind).toBe("claude-code");
    expect(parsed.selectedModel).toBeNull();
  });

  test("agent session stop target parses durable session identity", () => {
    const parsed = agentSessionStopTargetSchema.parse({
      repoPath: "/repo",
      taskId: "task-1",
      sessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/task-1",
      externalSessionId: "external-session-1",
    });

    expect(parsed).toEqual({
      repoPath: "/repo",
      taskId: "task-1",
      sessionId: "session-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/task-1",
      externalSessionId: "external-session-1",
    });
  });

  test("agent session permission request accepts recursive metadata values", () => {
    const parsed = agentSessionPermissionRequestSchema.parse({
      requestId: "perm-1",
      permission: "exec",
      metadata: {
        command: "bun test",
        retryCount: 2,
        approved: false,
        context: {
          cwd: "/repo",
          env: {
            CI: "1",
          },
        },
        targets: ["packages/core", { kind: "file", path: "src/index.ts" }, null],
      },
    });

    expect(parsed.metadata).toEqual({
      command: "bun test",
      retryCount: 2,
      approved: false,
      context: {
        cwd: "/repo",
        env: {
          CI: "1",
        },
      },
      targets: ["packages/core", { kind: "file", path: "src/index.ts" }, null],
    });
    expect(parsed.patterns).toEqual([]);
  });

  test("repo config rejects missing runtime-bearing defaults", () => {
    expect(() =>
      repoConfigSchema.parse({
        workspaceId: "repo",
        workspaceName: "Repo",
        repoPath: "/repo",
        branchPrefix: "obp",
        trustedHooks: false,
        hooks: { preStart: [], postComplete: [] },
      }),
    ).toThrow();

    expect(() =>
      repoConfigSchema.parse({
        ...baseRepoConfigInput,
        branchPrefix: "obp",
        trustedHooks: false,
        hooks: { preStart: [], postComplete: [] },
        agentDefaults: {
          spec: {
            providerId: "openai",
            modelId: "gpt-5",
          },
        },
      }),
    ).toThrow();
  });

  test("agent session record rejects missing runtime metadata", () => {
    expect(() =>
      agentSessionRecordSchema.parse({
        sessionId: "obp-session-3",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-18T17:11:00.000Z",
        workingDirectory: "/repo",
      }),
    ).toThrow();

    expect(() =>
      agentSessionRecordSchema.parse({
        sessionId: "obp-session-4",
        role: "planner",
        scenario: "planner_initial",
        startedAt: "2026-02-18T17:11:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        selectedModel: {
          providerId: "openai",
          modelId: "gpt-5",
        },
      }),
    ).toThrow();
  });
});
