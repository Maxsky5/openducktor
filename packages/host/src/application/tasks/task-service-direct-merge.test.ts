import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { Effect } from "effect";
import { z } from "zod";
import type { TaskCompletionObservation } from "@openducktor/contracts";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { HostOperationError } from "../../effect/host-errors";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createAgentSessionRecord,
  createApprovalSystemCommands,
  createBuildSettingsConfig,
  createBuildStartWorktreeFiles,
  createBuildWorkspaceSettingsService,
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
  test("requires worktree files before starting a local direct merge", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitPort: createDirectMergeGitPort({ calls }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      systemCommands: createApprovalSystemCommands(),
      taskStore: {} satisfies TaskStorePort,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
        defaultTargetBranch: { branch: "main" },
      }),
    });

    const error = await Effect.runPromise(
      service
        .directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            removeWorktree: true,
            mergeMethod: "merge_commit",
            expected: {
              taskStatus: "ai_review",
              sourceBranch: "odt/task-1",
              targetBranch: { branch: "main" },
            },
          },
        })
        .pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      _tag: "HostDependencyError",
      message: "Worktree file port is required for task_direct_merge.",
    });
    expect(calls).toEqual([]);
  });
  test("rejects a repeated direct merge before Git work or task writes", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitPort: createDirectMergeGitPort({ calls }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskStore: {
        listTasks: () => Effect.succeed([task({ status: "human_review" })]),
        getTaskMetadata: () =>
          Effect.succeed({
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
            directMerge: {
              method: "merge_commit",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
              mergedAt: "2026-05-10T00:00:00.000Z",
            },
          }),
        setDirectMerge: () => Effect.die("must not replace the recorded merge"),
        transitionTask: () => Effect.die("must not change task status"),
      },
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      worktreeFiles: createBuildStartWorktreeFiles(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });
    const result = await Effect.runPromise(
      Effect.result(
        service.directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            removeWorktree: true,
            mergeMethod: "merge_commit",
            expected: {
              taskStatus: "human_review",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
            },
          },
        }),
      ),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "HostValidationError",
        field: "taskId",
        message:
          "A local direct merge is already recorded for task task-1. Finish the direct merge workflow before trying again.",
        details: { repoPath: "/repo", taskId: "task-1" },
      },
    });
    expect(calls).toEqual([]);
  });

  test("records a published direct merge and moves ai review to human review", async () => {
    const calls: unknown[] = [];
    const humanReviewTask = task({ status: "human_review" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.sync(() => {
          calls.push({ type: "list", input });
          return [task({ status: "ai_review" })];
        });
      },
      getTaskMetadata(input) {
        return Effect.sync(() => {
          calls.push({ type: "metadata", input });
          return {
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
          };
        });
      },
      setDirectMerge(input) {
        return Effect.sync(() => {
          calls.push({ type: "setDirectMerge", input });
          return true;
        });
      },
      transitionTask(input) {
        return Effect.sync(() => {
          calls.push({ type: "transition", input });
          return humanReviewTask;
        });
      },
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitProviderResolver: {
        resolve: () => Effect.die(new Error("direct merge must not resolve a Git provider")),
        resolveConfigured: () =>
          Effect.die(new Error("direct merge must not resolve a configured Git provider")),
      },
      gitPort: extendGitPort(
        createDirectMergeGitPort({
          calls,
          currentBranches: {
            "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
          },
        }),
        {
          getWorktreeStatusSummaryData(workingDir, targetBranch, diffScope) {
            return Effect.sync(() => {
              calls.push({ type: "summary", workingDir, targetBranch, diffScope });
              return {
                currentBranch: { name: "odt/task-1", detached: false },
                fileStatuses: [],
                fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                targetAheadBehind: { ahead: 1, behind: 0 },
                upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
              };
            });
          },
          suggestedSquashCommitMessage(workingDir, sourceBranch, targetBranch) {
            return Effect.sync(() => {
              calls.push({ type: "suggestedSquash", workingDir, sourceBranch, targetBranch });
              return "Direct merge task";
            });
          },
          mergeBranch(workingDir, request) {
            return Effect.sync(() => {
              const { onWorkIssued, onApplied, ...content } = request;
              onWorkIssued?.();
              onApplied?.("a".repeat(40));
              calls.push({ type: "mergeBranch", workingDir, request: content });
              return { outcome: "merged", output: "merged" };
            });
          },
        },
      ),
      settingsConfig: extendSettingsConfigPort(
        createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        {
          readConfig() {
            return Effect.sync(() => {
              calls.push({ type: "readConfig" });
              return {
                ...createDefaultGlobalConfig(),
                git: { defaultMergeMethod: "merge_commit", removeWorktreeOnClose: true },
              };
            });
          },
        },
      ),
      taskStore,
      taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
      worktreeFiles: createBuildStartWorktreeFiles(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });
    await expect(
      Effect.runPromise(
        service.directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            removeWorktree: true,
            mergeMethod: "merge_commit",
            expected: {
              taskStatus: "ai_review",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
            },
          },
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
        input: { repoPath: "/repo", taskId: "task-1", status: "human_review", cause: {} },
      },
    ]);
  });
  test.each(["review_task", "publish", "publish_always"])(
    "reports %s failure after recording a direct merge as partial progress",
    async (failedStage) => {
      const failure = new HostOperationError({
        operation:
          failedStage === "review_task" ? "task-store.transition-task" : "completion.publish",
        message: `${failedStage} failed`,
      });
      let directMergeWritten = false;
      let merges = 0;
      const observations: TaskCompletionObservation[] = [];
      const taskStore: TaskStorePort = {
        listTasks: () => Effect.succeed([task({ status: "ai_review" })]),
        getTaskMetadata: () =>
          Effect.succeed({
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
          }),
        setDirectMerge: () =>
          Effect.sync(() => {
            directMergeWritten = true;
            return true;
          }),
        transitionTask: () =>
          failedStage === "review_task"
            ? Effect.fail(failure)
            : Effect.succeed(task({ status: "human_review" })),
      };
      const calls: unknown[] = [];
      const service = createTaskServiceWithMutationProgress({
        taskWorkflows: builtinTaskWorkflows,
        publishCompletion: (observation) =>
          Effect.gen(function* () {
            observations.push(observation);
            if (
              failedStage === "publish_always" ||
              (failedStage === "publish" && observations.length === 1)
            )
              return yield* failure;
          }),
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
            mergeBranch: () =>
              Effect.sync(() => {
                merges += 1;
                return { outcome: "merged", output: "merged" };
              }),
          },
        ),
        settingsConfig: extendSettingsConfigPort(
          createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          {
            readConfig: () =>
              Effect.succeed({
                ...createDefaultGlobalConfig(),
                git: { defaultMergeMethod: "merge_commit", removeWorktreeOnClose: true },
              }),
          },
        ),
        systemCommands: createApprovalSystemCommands(),
        taskStore,
        taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: [] },
        }),
      });

      const result = await Effect.runPromise(
        service
          .directMerge({
            repoPath: "/repo",
            taskId: "task-1",
            input: {
              removeWorktree: true,
              mergeMethod: "merge_commit",
              expected: {
                taskStatus: "ai_review",
                sourceBranch: "odt/task-1",
                targetBranch: { remote: "origin", branch: "main" },
              },
            },
          })
          .pipe(Effect.flip),
      );

      if (!(result instanceof TaskMutationProgressFailure)) {
        throw new Error("Expected a TaskMutationProgressFailure");
      }
      expect(directMergeWritten).toBe(true);
      expect(result.operation).toBe("direct-merge");
      expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
      if (failedStage === "publish_always")
        expect(result.failure.message).toContain("Completion observation could not be published");
      else expect(result.failure).toBe(failure);
      expect(observations.at(-1)?.failure).toMatchObject({
        stage: failedStage === "review_task" ? "review_task" : "publish",
        message: failure.message,
      });
      expect(merges).toBe(1);
    },
  );
  test("returns direct merge conflicts without recording metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.sync(() => {
          calls.push({ type: "list", input });
          return [task({ status: "human_review" })];
        });
      },
      getTaskMetadata(input) {
        return Effect.sync(() => {
          calls.push({ type: "metadata", input });
          return {
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
          };
        });
      },
      setDirectMerge() {
        return Effect.sync(() => {
          throw new Error("should not set direct merge");
        });
      },
      transitionTask() {
        return Effect.sync(() => {
          throw new Error("should not transition");
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitPort: extendGitPort(
            createDirectMergeGitPort({
              calls,
              currentBranches: {
                "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
              },
            }),
            {
              getWorktreeStatusSummaryData() {
                return Effect.sync(() => {
                  return {
                    currentBranch: { name: "odt/task-1", detached: false },
                    fileStatuses: [],
                    fileStatusCounts: { total: 0, staged: 0, unstaged: 0 },
                    targetAheadBehind: { ahead: 1, behind: 0 },
                    upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
                  };
                });
              },
              suggestedSquashCommitMessage() {
                return Effect.sync(() => {
                  return undefined;
                });
              },
              mergeBranch() {
                return Effect.sync(() => {
                  return {
                    outcome: "conflicts",
                    conflictedFiles: ["src/main.ts"],
                    output: "conflict",
                  };
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
                    git: { defaultMergeMethod: "merge_commit", removeWorktreeOnClose: true },
                  };
                });
              },
            },
          ),
          systemCommands: createApprovalSystemCommands(),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService("/worktrees/repo/task-1"),
          worktreeFiles: createBuildStartWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).directMerge({
          repoPath: "/repo",
          taskId: "task-1",
          input: {
            removeWorktree: true,
            mergeMethod: "rebase",
            expected: {
              taskStatus: "human_review",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
            },
          },
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
  test("completes a published direct merge after sync and cleans task state", async () => {
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
        return Effect.sync(() => {
          calls.push({ type: "list", input });
          return [task({ status: "human_review" })];
        });
      },
      getTaskMetadata(input) {
        return Effect.sync(() => {
          calls.push({ type: "metadata", input });
          return {
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            directMerge: {
              method: "merge_commit",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
              mergedAt: "2026-05-10T11:00:00.000Z",
            },
            agentSessions: [buildSession],
          };
        });
      },
      transitionTask(input) {
        return Effect.sync(() => {
          calls.push({ type: "transition", input });
          return closedTask;
        });
      },
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskActivityGuard: {
        countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
        cleanupTaskSessions: (input) =>
          Effect.sync(() => {
            calls.push({
              type: "releaseSessions",
              sessionIds: input.taskSessions.flatMap((entry) =>
                entry.sessions.map((session) => session.externalSessionId),
              ),
            });
            return { stoppedSessionCount: 0 };
          }),
      },
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
      worktreeFiles: createBuildStartWorktreeFiles(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });
    await expect(
      Effect.runPromise(
        service.completeDirectMerge({ repoPath: "/repo", taskId: "task-1", removeWorktree: true }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/repo" },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      // The confirmed close removes the same targets as a manual close.
      { type: "listBranches", workingDir: "/repo" },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "releaseSessions", sessionIds: [buildSession.externalSessionId] },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "closed", cause: {} },
      },
    ]);
  });
  test("removes the worktree on a retry that changes the cleanup choice from keep to remove", async () => {
    const calls: unknown[] = [];
    const closedTask = task({ status: "closed" });
    let transitionAttempts = 0;
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "human_review" })]),
      getTaskMetadata: () =>
        Effect.succeed({
          artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
          directMerge: {
            method: "merge_commit",
            sourceBranch: "odt/task-1",
            targetBranch: { remote: "origin", branch: "main" },
            mergedAt: "2026-05-10T11:00:00.000Z",
          },
          agentSessions: [],
        }),
      transitionTask: () => {
        transitionAttempts += 1;
        return transitionAttempts === 1
          ? Effect.fail(
              new HostOperationError({
                operation: "task-store.transition-task",
                message: "The task store is busy.",
              }),
            )
          : Effect.succeed(closedTask);
      },
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskActivityGuard: {
        countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
        cleanupTaskSessions: () => Effect.die(new Error("unexpected session cleanup")),
      },
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
      worktreeFiles: createBuildStartWorktreeFiles(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });
    const input = { repoPath: "/repo", taskId: "task-1" };
    const removeWorktreeCallSchema = z.object({ type: z.literal("removeWorktree") }).passthrough();
    const removals = () => calls.filter((call) => removeWorktreeCallSchema.safeParse(call).success);

    const kept = await Effect.runPromise(
      Effect.result(service.completeDirectMerge({ ...input, removeWorktree: false })),
    );
    expect(kept._tag).toBe("Failure");
    expect(removals()).toEqual([]);

    await expect(
      Effect.runPromise(service.completeDirectMerge({ ...input, removeWorktree: true })),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });
    expect(removals()).toEqual([
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
    ]);
  });

  test("requires publication consent before completing an unsynchronized merge", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.sync(() => {
          return [task({ status: "human_review" })];
        });
      },
      getTaskMetadata() {
        return Effect.sync(() => {
          return {
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            directMerge: {
              method: "merge_commit",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
              mergedAt: "2026-05-10T11:00:00.000Z",
            },
            agentSessions: [],
          };
        });
      },
      transitionTask() {
        return Effect.sync(() => {
          throw new Error("should not transition");
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitPort: {
            ...createDirectMergeGitPort({
              calls,
              currentBranches: { "/repo": { name: "main", detached: false } },
              aheadBehind: { "/repo|origin/main": { ahead: 1, behind: 0 } },
            }),
            inspectPublication: () =>
              Effect.succeed([{ destinationIdentity: "origin", oid: null }]),
          },
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1", removeWorktree: true }),
      ),
    ).rejects.toThrow("Publication is required.");
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "removeWorktree" }));
    expect(calls).not.toContainEqual(expect.objectContaining({ type: "deleteLocalBranch" }));
  });
  test("rejects direct merge completion without recorded direct merge metadata", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.sync(() => {
          return [task({ status: "human_review" })];
        });
      },
      getTaskMetadata() {
        return Effect.sync(() => {
          return {
            artifacts: { spec: { markdown: "# Spec" }, plan: { markdown: "# Plan" } },
            agentSessions: [],
          };
        });
      },
      transitionTask() {
        return Effect.sync(() => {
          throw new Error("should not transition");
        });
      },
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1", removeWorktree: true }),
      ),
    ).rejects.toThrow("Task task-1 does not have a locally applied direct merge to complete.");
  });
});
