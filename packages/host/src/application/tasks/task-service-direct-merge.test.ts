import { Effect } from "effect";
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
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
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
                git: { defaultMergeMethod: "merge_commit" },
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
        input: { repoPath: "/repo", taskId: "task-1", status: "human_review" },
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
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
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
                git: { defaultMergeMethod: "merge_commit" },
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
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
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
                    git: { defaultMergeMethod: "merge_commit" },
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
    });
    await expect(
      Effect.runPromise(service.completeDirectMerge({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toMatchObject({ id: "task-1", status: "closed" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/repo" },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: false,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "isAncestor", workingDir: "/repo", ancestor: "odt/task-1", descendant: "main" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "closed" },
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
        }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
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
            spec: { markdown: "# Spec" },
            plan: { markdown: "# Plan" },
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
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          taskWorktreeService: createDirectMergeTaskWorktreeService(null),
        }).completeDirectMerge({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("Task task-1 does not have a locally applied direct merge to complete.");
  });
});
