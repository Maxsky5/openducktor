import { Effect } from "effect";
import { TaskPolicyError } from "../../domain/task";
import { HostOperationError } from "../../effect/host-errors";
import {
  createAgentSessionRecord,
  createBuildSettingsConfig,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createDirectMergeGitPort,
  createTaskService,
  type TaskActivityGuardPort,
  type TaskStorePort,
  task,
  type WorktreeFilePort,
} from "./test-support/task-workflow-harness";

const createCleanupWorktreeFiles = (calls: unknown[]): WorktreeFilePort =>
  ({
    ensureDirectory() {
      return Effect.dieMessage("unexpected ensure directory");
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
  }) satisfies WorktreeFilePort as unknown as WorktreeFilePort;
describe("createTaskService task mutations and reset", () => {
  test("creates a task after validating parent relationships and enriches the result", async () => {
    const calls: unknown[] = [];
    const createdTask = task({ id: "task-2", parentId: "epic-1", status: "open" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "epic-1", issueType: "epic", status: "open" })];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
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
      createTaskService({ taskStore }).createTask({
        repoPath: "/repo",
        task: {
          title: "Child",
          issueType: "task",
          priority: 2,
          parentId: " epic-1 ",
          aiReviewEnabled: true,
        },
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Child",
            issueType: "task",
            priority: 2,
            parentId: " epic-1 ",
            aiReviewEnabled: true,
          },
        },
      },
    ]);
    expect(created).toMatchObject({
      id: "task-2",
      availableActions: ["view_details", "set_spec", "set_plan", "build_start", "reset_task"],
    });
    expect(created.availableActions).not.toContain("defer_issue");
  });
  test("rejects subtasks under non-epic parents before creating", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ id: "task-1", issueType: "task" })];
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
            throw new Error("should not create");
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
    const error = await Effect.runPromise(
      Effect.flip(
        createTaskService({ taskStore }).createTask({
          repoPath: "/repo",
          task: {
            title: "Child",
            issueType: "task",
            priority: 2,
            parentId: "task-1",
            aiReviewEnabled: true,
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    expect((error as TaskPolicyError).code).toBe("TASK_POLICY_ERROR");
    expect((error as TaskPolicyError).message).toBe("Only epics can have subtasks.");
  });
  test("deletes a task without subtasks and stops task-scoped dev servers", async () => {
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
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({ calls }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: false },
      },
    ]);
  });
  test("requires confirmation before deleting a task with subtasks", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({ id: "epic-1", issueType: "epic" }),
              task({ id: "task-1", parentId: "epic-1" }),
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
          devServerService: createDirectMergeDevServerService(calls),
          gitPort: createDirectMergeGitPort({ calls }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: false }),
      ),
    ).rejects.toThrow("Task epic-1 has 1 subtasks. Confirm subtask deletion to continue.");
    expect(calls).toEqual([{ type: "list", input: { repoPath: "/repo" } }]);
  });
  test("deletes subtasks with inactive session guard and cleans related worktrees and branches", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({ id: "epic-1", issueType: "epic", subtaskIds: ["task-1"] }),
              task({
                id: "task-1",
                parentId: "epic-1",
                agentSessions: [
                  createAgentSessionRecord({
                    workingDirectory: "/worktrees/repo/task-1",
                  }),
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
      ensureNoActiveTaskDeleteRuns(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "activityGuard", input });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      ensureNoActiveTaskResetActivity() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected reset activity guard");
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
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
            branches: {
              "/repo": [
                { name: "main", isCurrent: true, isRemote: false },
                { name: "odt/task-1", isCurrent: false, isRemote: false },
                { name: "origin/odt/task-1", isCurrent: false, isRemote: true },
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
            hooks: { preStart: [], postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskIds: ["epic-1", "task-1"],
          tasks: expect.arrayContaining([
            expect.objectContaining({ id: "epic-1" }),
            expect.objectContaining({ id: "task-1" }),
          ]),
        },
      },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "epic-1" } },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
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
        input: { repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true },
      },
    ]);
  });
  test("deletes closed tasks with stranded managed worktree directories", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({
                id: "task-1",
                status: "closed",
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
      ensureNoActiveTaskDeleteRuns(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "activityGuard", input });
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      ensureNoActiveTaskResetActivity() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected reset activity guard");
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
            branches: {
              "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
            },
            removeWorktreeErrors: {
              "/repo|/worktrees/repo/task-1|true": new Error(
                "fatal: '/worktrees/repo/task-1' is not a working tree",
              ),
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          taskActivityGuard,
          taskStore,
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
      ),
    ).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "activityGuard",
        input: {
          repoPath: "/repo",
          taskIds: ["task-1"],
          tasks: [expect.objectContaining({ id: "task-1" })],
        },
      },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
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
        input: { repoPath: "/repo", taskId: "task-1", deleteSubtasks: false },
      },
    ]);
  });
  test("fails fast when task deletion needs live activity checks but no guard is configured", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [
              task({
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
          devServerService: createDirectMergeDevServerService([]),
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false }),
      ),
    ).rejects.toThrow(
      "task_delete requires runtime session activity checks for tasks with build or QA sessions.",
    );
  });
  test("resets implementation after activity guard and cleans builder state", async () => {
    const calls: unknown[] = [];
    const currentTask = task({
      status: "ai_review",
      documentSummary: {
        spec: { has: true, updatedAt: "2026-05-01T00:00:00.000Z" },
        plan: { has: true, updatedAt: "2026-05-02T00:00:00.000Z" },
        qaReport: {
          has: true,
          updatedAt: "2026-05-03T00:00:00.000Z",
          verdict: "approved",
        },
      },
      agentSessions: [
        createAgentSessionRecord({
          workingDirectory: "/worktrees/repo/task-1",
        }),
      ],
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
      clearQaReports(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "clearQaReports", input });
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
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected metadata");
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
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      ensureNoActiveTaskDeleteRuns() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete activity guard");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      ensureNoActiveTaskResetActivity(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "resetActivityGuard", input });
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
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
            branches: {
              "/repo": [
                { name: "main", isCurrent: true, isRemote: false },
                { name: "odt/task-1", isCurrent: false, isRemote: false },
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
            hooks: { preStart: [], postComplete: [] },
          }),
        }).resetImplementation({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "ready_for_dev" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "resetActivityGuard",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          sessions: currentTask.agentSessions,
          operationLabel: "reset implementation",
          sessionRoles: ["build", "qa"],
        },
      },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "clearAgentSessions",
        input: { repoPath: "/repo", taskId: "task-1", roles: ["build", "qa"] },
      },
      { type: "clearQaReports", input: { repoPath: "/repo", taskId: "task-1" } },
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
        input: { repoPath: "/repo", taskId: "task-1", status: "ready_for_dev" },
      },
    ]);
  });
  test("resets a task by clearing workflow artifacts and rolling status back to open", async () => {
    const calls: unknown[] = [];
    const currentTask = task({
      status: "human_review",
      agentSessions: [
        createAgentSessionRecord({
          role: "planner",
          workingDirectory: "/worktrees/repo/task-1",
        }),
      ],
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
      clearWorkflowDocuments(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "clearWorkflowDocuments", input });
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
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected metadata");
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
    };
    const taskActivityGuard: TaskActivityGuardPort = {
      ensureNoActiveTaskDeleteRuns() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected delete activity guard");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      ensureNoActiveTaskResetActivity(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "resetActivityGuard", input });
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
            currentBranches: {
              "/worktrees/repo/task-1": { name: "odt/task-1", detached: false },
            },
            branches: {
              "/repo": [{ name: "odt/task-1", isCurrent: false, isRemote: false }],
            },
          }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskActivityGuard,
          taskStore,
          worktreeFiles: createCleanupWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).resetTask({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "open" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "resetActivityGuard",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          sessions: currentTask.agentSessions,
          operationLabel: "reset task",
          sessionRoles: ["spec", "planner", "build", "qa"],
        },
      },
      { type: "currentBranch", workingDir: "/worktrees/repo/task-1" },
      { type: "listBranches", workingDir: "/repo" },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "removeWorktree",
        repoPath: "/repo",
        worktreePath: "/worktrees/repo/task-1",
        force: true,
      },
      { type: "removePathIfPresent", path: "/worktrees/repo/task-1" },
      { type: "deleteLocalBranch", repoPath: "/repo", branch: "odt/task-1", force: true },
      {
        type: "clearWorkflowDocuments",
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
        input: { repoPath: "/repo", taskId: "task-1", status: "open" },
      },
    ]);
  });
  test("fails fast when implementation reset needs live activity checks but no guard is configured", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [
              task({
                status: "blocked",
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
      clearQaReports() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("unexpected clear QA");
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
    };
    await expect(
      Effect.runPromise(
        createTaskService({
          devServerService: createDirectMergeDevServerService([]),
          gitPort: createDirectMergeGitPort({ calls: [] }),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          taskStore,
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: [] },
          }),
        }).resetImplementation({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow(
      "task_reset_implementation requires runtime session activity checks for tasks with build or QA sessions.",
    );
  });
  test("updates a task after validating parent relationships and enriches the result", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "ready_for_dev", issueType: "feature" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
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
      createTaskService({ taskStore }).updateTask({
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
      { type: "list", input: { repoPath: "/repo" } },
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
        builder: { available: true },
      },
    });
  });
  test("rejects update when converting a task with subtasks into a subtask", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [
              task({ id: "task-1", issueType: "feature" }),
              task({ id: "task-2", parentId: "task-1" }),
              task({ id: "epic-2", issueType: "epic" }),
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
            throw new Error("should not update");
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
    const error = await Effect.runPromise(
      Effect.flip(
        createTaskService({ taskStore }).updateTask({
          repoPath: "/repo",
          taskId: "task-1",
          patch: { parentId: "epic-2" },
        }),
      ),
    );

    expect(error).toBeInstanceOf(TaskPolicyError);
    expect((error as TaskPolicyError).code).toBe("TASK_POLICY_ERROR");
    expect((error as TaskPolicyError).message).toBe("Tasks with subtasks cannot become subtasks.");
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
      createTaskService({ taskStore }).transitionTask({
        repoPath: "/repo",
        taskId: "task-1",
        status: "in_progress",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
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
        createTaskService({ taskStore }).transitionTask({
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
        createTaskService({ taskStore }).transitionTask({
          repoPath: "/repo",
          taskId: "feature-1",
          status: "in_progress",
        }),
      ),
    ).rejects.toThrow("Transition not allowed for feature-1 (feature): open -> in_progress");
  });
});
