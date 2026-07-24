import { Effect } from "effect";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createAgentSessionRecord,
  createApprovalSystemCommands,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createDirectMergeTaskWorktreeService,
  createTaskService,
  createTaskServiceWithMutationProgress,
  extendGitPort,
  extendSettingsConfigPort,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService direct merge", () => {
  test("records a published direct merge and moves ai review to human review", async () => {
    const calls: unknown[] = [];
    const humanReviewTask = task({ status: "human_review" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ status: "ai_review" })];
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
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
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
      setDirectMerge(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setDirectMerge", input });
            return true;
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "transition", input });
            return humanReviewTask;
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
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected qa");
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
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        {
          getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "summary", workingDir, targetBranch, diffScope });
                return {
                  currentBranch: { name: "odt/task-1", detached: false },
                  fileStatuses: [],
                  fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                  targetAheadBehind: { ahead: 1, behind: 0 },
                  upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
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
          suggestedSquashCommitMessage(workingDir, sourceBranch, targetBranch) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "suggestedSquash", workingDir, sourceBranch, targetBranch });
                return "Direct merge task";
              },
              catch: (cause) =>
                new HostOperationError({
                  operation: "test.effect",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause: cause,
                }),
            });
          },
          mergeBranch(workingDir, request) {
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "mergeBranch", workingDir, request });
                return { outcome: "merged", output: "merged" };
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
            return Effect.tryPromise({
              try: async () => {
                calls.push({ type: "readConfig" });
                return {
                  ...createDefaultGlobalConfig(),
                  git: { defaultMergeMethod: "merge_commit" },
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
        },
      ),
      systemCommands: createApprovalSystemCommands(),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });
    await expect(
      Effect.runPromise(
        service.directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: { mergeMethod: "merge_commit" },
        }),
      ),
    ).resolves.toMatchObject({
      outcome: "completed",
      task: { id: "task-1", status: "human_review" },
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "readConfig" },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "summary",
        workingDir: "/worktrees/repo/task-1",
        targetBranch: "origin/main",
        diffScope: "uncommitted",
      },
      {
        type: "suggestedSquash",
        workingDir: "/repo",
        sourceBranch: "odt/task-1",
        targetBranch: "origin/main",
      },
      {
        type: "mergeBranch",
        workingDir: "/repo",
        request: {
          sourceBranch: "odt/task-1",
          targetBranch: "origin/main",
          sourceWorkingDirectory: "/worktrees/repo/task-1",
          method: "merge_commit",
        },
      },
      {
        type: "setDirectMerge",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: expect.any(String),
          },
        },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "human_review" },
      },
    ]);
  });
  test("reports failures after recording a direct merge as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.transition-task",
      message: "transition failed",
    });
    let directMergeWritten = false;
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "ai_review" })]),
      getTaskMetadata: () =>
        Effect.succeed({
          spec: { markdown: "# Spec" },
          plan: { markdown: "# Plan" },
          agentSessions: [],
        }),
      setDirectMerge: () =>
        Effect.sync(() => {
          directMergeWritten = true;
          return true;
        }),
      transitionTask: () => Effect.fail(failure),
    };
    const calls: unknown[] = [];
    const service = createTaskServiceWithMutationProgress({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        {
          getWorktreeStatusSummaryData: () =>
            Effect.succeed({
              currentBranch: { name: "odt/task-1", detached: false },
              fileStatuses: [],
              fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
              targetAheadBehind: { ahead: 1, behind: 0 },
              upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
            }),
          suggestedSquashCommitMessage: () => Effect.succeed("Direct merge task"),
          mergeBranch: () => Effect.succeed({ outcome: "merged", output: "merged" }),
        },
      ),
      settingsConfig: extendSettingsConfigPort(
        createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        {
          readConfig: () =>
            Effect.succeed({
              ...createDefaultGlobalConfig(),
              git: { defaultMergeMethod: "merge_commit" },
            }),
        },
      ),
      systemCommands: createApprovalSystemCommands(),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: [] },
      }),
    });

    const result = await Effect.runPromise(
      service
        .directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: { mergeMethod: "merge_commit" },
        })
        .pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(directMergeWritten).toBe(true);
    expect(result.operation).toBe("direct-merge");
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure).toBe(failure);
  });
  test("returns direct merge conflicts without recording metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
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
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
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
      setDirectMerge() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not set direct merge");
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
            throw new Error("should not transition");
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
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set spec");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPlanDocument() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set plan");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      recordQaOutcome() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected qa");
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
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: extendGitPort(
            createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
            }),
            {
              getWorktreeStatusSummaryData() {
                return Effect.tryPromise({
                  try: async () => {
                    return {
                      currentBranch: { name: "odt/task-1", detached: false },
                      fileStatuses: [],
                      fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                      targetAheadBehind: { ahead: 1, behind: 0 },
                      upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
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
              suggestedSquashCommitMessage() {
                return Effect.tryPromise({
                  try: async () => {
                    return undefined;
                  },
                  catch: (cause) =>
                    new HostOperationError({
                      operation: "test.effect",
                      message: cause instanceof Error ? cause.message : String(cause),
                      cause: cause,
                    }),
                });
              },
              mergeBranch() {
                return Effect.tryPromise({
                  try: async () => {
                    return {
                      outcome: "conflicts",
                      conflictedFiles: ["src/main.ts"],
                      output: "conflict",
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
            },
          ),
          settingsConfig: extendSettingsConfigPort(
            createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
            {
              readConfig() {
                return Effect.tryPromise({
                  try: async () => {
                    return {
                      ...createDefaultGlobalConfig(),
                      git: { defaultMergeMethod: "merge_commit" },
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
            },
          ),
          systemCommands: createApprovalSystemCommands(),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: { mergeMethod: "rebase" },
        }),
      ),
    ).resolves.toEqual({
      outcome: "conflicts",
      conflict: {
        operation: "direct_merge_rebase",
        currentBranch: "odt/task-1",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts"],
        output: "conflict",
        workingDir: "/worktrees/repo/task-1",
      },
    });
  });
  test("completes a published direct merge after sync and cleans builder state", async () => {
    const calls: unknown[] = [];
    const closedTask = task({ status: "closed" });
    const buildSession = createAgentSessionRecord({
      externalSessionId: "session-1",
      role: "build",
      startedAt: "2026-05-10T10:00:00.000Z",
      workingDirectory: "/worktrees/repo/task-1",
    });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
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
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              directMerge: {
                method: "merge_commit",
                sourceBranch: "odt/task-1",
                targetBranch: { remote: "origin", branch: "main" },
                mergedAt: "2026-05-10T11:00:00.000Z",
              },
              agentSessions: [buildSession],
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
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "transition", input });
            return closedTask;
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
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
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
    const service = createTaskService({
      devServerService: createDirectMergeDevServerService(calls),
      gitPort: createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/repo": { name: "main", detached: false },
          "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
        },
        branches: {
          "/repo": [
            { name: "main", isCurrent: true, isRemote: false },
            { name: "odt/task-1", isCurrent: false, isRemote: false },
          ],
        },
        aheadBehind: { "/repo|origin/main": { ahead: 0, behind: 0 } },
        ancestorResults: { "/repo|odt/task-1|main": false },
      }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
    });
    await expect(
      Effect.runPromise(service.completeDirectMerge({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/repo" },
      { type: "aheadBehind", workingDir: "/repo", targetBranch: "origin/main" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
      { type: "listBranches", workingDir: "/repo" },
      { type: "isAncestor", workingDir: "/repo", ancestor: "odt/task-1", descendant: "main" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
      },
    ]);
  });
  test("rejects direct merge completion until the publish target is synchronized", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
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
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              directMerge: {
                method: "merge_commit",
                sourceBranch: "odt/task-1",
                targetBranch: { remote: "origin", branch: "main" },
                mergedAt: "2026-05-10T11:00:00.000Z",
              },
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
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not transition");
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
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
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
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: { "/repo": { name: "main", detached: false } },
            aheadBehind: { "/repo|origin/main": { ahead: 1, behind: 0 } },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(
      "Cannot finish the direct merge for task task-1 until origin/main is fully published and synchronized.",
    );
  });
  test("rejects direct merge completion without recorded direct merge metadata", async () => {
    const taskStore: TaskStorePort = {
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
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
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
      transitionTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not transition");
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
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected get");
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
          devServerService: createDirectMergeDevServerService([]),
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("Task task-1 does not have a locally applied direct merge to complete.");
  });
});
