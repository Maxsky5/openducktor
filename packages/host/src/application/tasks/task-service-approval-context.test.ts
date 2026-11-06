import { builtinTaskWorkflows, reviewTaskWorkflows } from "../../test-support/task-workflows";
import { Effect } from "effect";
import { createWorkspaceSettingsServiceTestDouble } from "../../test-support/service-test-doubles";
import { repoConfigFixture } from "../../test-support/repo-config-fixture";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import type { GitProviderResolver } from "../git/git-provider-resolver";
import {
  createAgentSessionRecord,
  createApprovalSystemCommands,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  extendGitPort,
  extendSettingsConfigPort,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

const unusedGitProviderResolver: GitProviderResolver = {
  resolve: () => Effect.die("Unexpected Git provider resolution"),
  resolveConfigured: () => Effect.die("Unexpected configured Git provider resolution"),
};

describe("createTaskService approval context", () => {
  test("loads approval context from the active task worktree", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
            return task({
              status: "human_review",
              targetBranch: { remote: "origin", branch: "release" },
            });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
              agentSessions: [],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitProviderResolver: unusedGitProviderResolver,
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        {
          listRemotes(workingDir) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "listRemotes", workingDir });
                return [{ name: "origin", url: "git@github.com:openai/openducktor.git" }];
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
          getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
            return Effect.sync(() => {
              calls.push({ type: "summary", workingDir, targetBranch, diffScope });
              return {
                currentBranch: { name: "odt/task-1", detached: false },
                fileStatuses: [
                  { path: "src/main.ts", status: "modified", staged: false },
                  { path: "src/app.ts", status: "added", staged: true },
                ],
                fileStatusCounts: { total: 2, staged: 1, unstaged: 1 },
                targetAheadBehind: { ahead: 3, behind: 0 },
                upstreamAheadBehind: { outcome: "untracked", ahead: 3 },
              };
            });
          },
          suggestedSquashCommitMessage(workingDir, sourceBranch, targetBranch) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "suggestedSquash", workingDir, sourceBranch, targetBranch });
                return "Ship task approval context";
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
        },
      ),
      settingsConfig: extendSettingsConfigPort(
        createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        {
          readConfig() {
            return Effect.sync(() => {
              return {
                ...createDefaultGlobalConfig(),
                git: { defaultMergeMethod: "squash", removeWorktreeOnClose: true },
              };
            });
          },
        },
      ),
      systemCommands: createApprovalSystemCommands(),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { beforeWorktreeRemoval: [] },
        git: {
          provider: {
            id: "github",
            enabled: true,
            repository: { host: "github.com", owner: "openai", name: "openducktor" },
            autoDetected: false,
          },
        },
      }),
    });
    const result = await Effect.runPromise(
      service.getApprovalContext({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
    );
    expect(result).toEqual({
      outcome: "ready",
      approvalContext: {
        taskId: "task-1",
        taskStatus: "human_review",
        workingDirectory: "/worktrees/repo/task-1",
        sourceBranch: "odt/task-1",
        targetBranch: { remote: "origin", branch: "release" },
        publishTarget: { remote: "origin", branch: "release" },
        defaultMergeMethod: "squash",
        hasUncommittedChanges: true,
        uncommittedFileCount: 2,
        suggestedSquashCommitMessage: "Ship task approval context",
      },
    });
    if (result.outcome !== "ready") throw new Error("Expected ready approval context");
    expect(Object.hasOwn(result.approvalContext, "pullRequest")).toBe(false);
    expect(calls).toContainEqual({
      type: "summary",
      workingDir: "/worktrees/repo/task-1",
      targetBranch: "origin/release",
      diffScope: "uncommitted",
    });
    expect(calls).toContainEqual({
      type: "suggestedSquash",
      workingDir: "/repo",
      sourceBranch: "odt/task-1",
      targetBranch: "origin/release",
    });
  });
  test("loads approval context from recorded direct merge metadata", async () => {
    const calls: unknown[] = [];
    const directMerge = {
      method: "merge_commit" as const,
      sourceBranch: "odt/task-1",
      targetBranch: { branch: "main" },
      mergedAt: "2026-05-10T11:00:00.000Z",
    };
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "human_review" });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
              directMerge,
              agentSessions: [
                createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
              ],
            };
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ status: "human_review" })];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected create");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      updateTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected update");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected transition");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitProviderResolver: unusedGitProviderResolver,
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          systemCommands: createApprovalSystemCommands(),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { beforeWorktreeRemoval: [] },
          }),
        }).getApprovalContext({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({
      outcome: "ready",
      approvalContext: {
        sourceBranch: "odt/task-1",
        targetBranch: { branch: "main" },
        publishTarget: undefined,
        hasUncommittedChanges: false,
        uncommittedFileCount: 0,
        directMerge,
        defaultMergeMethod: "merge_commit",
      },
    });
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "suggestedSquash" }));
  });
});

