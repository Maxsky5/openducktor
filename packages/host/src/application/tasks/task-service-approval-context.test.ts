import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
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

describe("createTaskService approval context", () => {
  test("loads approval context from the active builder worktree", async () => {
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
            throw new Error("unexpected QA");
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
            return Effect.tryPromise({
              try: async () => {
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
            return Effect.tryPromise({
              try: async () => {
                return { version: 2, git: { defaultMergeMethod: "squash" } };
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
        git: {
          providers: {
            github: {
              enabled: true,
              repository: { host: "github.com", owner: "openai", name: "openducktor" },
              autoDetected: false,
            },
          },
        },
      }),
    });
    await expect(
      Effect.runPromise(service.getApprovalContext({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual({
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
        pullRequest: undefined,
        providers: [{ providerId: "github", enabled: true, available: true }],
        suggestedSquashCommitMessage: "Ship task approval context",
      },
    });
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
  test("reports a missing builder worktree for approval context", async () => {
    const taskStore: TaskStorePort = {
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            return task({ status: "ai_review" });
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
            throw new Error("unexpected QA");
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
    await expect(
      Effect.runPromise(
        createTaskService({
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: extendSettingsConfigPort(createBuildSettingsConfig(new Set(["/repo"])), {
            readConfig() {
              return Effect.tryPromise({
                try: async () => {
                  return null;
                },
                catch: (cause) =>
                  new HostOperationError({
                    operation: "test.effect",
                    message: cause instanceof Error ? cause.message : String(cause),
                    cause: cause,
                  }),
              });
            },
          }),
          systemCommands: createApprovalSystemCommands(),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).getApprovalContext({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({
      outcome: "missing_builder_worktree",
      taskId: "task-1",
      taskStatus: "ai_review",
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
            return task({
              status: "human_review",
              agentSessions: [
                createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
              ],
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
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "# Spec" },
              plan: { markdown: "# Plan" },
              directMerge,
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
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [
              task({
                status: "human_review",
                agentSessions: [
                  createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
                ],
              }),
            ];
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
            throw new Error("unexpected QA");
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
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
          }),
          settingsConfig: extendSettingsConfigPort(
            createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
            {
              readConfig() {
                return Effect.tryPromise({
                  try: async () => {
                    return null;
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
        }).getApprovalContext({ repoPath: "/repo", taskId: "task-1" }),
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
