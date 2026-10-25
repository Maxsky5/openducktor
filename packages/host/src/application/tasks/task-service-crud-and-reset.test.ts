import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { Effect } from "effect";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import { TaskAssetError, TaskCreatedAssetError } from "../../effect/task-asset-error";
import { createLiveWorkflowObservations } from "../agent-sessions/live-workflow-observations";
import { createTaskCompletionState } from "./task-completion-state";
import { createTaskDeleteUseCase } from "./use-cases/delete-task";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import { createTaskStoreTestDouble } from "../../test-support/task-store-test-double";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { createTaskSyncServiceForTest } from "./sync/task-sync-service.test-support";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeGitPort,
  createTaskService,
  createTaskServiceWithMutationProgress,
  type TaskActivityGuardPort,
  type TaskStorePort,
  task,
  type WorktreeFilePort,
} from "./test-support/task-workflow-harness";

const createCleanupWorktreeFiles = (calls: unknown[]): WorktreeFilePort =>
  ({
    prepareWorktreeAliasRemoval: () => Effect.die(new Error("Unexpected alias removal")),
    resolveWorktreeRemovalPath: () => Effect.die(new Error("Unexpected removal path resolution")),
    ensureDirectory() {
      return Effect.die(new Error("unexpected ensure directory"));
    },
    copyConfiguredPaths() {
      return Effect.tryPromise({
        try: async () => {
          throw new Error("unexpected copy configured paths");
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    removePathIfPresent(path) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ type: "removePathIfPresent", path });
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    resolveWorktreePath(repoPath, worktreePath) {
      return worktreePath.startsWith("/") ? worktreePath : `${repoPath}/${worktreePath}`;
    },
    resolvePathWithinRoot(root, candidate) {
      return Effect.succeed({
        canonicalPath: candidate,
        cleanupPath: candidate,
        isSymlink: false,
        kind:
          candidate !== root && candidate.startsWith(`${root}/`)
            ? ("descendant" as const)
            : ("outside" as const),
      });
    },
    pathIsWithinRoot(root, candidate) {
      return Effect.tryPromise({
        try: async () => {
          return candidate === root || candidate.startsWith(`${root}/`);
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  }) satisfies WorktreeFilePort satisfies WorktreeFilePort;
const metadataWithSessions = (
  agentSessions: ReturnType<typeof createAgentSessionRecord>[] = [],
) => ({
  artifacts: {},
  agentSessions,
});
const createResetTaskStore = (
  sessions: ReturnType<typeof createAgentSessionRecord>[],
  overrides: Partial<TaskStorePort> = {},
): TaskStorePort => ({
  listArtifacts: () => Effect.succeed([]),
  listTasks: () => Effect.succeed([task({ id: "task-1", status: "human_review" })]),
  getTaskMetadata: () => Effect.succeed(metadataWithSessions(sessions)),
  clearTaskArtifacts: () => Effect.succeed(true),
  clearAgentSessionsByRoles: () => Effect.succeed(true),
  setPullRequest: () => Effect.succeed(true),
  setDirectMerge: () => Effect.succeed(true),
  transitionTask: () => Effect.succeed(task({ id: "task-1", status: "open" })),
  ...overrides,
});
const createCleanupTaskServiceInput = (taskStore: TaskStorePort) => ({
  gitPort: createDirectMergeGitPort({ calls: [], branches: { "/repo": [] } }),
  settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
  taskStore: createTaskStoreTestDouble(taskStore),
  workspaceSettingsService: createBuildWorkspaceSettingsService({
    workspaceId: "repo",
    repoPath: "/repo",
    hooks: { postComplete: [] },
  }),
});
describe("createTaskService task mutations and reset", () => {
  test.each([false, true])(
    "publishes one captured artifact removal list for task reset, partial failure=%s",
    async (partialFailure) => {
      let artifactReads = 0;
      const failure = new HostOperationError({
        operation: "task-store.clear-agent-sessions",
        message: "clear sessions failed",
      });
      const events: ExternalTaskSyncEvent[] = [];
      const taskStore = createResetTaskStore([], {
        getTask: () => Effect.succeed(task({ status: "human_review" })),
        listArtifacts: () =>
          Effect.suspend(() => {
            artifactReads++;
            if (artifactReads > 1) {
              return Effect.fail(
                new HostOperationError({
                  operation: "task-store.list-artifacts",
                  message: "The removal list was already captured.",
                }),
              );
            }
            return Effect.succeed([
              {
                artifactId: "workflow:task-1:spec",
                taskId: "task-1",
                name: "Specification",
                revision: 2,
                updatedAt: null,
                classification: "workflow",
                code: "spec",
                mediaType: "text/markdown",
              },
            ]);
          }),
        clearAgentSessionsByRoles: () =>
          partialFailure ? Effect.fail(failure) : Effect.succeed(true),
      });
      const base = createTaskServiceWithMutationProgress(createCleanupTaskServiceInput(taskStore));
      const service = createEventPublishingTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskService: base,
        taskSyncService: createTaskSyncServiceForTest({
          taskService: base,
          workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
          eventBus: { publish: (event) => events.push(event) },
        }),
      });
      const result = await Effect.runPromise(
        Effect.result(service.resetTask({ repoPath: "/repo", taskId: "task-1" })),
      );
      expect(artifactReads).toBe(1);
      expect(events).toHaveLength(1);
      expect(events[0]?.boardChanges?.artifactChanges).toEqual([
        {
          taskId: "task-1",
          artifactIds: ["workflow:task-1:spec"],
          removedArtifactIds: ["workflow:task-1:spec"],
        },
      ]);
      if (partialFailure) {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { cause: failure },
        });
      } else {
        expect(result).toMatchObject({
          _tag: "Success",
          success: { id: "task-1", status: "open" },
        });
      }
    },
  );

  test.each(["success", "before commit", "asset cleanup", "publication"] as const)(
    "clears deleted task completion state after durable deletion: %s",
    async (failure) => {
      const live = createLiveWorkflowObservations();
      const completionState = createTaskCompletionState((observation) =>
        Effect.gen(function* () {
          if (failure === "publication" && !observation.failure && observation.taskId === "task-1")
            return yield* new HostOperationError({
              operation: "test.publish",
              message: "publication failed",
            });
          live.accept({ type: "task_completion_updated", observation });
        }),
      );
      const ids = ["task-1", "unrelated"];
      for (const id of ids) {
        const state = completionState.ensure("/repo", id);
        state.observation.failure = {
          stage: "cleanup",
          code: "task_completion_failed",
          message: "cleanup failed",
          nextAction: "Inspect cleanup.",
        };
        await Effect.runPromise(completionState.publish(state));
      }
      let deleted = false;
      const service = createTaskDeleteUseCase({
        taskWorkflows: builtinTaskWorkflows,
        ...createCleanupTaskServiceInput({
          listTasks: () => Effect.succeed([task({ id: "task-1" }), task({ id: "unrelated" })]),
          getTaskMetadata: () => Effect.succeed(metadataWithSessions()),
          deleteTask: () =>
            Effect.gen(function* () {
              if (failure === "before commit")
                return yield* new HostOperationError({
                  operation: "test.delete",
                  message: "delete failed",
                });
              deleted = true;
              if (failure === "asset cleanup")
                return yield* new TaskAssetError({
                  operation: "delete",
                  code: "purge",
                  taskId: "task-1",
                  assetIds: [],
                  failedPhase: "cleanup_after_commit",
                  durableState: "committed_cleanup_pending",
                  retryAllowed: false,
                  message: "Asset cleanup failed.",
                });
              return true;
            }),
        }),
        completionState,
        taskSessionLifecycleCoordinator: createTaskSessionLifecycleCoordinator(),
        terminalService: { acquireTaskCleanup: () => Effect.succeed({ closedTerminalIds: [] }) },
        browserTabs: { closeOwnerTabs: () => Effect.void },
      });
      const result = await Effect.runPromise(
        Effect.result(
          service.deleteTask({
            repoPath: "/repo",
            taskId: "task-1",
          }),
        ),
      );
      expect(deleted).toBe(failure !== "before commit");
      if (failure === "before commit") {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { message: expect.stringContaining("delete failed") },
        });
        expect(live.snapshot("/repo").taskCompletions.map(({ taskId }) => taskId)).toEqual(ids);
      } else {
        expect(completionState.ensure("/repo", "task-1").observation.failure).toBeUndefined();
        expect(live.snapshot("/repo").taskCompletions.map(({ taskId }) => taskId)).toEqual(
          failure === "publication" ? ["task-1", "unrelated"] : ["unrelated"],
        );
        if (failure === "success")
          expect(result).toMatchObject({ _tag: "Success", success: { ok: true } });
        else
          expect(result).toMatchObject({
            _tag: "Failure",
            failure: {
              operation: "delete-task",
              changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] },
              failure: {
                message:
                  failure === "publication"
                    ? "publication failed"
                    : expect.stringContaining("Asset cleanup failed."),
              },
            },
          });
      }
      expect(completionState.ensure("/repo", "unrelated").observation.failure).toBeDefined();
    },
  );
  test("reports committed task asset cleanup failures as mutation progress", async () => {
    const createdTaskId = "task-2";
    const failure = new TaskCreatedAssetError(
      {
        operation: "create",
        code: "purge",
        taskId: createdTaskId,
        assetIds: [],
        failedPhase: "cleanup_after_commit",
        durableState: "committed_cleanup_pending",
        retryAllowed: false,
        message: "Asset cleanup failed.",
      },
      { id: createdTaskId, title: "Created", status: "open" },
    );
    const service = createTaskServiceWithMutationProgress({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: {
        createTask: () => Effect.fail(failure),
      },
    });

    const result = await Effect.runPromise(
      service
        .createTask({
          repoPath: "/repo",
          task: { title: "Task", issueType: "task", priority: 2 },
        })
        .pipe(Effect.flip),
    );

    expect(result).toBeInstanceOf(TaskMutationProgressFailure);
    expect(result).toMatchObject({
      operation: "create-task",
      changes: { taskIds: [createdTaskId], removedTaskIds: [] },
      createdTask: { id: createdTaskId, title: "Created", status: "open" },
      failure,
    });
  });

  test("creates a task and enriches the result", async () => {
    const calls: unknown[] = [];
    const createdTask = task({ id: "task-2", status: "open" });
    const taskStore: TaskStorePort = {
      createTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "create", input });
            return createdTask;
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
      getTaskMetadata() {
        return Effect.succeed(metadataWithSessions());
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
    const created = await Effect.runPromise(
      createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).createTask({
        repoPath: "/repo",
        task: {
          title: "Child",
          issueType: "task",
          priority: 2,
        },
      }),
    );
    expect(calls).toEqual([
      {
        type: "create",
        input: {
          repoPath: "/repo",
          status: "open",
          task: {
            title: "Child",
            issueType: "task",
            priority: 2,
          },
        },
      },
    ]);
    expect(created).toMatchObject({
      id: "task-2",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "build_start",
        "reset_task",
        "close_task",
      ],
    });
  });
  test("creates a standalone task without listing the whole task store first", async () => {
    const calls: unknown[] = [];
    const createdTask = task({ id: "task-2", status: "open" });
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.die(new Error("unexpected list"));
      },
      createTask(input) {
        return Effect.sync(() => {
          calls.push({ type: "create", input });
          return createdTask;
        });
      },
      updateTask() {
        return Effect.die(new Error("unexpected update"));
      },
      transitionTask() {
        return Effect.die(new Error("unexpected transition"));
      },
      deleteTask() {
        return Effect.die(new Error("unexpected delete"));
      },
    };

    const created = await Effect.runPromise(
      createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).createTask({
        repoPath: "/repo",
        task: {
          title: "Standalone",
          issueType: "task",
          priority: 2,
        },
      }),
    );

    expect(calls).toEqual([
      {
        type: "create",
        input: {
          repoPath: "/repo",
          status: "open",
          task: {
            title: "Standalone",
            issueType: "task",
            priority: 2,
          },
        },
      },
    ]);
    expect(created.id).toBe("task-2");
    expect(created.availableActions).toEqual(
      expect.arrayContaining(["view_details", "set_spec", "set_plan", "build_start"]),
    );
  });
  test("deletes a task", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task()];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      deleteTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "delete", input });
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
      getTaskMetadata(input) {
        return Effect.sync(() => {
          calls.push({ type: "metadata", input });
          return metadataWithSessions();
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
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitPort: createDirectMergeGitPort({ calls }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({ ok: true, changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] } });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "listBranches", workingDir: "/repo" },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });
  test("deletes a task with inactive session guard and cleans its worktree, branch, and browser tabs", async () => {
    const calls: unknown[] = [];
    const session = createAgentSessionRecord({
      workingDirectory: "/worktrees/repo/task-1",
      role: "planner",
    });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1" })];
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
        return Effect.succeed(metadataWithSessions(input.taskId === "task-1" ? [session] : []));
      },
      deleteTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "delete", input });
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
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "activityGuard", input });
            return { stoppedSessionCount: 0 };
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
          gitPort: createDirectMergeGitPort({
            calls,
            branches: {
              "/repo": [
                { name: "main", isCurrent: true, isRemote: false },
                { name: "feature/other", isCurrent: false, isRemote: false },
                {
                  name: "odt/task-1",
                  isCurrent: false,
                  isRemote: false,
                  worktreePath: "/worktrees/repo/task-1",
                },
                { name: "origin/odt/task-1", isCurrent: false, isRemote: true },
              ],
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskActivityGuard,
          taskStore,
          browserTabs: {
            closeOwnerTabs: (owner) =>
              Effect.sync(() => void calls.push({ type: "closeTabs", owner })),
          },
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo-alias", taskId: "task-1" }),
      ),
    ).resolves.toEqual({
      ok: true,
      changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] },
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo-alias" } },
      { type: "listBranches", workingDir: "/repo" },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session] }],
        },
      },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      { type: "closeTabs", owner: { kind: "task", workspaceId: "repo", taskId: "task-1" } },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });
  test("deletes closed tasks with stranded managed worktree directories", async () => {
    const calls: unknown[] = [];
    const session = createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({
                id: "task-1",
                status: "closed",
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
      getTaskMetadata() {
        return Effect.succeed(metadataWithSessions([session]));
      },
      deleteTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "delete", input });
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
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "activityGuard", input });
            return { stoppedSessionCount: 0 };
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
          gitPort: {
            ...createDirectMergeGitPort({
              calls,
              branches: {
                "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
              },
              removeWorktreeErrors: {
                "/repo|/worktrees/repo/task-1|true": new Error("worktree removal race"),
              },
            }),
            isRegisteredWorktree: () => Effect.succeed(false),
          },
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskActivityGuard,
          taskStore,
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({ ok: true, changes: { taskIds: ["task-1"], removedTaskIds: ["task-1"] } });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "listBranches", workingDir: "/repo" },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session] }],
        },
      },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
    ]);
  });
  test("keeps a task when failed worktree removal leaves missing outside-root identity unproved", async () => {
    const calls: unknown[] = [];
    const removalError = new Error("worktree removal race");
    const session = createAgentSessionRecord({ workingDirectory: "/legacy/repo/task-1" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.sync(() => {
          calls.push({ type: "list", input });
          return [task({ id: "task-1", status: "closed" })];
        });
      },
      getTaskMetadata() {
        return Effect.succeed(metadataWithSessions([session]));
      },
      deleteTask(input) {
        return Effect.sync(() => {
          calls.push({ type: "delete", input });
          return true;
        });
      },
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions(input) {
        return Effect.sync(() => {
          calls.push({ type: "activityGuard", input });
          return { stoppedSessionCount: 0 };
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
              branches: {
                "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
              },
              removeWorktreeErrors: {
                "/repo|/legacy/repo/task-1|true": removalError,
              },
            }),
            isRegisteredWorktree: (repoPath, worktreePath) =>
              Effect.sync(() => {
                calls.push({ type: "isRegisteredWorktree", repoPath, worktreePath });
                return true;
              }),
          },
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskActivityGuard,
          taskStore,
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("worktree removal race");
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "listBranches", workingDir: "/repo" },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: [session] }],
        },
      },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/legacy/repo/task-1",
        force: true,
      },
      {
        type: "isRegisteredWorktree",
        repoPath: "/repo",
        worktreePath: "/legacy/repo/task-1",
      },
    ]);
  });
  test("fails fast when task deletion needs live activity checks but no guard is configured", async () => {
    const session = createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" });
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task()];
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
        return Effect.succeed(metadataWithSessions([session]));
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
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(
      "task_delete requires runtime session activity checks for tasks with workflow sessions.",
    );
  });
  test("aborts delete before destructive work when stopping live sessions fails", async () => {
    let deleted = false;
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ id: "task-1" })]),
      getTaskMetadata: () => Effect.succeed(metadataWithSessions([createAgentSessionRecord()])),
      deleteTask: () =>
        Effect.sync(() => {
          deleted = true;
          return true;
        }),
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions: () =>
        Effect.fail(
          new HostOperationError({ operation: "test.stop", message: "runtime stop failed" }),
        ),
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          ...createCleanupTaskServiceInput(taskStore),
          taskActivityGuard,
        }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("runtime stop failed");
    expect(deleted).toBe(false);
  });
  test("reports stopped sessions when delete fails after the stop step", async () => {
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ id: "task-1" })]),
      getTaskMetadata: () => Effect.succeed(metadataWithSessions([createAgentSessionRecord()])),
      deleteTask: () =>
        Effect.fail(
          new HostOperationError({ operation: "test.delete", message: "task store delete failed" }),
        ),
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions: () => Effect.succeed({ stoppedSessionCount: 2 }),
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          ...createCleanupTaskServiceInput(taskStore),
          taskActivityGuard,
        }).deleteTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(/Delete cleanup already completed: Stopped 2 live agent sessions,/);
  });
  test("resets implementation after activity guard and cleans task state", async () => {
    const calls: unknown[] = [];
    const currentSessions = [
      createAgentSessionRecord({
        workingDirectory: "/worktrees/repo/task-1",
      }),
      createAgentSessionRecord({
        externalSessionId: "legacy-qa",
        role: "qa",
        workingDirectory: "/worktrees/repo/task-1-legacy",
      }),
    ];
    const currentTask = task({
      title: "Renamed Task",
      status: "ai_review",
      artifactSummary: {
        spec: { present: true, updatedAt: "2026-05-01T00:00:00.000Z" },
        plan: { present: true, updatedAt: "2026-05-02T00:00:00.000Z" },
        qaReport: { present: true, updatedAt: "2026-05-03T00:00:00.000Z", verdict: "approved" },
      },
    });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [currentTask];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      clearAgentSessionsByRoles(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "clearAgentSessions", input });
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
      clearWorkflowArtifacts(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "clearWorkflowArtifacts", input });
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
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
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
            return task({ id: "task-1", status: input.status });
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
      getTaskMetadata() {
        return Effect.succeed(metadataWithSessions(currentSessions));
      },
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "resetActivityGuard", input });
            return { stoppedSessionCount: 0 };
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
          gitPort: createDirectMergeGitPort({
            calls,
            currentBranches: {
              "/worktrees/repo/task-1": {
                name: "odt/task-1-original-title",
                detached: false,
              },
            },
            branches: {
              "/repo": [
                { name: "main", isCurrent: true, isRemote: false },
                {
                  name: "odt/task-1-original-title",
                  isCurrent: false,
                  isRemote: false,
                  worktreePath: "/worktrees/repo/task-1",
                },
                { name: "odt/task-1-legacy", isCurrent: false, isRemote: false },
              ],
            },
          }),
          settingsConfig: createBuildSettingsConfig(
            new Set(["/repo", "/worktrees/repo/task-1", "/worktrees/repo/task-1-legacy"]),
          ),
          taskActivityGuard,
          taskStore,
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).resetImplementation({ repoPath: "/repo-alias", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "ready_for_dev" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo-alias" } },
      { type: "listBranches", workingDir: "/repo" },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      {
        type: "resetActivityGuard",
        input: {
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: currentSessions }],
        },
      },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1-legacy",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1-legacy" },
      {
        type: "deleteLocalBranch",
        repoPath: "/repo",
        branch: "odt/task-1-legacy",
        force: true,
      },
      {
        type: "restoreWorktree",
        workingDirectory: "/worktrees/repo/task-1",
        reference: "origin/main",
      },
      {
        type: "clearAgentSessions",
        input: { repoPath: "/repo", taskId: "task-1", roles: ["build", "qa"] },
      },
      {
        type: "clearWorkflowArtifacts",
        input: { repoPath: "/repo", taskId: "task-1", codes: ["qaReport"] },
      },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: null },
      },
      {
        type: "setDirectMerge",
        input: { repoPath: "/repo", taskId: "task-1", directMerge: null },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "ready_for_dev", cause: {} },
      },
    ]);
  });
  test("resets a task by clearing workflow artifacts and rolling status back to open", async () => {
    const calls: unknown[] = [];
    const currentSessions = [
      createAgentSessionRecord({
        role: "planner",
        workingDirectory: "/worktrees/repo/task-1",
      }),
    ];
    const currentTask = task({
      status: "human_review",
    });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [currentTask];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      listArtifacts: () => Effect.succeed([]),
      clearTaskArtifacts(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "clearTaskArtifacts", input });
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
      clearAgentSessionsByRoles(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "clearAgentSessions", input });
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
      setPullRequest(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPullRequest", input });
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
            return task({ id: "task-1", status: input.status });
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
      getTaskMetadata() {
        return Effect.succeed(metadataWithSessions(currentSessions));
      },
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "resetActivityGuard", input });
            return { stoppedSessionCount: 0 };
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
          gitPort: createDirectMergeGitPort({
            calls,
            branches: {
              "/repo": [
                { name: "feature/other", isCurrent: false, isRemote: false },
                {
                  name: "odt/task-1",
                  isCurrent: false,
                  isRemote: false,
                  worktreePath: "/worktrees/repo/task-1",
                },
              ],
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskActivityGuard,
          taskStore,
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).resetTask({ repoPath: "/repo-alias", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "open" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo-alias" } },
      { type: "listBranches", workingDir: "/repo" },
      {
        type: "resetActivityGuard",
        input: {
          repoPath: "/repo",
          taskSessions: [{ taskId: "task-1", sessions: currentSessions }],
        },
      },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "clearTaskArtifacts",
        input: { repoPath: "/repo", taskId: "task-1" },
      },
      {
        type: "clearAgentSessions",
        input: { repoPath: "/repo", taskId: "task-1", roles: ["spec", "planner", "build", "qa"] },
      },
      {
        type: "setPullRequest",
        input: { repoPath: "/repo", taskId: "task-1", pullRequest: null },
      },
      {
        type: "setDirectMerge",
        input: { repoPath: "/repo", taskId: "task-1", directMerge: null },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "open", cause: {} },
      },
    ]);
  });
  test("fails fast when task reset needs live activity checks but no guard is configured", async () => {
    const taskStore = createResetTaskStore([createAgentSessionRecord()]);

    await expect(
      Effect.runPromise(
        createTaskService(createCleanupTaskServiceInput(taskStore)).resetTask({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).rejects.toThrow(
      "task_reset requires runtime session activity checks for tasks with spec, planner, build, or QA sessions.",
    );
  });
  test("aborts task reset before destructive work when stopping live sessions fails", async () => {
    let workflowArtifactsCleared = false;
    const taskStore = createResetTaskStore([createAgentSessionRecord()], {
      clearTaskArtifacts: () =>
        Effect.sync(() => {
          workflowArtifactsCleared = true;
          return true;
        }),
    });
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions: () =>
        Effect.fail(
          new HostOperationError({ operation: "test.stop", message: "runtime stop failed" }),
        ),
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          ...createCleanupTaskServiceInput(taskStore),
          taskActivityGuard,
        }).resetTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("runtime stop failed");
    expect(workflowArtifactsCleared).toBe(false);
  });
  test("reports stopped sessions when task reset fails after the stop step", async () => {
    const taskStore = createResetTaskStore([createAgentSessionRecord()], {
      clearTaskArtifacts: () =>
        Effect.fail(
          new HostOperationError({ operation: "test.clear", message: "artifact clear failed" }),
        ),
    });
    const taskActivityGuard: TaskActivityGuardPort = {
      countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
      cleanupTaskSessions: () => Effect.succeed({ stoppedSessionCount: 2 }),
    };

    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          ...createCleanupTaskServiceInput(taskStore),
          taskActivityGuard,
        }).resetTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(/Reset cleanup already completed: Stopped 2 live agent sessions,/);
  });
  test("reports implementation reset failures after the first store clear as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.clear-workflow-artifacts",
      message: "clear QA reports failed",
    });
    let sessionsCleared = false;
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "blocked" })]),
      getTaskMetadata: () => Effect.succeed(metadataWithSessions([createAgentSessionRecord()])),
      clearAgentSessionsByRoles: () =>
        Effect.sync(() => {
          sessionsCleared = true;
          return true;
        }),
      clearWorkflowArtifacts: () => Effect.fail(failure),
    };
    const service = createTaskServiceWithMutationProgress({
      taskWorkflows: builtinTaskWorkflows,
      gitPort: createDirectMergeGitPort({ calls: [], branches: { "/repo": [] } }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskActivityGuard: {
        countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
        cleanupTaskSessions: () => Effect.succeed({ stoppedSessionCount: 2 }),
      },
      taskStore,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });

    const result = await Effect.runPromise(
      service.resetImplementation({ repoPath: "/repo", taskId: "task-1" }).pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(sessionsCleared).toBe(true);
    expect(result.operation).toBe("reset-implementation");
    expect(result.artifactChanges).toEqual([]);
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure.message).toContain("clear QA reports failed");
    expect(result.failure.message).toContain("Stopped 2 live agent sessions,");
    expect(result.failure.message).not.toContain("records..");
    expect(result.failure.message).toContain("Cleared the session records of the worktree roles.");
    expect(result.failure).toMatchObject({ cause: failure });
  });
  test("rejects implementation reset when the canonical worktree is not on a task branch", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "blocked" })]),
      getTaskMetadata: () =>
        Effect.succeed(
          metadataWithSessions([
            createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
          ]),
        ),
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      gitPort: createDirectMergeGitPort({
        calls,
        currentBranches: {
          "/worktrees/repo/task-1": { name: "feature/other", detached: false },
        },
      }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
      taskActivityGuard: {
        countLiveSessions: () => Effect.succeed({ liveSessionCount: 0 }),
        cleanupTaskSessions: () =>
          Effect.sync(() => {
            calls.push({ type: "cleanupTaskSessions" });
            return { stoppedSessionCount: 0 };
          }),
      },
      taskStore,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });

    await expect(
      Effect.runPromise(service.resetImplementation({ repoPath: "/repo", taskId: "task-1" })),
    ).rejects.toThrow("is on branch feature/other, which is not a task branch");
    expect(calls).toEqual([
      { type: "listBranches", workingDir: "/repo" },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
    ]);
  });
  test.each([
    {
      operationLabel: "delete",
      run: (service: ReturnType<typeof createTaskService>) =>
        service.deleteTask({ repoPath: "/repo", taskId: "task-1" }).pipe(Effect.asVoid),
    },
    {
      operationLabel: "reset task",
      run: (service: ReturnType<typeof createTaskService>) =>
        service.resetTask({ repoPath: "/repo", taskId: "task-1" }).pipe(Effect.asVoid),
    },
  ])(
    "rejects $operationLabel when another worktree has the task branch checked out",
    async ({ operationLabel, run }) => {
      const calls: unknown[] = [];
      const taskStore: TaskStorePort = {
        listTasks: () => Effect.succeed([task({ status: "in_progress" })]),
        getTaskMetadata: () => Effect.succeed(metadataWithSessions([])),
      };
      const service = createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        gitPort: createDirectMergeGitPort({
          calls,
          branches: {
            "/repo": [
              { name: "odt/task-1", isCurrent: true, isRemote: false, worktreePath: "/repo" },
            ],
          },
        }),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        taskStore,
        worktreeFiles: createCleanupWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: [] },
        }),
      });

      await expect(Effect.runPromise(run(service))).rejects.toThrow(
        `Cannot ${operationLabel} task task-1 because branch odt/task-1 is checked out in worktree /repo.`,
      );
      expect(calls).toEqual([{ type: "listBranches", workingDir: "/repo" }]);
    },
  );
  test("reports task reset failures after workflow artifact clearing as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.clear-agent-sessions",
      message: "clear sessions failed",
    });
    let artifactsCleared = false;
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ status: "human_review" })]),
      getTaskMetadata: () => Effect.succeed(metadataWithSessions([])),
      listArtifacts: () =>
        Effect.succeed([
          {
            artifactId: "workflow:task-1:spec",
            taskId: "task-1",
            name: "Specification",
            revision: 2,
            updatedAt: null,
            classification: "workflow",
            code: "spec",
            mediaType: "text/markdown",
          },
          {
            artifactId: "free-1",
            taskId: "task-1",
            name: "Notes",
            revision: 1,
            updatedAt: "2026-10-22T12:00:00.000Z",
            classification: "free",
            code: "notes",
            fileName: "notes.txt",
            mediaType: "text/plain",
            byteSize: 4,
          },
        ]),
      clearTaskArtifacts: () =>
        Effect.sync(() => {
          artifactsCleared = true;
          return true;
        }),
      clearAgentSessionsByRoles: () => Effect.fail(failure),
    };
    const service = createTaskServiceWithMutationProgress({
      taskWorkflows: builtinTaskWorkflows,
      gitPort: createDirectMergeGitPort({ calls: [], branches: { "/repo": [] } }),
      settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
      taskStore,
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: [] },
      }),
    });

    const result = await Effect.runPromise(
      service.resetTask({ repoPath: "/repo", taskId: "task-1" }).pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(artifactsCleared).toBe(true);
    expect(result.operation).toBe("reset-task");
    expect(result.artifactChanges).toEqual([
      {
        taskId: "task-1",
        artifactIds: ["workflow:task-1:spec", "free-1"],
        removedArtifactIds: ["workflow:task-1:spec", "free-1"],
      },
    ]);
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure.message).toContain("clear sessions failed");
    expect(result.failure.message).toContain("cleared task artifacts");
    expect(result.failure).toMatchObject({ cause: failure });
  });
  test("fails fast when implementation reset needs live activity checks but no guard is configured", async () => {
    const session = createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" });
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ status: "blocked" })];
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
        return Effect.succeed(metadataWithSessions([session]));
      },
      clearAgentSessionsByRoles() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected clear sessions");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setPullRequest() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected set PR");
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
            throw new Error("unexpected set direct merge");
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
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
          }),
        }).resetImplementation({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(
      "task_reset_implementation requires runtime session activity checks for task sessions that may use the canonical worktree.",
    );
  });
  test("updates a task and enriches the result", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "ready_for_dev", issueType: "feature" });
    const taskStore: TaskStorePort = {
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
      updateTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "update", input });
            return updatedTask;
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
    const updated = await Effect.runPromise(
      createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).updateTask({
        repoPath: "/repo",
        taskId: "task-1",
        patch: {
          issueType: "feature",
          title: "Updated",
          targetBranch: { remote: "origin", branch: "main" },
        },
      }),
    );
    expect(calls).toEqual([
      {
        type: "update",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          patch: {
            issueType: "feature",
            title: "Updated",
            targetBranch: { remote: "origin", branch: "main" },
          },
        },
      },
    ]);
    expect(updated).toMatchObject({
      id: "task-1",
      agentWorkflows: {
        planner: { required: true, available: true },
        build: { available: true },
      },
    });
  });
  test("transitions a task after validating workflow rules and enriches the result", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "in_progress", issueType: "bug" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1", issueType: "bug", status: "open" })];
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
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "transition", input });
            return updatedTask;
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
    const transitioned = await Effect.runPromise(
      createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).transitionTask({
        repoPath: "/repo",
        taskId: "task-1",
        status: "in_progress",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress", cause: {} },
      },
    ]);
    expect(transitioned).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });
  test("returns the current task without store mutation when transition status is unchanged", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ id: "task-1", issueType: "task", status: "open" })];
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
        createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).transitionTask({
          repoPath: "/repo",
          taskId: "task-1",
          status: "open",
        }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "open" });
  });
  test("rejects invalid task transitions before calling the store", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ id: "feature-1", issueType: "feature", status: "open" })];
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
        createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).transitionTask({
          repoPath: "/repo",
          taskId: "feature-1",
          status: "in_progress",
        }),
      ),
    ).rejects.toMatchObject({
      code: "TASK_TRANSITION_NOT_ALLOWED",
      message:
        "set-status:in_progress is not allowed for task feature-1 (feature) from open. Complete required planning first, then use it from ready_for_dev, in_progress, blocked, ai_review, or human_review.",
    });
  });

  test("rejects generic transitions to closed", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.die(new Error("should not list tasks"));
      },
    };

    await expect(
      Effect.runPromise(
        createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).transitionTask({
          repoPath: "/repo",
          taskId: "task-1",
          status: "closed",
        }),
      ),
    ).rejects.toThrow("task_transition cannot move tasks to closed");
  });
});