describe("approval preparation", () => {
  test.each([
    ["getApprovalContext", "workflow", "task", "open"],
    ["getApprovalContext", "repo", "repo", "human_review"],
    ["getApprovalContext", "default", "default", "human_review"],
    ["getApprovalContext", "missing", "worktree", "ai_review"],
    ["getApprovalContext", "missing", "worktree", "human_review"],
    ["getApprovalContext", "branch", "branch", "human_review"],
    ["getApprovalContext", "detached", "branch", "human_review"],
    ["getApprovalContext", "unnamed", "branch", "human_review"],
    ["getApprovalContext", "targetError", "branch", "human_review"],
    ["getApprovalContext", "target", "target", "human_review"],
    ["getApprovalContext", "status", "status", "human_review"],
    ["getApprovalContext", "message", "message", "human_review"],
    ["upsertPullRequest", "workflow", "metadata", "open"],
    ["upsertPullRequest", "repo", "repo", "human_review"],
    ["upsertPullRequest", "default", "default", "human_review"],
    ["upsertPullRequest", "missing", "worktree", "human_review"],
    ["upsertPullRequest", "detached", "branch", "human_review"],
    ["upsertPullRequest", "message", "message", "human_review"],
  ] as const)("%s handles %s at %s from %s", async (entryPoint, scenario, lastRead, taskStatus) => {
    const calls: string[] = [];
    const failure = new HostOperationError({
      operation: scenario,
      message: `${scenario} failed`,
    });
    const read = <T>(stage: string, value: T) =>
      Effect.gen(function* () {
        calls.push(stage);
        if (scenario === stage) return yield* failure;
        return value;
      });
    const repoConfig = repoConfigFixture();
    let repoReads = 0;
    const service = createTaskService({
      gitProviderResolver: unusedGitProviderResolver,
      taskStore: {
        getTask: () =>
          read("task", {
            ...task({ status: taskStatus }),
            targetBranchError: ["detached", "unnamed", "targetError"].includes(scenario)
              ? "Repair the target branch."
              : undefined,
          }),
        getTaskMetadata: () => read("metadata", { artifacts: {}, agentSessions: [] }),
      },
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfig: () => {
          repoReads += 1;
          return read(repoReads === 1 ? "repo" : "target", repoConfig);
        },
      }),
      settingsConfig: extendSettingsConfigPort(createBuildSettingsConfig(new Set(["/repo"])), {
        readConfig: () => read("default", createDefaultGlobalConfig()),
      }),
      taskWorktreeService: {
        getTaskWorktree: () =>
          read(
            "worktree",
            scenario === "missing" ? null : { workingDirectory: "/worktrees/repo/task-1" },
          ),
      },
      gitPort: extendGitPort(createDirectMergeGitPort({ calls: [] }), {
        getCurrentBranch: () =>
          read("branch", {
            name: scenario === "unnamed" ? "  " : "odt/task-1",
            detached: scenario === "detached",
          }),
        getWorktreeStatusSummaryData: () =>
          read("status", {
            currentBranch: { name: "odt/task-1", detached: false },
            fileStatuses: [],
            fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked" as const, ahead: 1 },
          }),
        suggestedSquashCommitMessage: () => read("message", undefined),
      }),
    });
    const input = { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" };
    const run = <A, E>(operation: Effect.Effect<A, E>) => {
      expect(calls).toEqual([]);
      return Effect.runPromise(Effect.result(operation));
    };
    const result = await (entryPoint === "getApprovalContext"
      ? run(service.getApprovalContext(input))
      : run(service.upsertPullRequest({ ...input, content: { title: "Task", body: "Body" } })));
    const reads = [
      "task",
      "repo",
      "metadata",
      "default",
      "worktree",
      "branch",
      "target",
      "status",
      "message",
    ];
    expect(calls).toEqual(reads.slice(0, reads.indexOf(lastRead) + 1));
    if (scenario === "missing" && entryPoint === "getApprovalContext") {
      if (result._tag !== "Success") throw new Error("Expected missing-worktree result");
      expect(result.success).toEqual({
        outcome: "missing_worktree",
        taskId: "task-1",
        taskStatus,
      });
      return;
    }
    if (result._tag !== "Failure") throw new Error("Expected approval preparation failure");
    if (["repo", "default", "branch", "target", "status", "message"].includes(scenario)) {
      expect(result.failure).toBe(failure);
    } else if (scenario === "workflow") {
      expect(result.failure).toMatchObject({
        _tag: "HostValidationError",
        message: "Human approval is only allowed from ai_review or human_review.",
      });
    } else if (scenario === "missing") {
      expect(result.failure).toMatchObject({
        _tag: "HostValidationError",
        field: "taskId",
        message:
          "Human approval requires a task worktree for task task-1. Start a Builder or QA session first.",
        details: { repoPath: "/repo", taskId: "task-1" },
      });
    } else if (scenario === "targetError") {
      expect(result.failure).toMatchObject({
        _tag: "HostValidationError",
        field: "targetBranch",
        message: "Repair the target branch.",
        details: { repoPath: "/repo", taskId: "task-1" },
      });
    } else {
      const branchError =
        scenario === "detached"
          ? "Human approval requires a task branch, but the task worktree is detached."
          : "Human approval requires a task branch name.";
      expect(result.failure).toMatchObject({
        _tag: "HostValidationError",
        field: "workingDirectory",
        message: branchError,
        details: { workingDirectory: "/worktrees/repo/task-1" },
      });
    }
  });
});

test.each([
  ["built-in", builtinTaskWorkflows, "human_review", "task", task().artifactSummary],
  [
    "review",
    reviewTaskWorkflows,
    "approval",
    "feature",
    { draft: { present: true }, review: { present: true } },
  ],
] as const)(
  "approval context rereads the target and keeps the publication snapshot (%s)",
  async (_label, taskWorkflows, status, issueType, artifactSummary) => {
    const calls: unknown[] = [];
    const repoConfig = repoConfigFixture();
    let repoReads = 0;
    const service = createTaskService({
      taskWorkflows,
      gitProviderResolver: unusedGitProviderResolver,
      taskStore: {
        getTask: () => Effect.succeed(task({ status, issueType, artifactSummary })),
        getTaskMetadata: () => Effect.succeed({ artifacts: {}, agentSessions: [] }),
      },
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      workspaceSettingsService: createWorkspaceSettingsServiceTestDouble({
        getRepoConfig: (workspaceId) =>
          Effect.sync(() => {
            calls.push({ type: "repo", workspaceId });
            repoReads += 1;
            return repoReads === 1
              ? repoConfig
              : {
                  ...repoConfig,
                  defaultTargetBranch: { remote: " upstream ", branch: " release " },
                };
          }),
      }),
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: { "/worktrees/repo/task-1": { name: " odt/task-1 ", detached: false } },
        }),
        {
          getWorktreeStatusSummaryData: (workingDirectory, targetBranch, diffScope) =>
            Effect.sync(() => {
              calls.push({ type: "status", workingDirectory, targetBranch, diffScope });
              return {
                currentBranch: { name: "odt/task-1", detached: false },
                fileStatuses: [],
                fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                targetAheadBehind: { ahead: 1, behind: 0 },
                upstreamAheadBehind: { outcome: "untracked" as const, ahead: 1 },
              };
            }),
          suggestedSquashCommitMessage: (repoPath, sourceBranch, targetBranch) =>
            Effect.sync(() => {
              calls.push({ type: "message", repoPath, sourceBranch, targetBranch });
              return undefined;
            }),
        },
      ),
    });
    const result = await Effect.runPromise(
      service.getApprovalContext({
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
      }),
    );
    expect(result).toMatchObject({
      outcome: "ready",
      approvalContext: {
        sourceBranch: "odt/task-1",
        targetBranch: { remote: "upstream", branch: "release" },
        publishTarget: { remote: "origin", branch: "main" },
        hasUncommittedChanges: false,
        uncommittedFileCount: 0,
      },
    });
    if (result.outcome !== "ready") throw new Error("Expected ready approval context");
    expect(Object.hasOwn(result.approvalContext, "pullRequest")).toBe(false);
    expect(Object.hasOwn(result.approvalContext, "suggestedSquashCommitMessage")).toBe(false);
    expect(calls).toEqual([
      { type: "repo", workspaceId: "repo" },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "repo", workspaceId: "repo" },
      {
        type: "status",
        workingDirectory: "/worktrees/repo/task-1",
        targetBranch: "upstream/release",
        diffScope: "uncommitted",
      },
      {
        type: "message",
        repoPath: "/repo",
        sourceBranch: "odt/task-1",
        targetBranch: "upstream/release",
      },
    ]);
  },
);
