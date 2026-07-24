import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildStartRuntimeRegistry,
  createBuildStartWorktreeFiles,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createDirectMergeDevServerService,
  createRuntimeDefinitionsService,
  createTaskService,
  createTaskServiceWithMutationProgress,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

const taskStoreEffect = <Success>(run: () => Promise<Success>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new HostOperationError({
        operation: "test.effect",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

const taskWithQaReport = (input: {
  status: "human_review" | "in_progress";
  verdict: "approved" | "rejected";
}) =>
  task({
    id: "task-1",
    status: input.status,
    documentSummary: {
      spec: { has: false },
      plan: { has: false },
      qaReport: { has: true, verdict: input.verdict },
    },
  });

const createQaOutcomeTaskStore = (fixture: {
  calls: unknown[];
  currentStatus: "blocked" | "ai_review" | "human_review";
  resultTask: ReturnType<typeof task>;
}): TaskStorePort => ({
  listTasks(input) {
    return taskStoreEffect(async () => {
      fixture.calls.push({ type: "list", input });
      return [task({ id: "task-1", status: fixture.currentStatus })];
    });
  },
  recordQaOutcome(input) {
    return taskStoreEffect(async () => {
      fixture.calls.push({ type: "qa", input });
      return fixture.resultTask;
    });
  },
});

describe("createTaskService build and review", () => {
  test("blocks a build after requiring a non-empty reason", async () => {
    const calls: unknown[] = [];
    const blockedTask = task({ id: "task-1", status: "blocked" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1", status: "in_progress" })];
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
            return blockedTask;
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
    const blocked = await Effect.runPromise(
      createTaskService({ taskStore }).buildBlocked({
        repoPath: "/repo",
        taskId: "task-1",
        reason: " Waiting on API ",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "blocked" } },
    ]);
    expect(blocked).toMatchObject({
      id: "task-1",
      status: "blocked",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });
  test("rejects build_blocked without a reason before calling the store", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list");
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
        createTaskService({ taskStore }).buildBlocked({
          repoPath: "/repo",
          taskId: "task-1",
          reason: " ",
        }),
      ),
    ).rejects.toThrow("build_blocked requires a non-empty reason");
  });
  test("resumes a blocked build through a targeted task load", async () => {
    const calls: unknown[] = [];
    const resumedTask = task({ id: "task-1", status: "in_progress" });
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
            return task({ id: "task-1", status: "blocked" });
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
            return resumedTask;
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
    const resumed = await Effect.runPromise(
      createTaskService({ taskStore }).buildResumed({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    );
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
    ]);
    expect(resumed).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });
  test("returns the current task without store mutation when resumed build is already in progress", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list");
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
            return task({ id: "task-1", status: "in_progress" });
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
        createTaskService({ taskStore }).buildResumed({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "in_progress" });
  });
  test("starts a build by preparing a worktree, ensuring runtime, and transitioning the task", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "getTask", input });
            return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
            return task({ id: input.taskId, status: input.status });
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
    const bootstrap = await Effect.runPromise(
      createTaskService({
        taskStore,
        gitPort: createBuildStartGitPort({ calls }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        systemCommands: createBuildSystemCommands(calls),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: ["bun test"], postComplete: [] },
          worktreeCopyPaths: [".env"],
        }),
      }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
    );
    expect(bootstrap).toEqual({
      runtimeKind: "opencode",
      workingDirectory: "/worktrees/repo/task-1",
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        { type: "canonicalizePath", path: "/repo" },
        { type: "isGitRepository", path: "/repo" },
        { type: "getTask", input: { repoPath: "/repo", taskId: "task-1" } },
        { type: "ensureDirectory", path: "/worktrees/repo" },
        { type: "referenceExists", workingDir: "/repo", reference: "origin/main" },
        {
          type: "createWorktree",
          repoPath: "/repo",
          worktreePath: "/worktrees/repo/task-1",
          branch: "odt/task-1-task-1",
          createBranch: true,
          startPoint: "origin/main",
        },
        {
          type: "configureBranchUpstream",
          repoPath: "/repo",
          worktreePath: "/worktrees/repo/task-1",
          branch: "odt/task-1-task-1",
          upstreamRemote: "origin",
        },
        {
          type: "copyConfiguredPaths",
          repoPath: "/repo",
          worktreePath: "/worktrees/repo/task-1",
          relativePaths: [".env"],
        },
        {
          command: "bun",
          args: ["test"],
          options: { cwd: "/worktrees/repo/task-1", timeoutMs: 300_000 },
        },
        {
          type: "ensureRuntime",
          input: expect.objectContaining({
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo",
          }),
        },
        {
          type: "transition",
          input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
        },
      ]),
    );
  });
  test("rolls back the build worktree when pre-start hooks fail", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list");
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "getTask", input });
            return task({ id: "task-1", title: "Task 1", status: "ready_for_dev" });
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
          taskStore,
          gitPort: createBuildStartGitPort({ calls }),
          runtimeDefinitionsService: createRuntimeDefinitionsService(),
          runtimeRegistry: createBuildStartRuntimeRegistry(calls),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          systemCommands: createBuildSystemCommands(calls, false),
          worktreeFiles: createBuildStartWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: ["bun test"], postComplete: [] },
          }),
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
      ),
    ).rejects.toThrow("Worktree setup script command failed: bun test");
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          command: "bun",
          args: ["test"],
          options: { cwd: "/worktrees/repo/task-1", timeoutMs: 300_000 },
        },
        {
          type: "deleteReference",
          repoPath: "/repo",
          reference: "refs/remotes/origin/odt/task-1-task-1",
        },
        {
          type: "removeWorktree",
          repoPath: "/repo",
          worktreePath: "/worktrees/repo/task-1",
          force: true,
        },
        {
          type: "deleteLocalBranch",
          repoPath: "/repo",
          branch: "odt/task-1-task-1",
          force: true,
        },
      ]),
    );
  });
  test("completes a build into AI review and runs post-complete hooks in the builder worktree", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "ai_review" });
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1", status: "in_progress", aiReviewEnabled: true })];
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
    const existingPaths = new Set(["/repo", "/worktrees/repo/task-1"]);
    const service = createTaskService({
      taskStore,
      settingsConfig: createBuildSettingsConfig(existingPaths),
      systemCommands: createBuildSystemCommands(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { preStart: [], postComplete: ["sh -lc 'printf cleanup'"] },
      }),
    });
    const completed = await Effect.runPromise(
      service.buildCompleted({
        repoPath: "/repo",
        taskId: "task-1",
        summary: "Done",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        command: "sh",
        args: ["-lc", "printf cleanup"],
        options: { cwd: "/worktrees/repo/task-1", timeoutMs: 300_000 },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "ai_review" },
      },
    ]);
    expect(completed).toMatchObject({ id: "task-1", status: "ai_review" });
  });
  test("completes a build into human review when QA is already approved", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({
                id: "task-1",
                status: "blocked",
                aiReviewEnabled: true,
                documentSummary: {
                  spec: { has: false },
                  plan: { has: false },
                  qaReport: { has: true, verdict: "approved" },
                },
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
      transitionTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "transition", input });
            return task({ id: "task-1", status: "human_review" });
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
          taskStore,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          systemCommands: createBuildSystemCommands(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: ["  "] },
          }),
        }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "human_review" },
      },
    ]);
  });
  test("blocks build completion when a post-complete hook fails", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1", status: "in_progress", aiReviewEnabled: false })];
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
          taskStore,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          systemCommands: createBuildSystemCommands(calls, false),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: ["sh -lc 'echo cleanup failed >&2; exit 1'"] },
          }),
        }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).rejects.toThrow("Worktree cleanup script command failed");
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        command: "sh",
        args: ["-lc", "echo cleanup failed >&2; exit 1"],
        options: { cwd: "/worktrees/repo/task-1", timeoutMs: 300_000 },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "blocked" },
      },
    ]);
  });
  test("reports blocked build completion as partial progress", async () => {
    const transitions: string[] = [];
    const taskStore: TaskStorePort = {
      listTasks: () =>
        Effect.succeed([task({ id: "task-1", status: "in_progress", aiReviewEnabled: false })]),
      transitionTask: (input) => {
        transitions.push(input.status);
        return Effect.succeed(task({ id: "task-1", status: input.status }));
      },
    };

    const result = await Effect.runPromise(
      createTaskServiceWithMutationProgress({
        taskStore,
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        systemCommands: createBuildSystemCommands([], false),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { preStart: [], postComplete: ["sh -lc 'exit 1'"] },
        }),
      })
        .buildCompleted({ repoPath: "/repo", taskId: "task-1" })
        .pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(transitions).toEqual(["blocked"]);
    expect(result.operation).toBe("build-completed");
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure.message).toContain("Worktree cleanup script command failed");
  });
  test("returns review tasks unchanged from duplicate build completion", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ id: "task-1", status: "human_review" })];
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
          taskStore,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          systemCommands: createBuildSystemCommands([]),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { preStart: [], postComplete: ["sh -lc 'exit 1'"] },
          }),
        }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });
  });
  test("records approved QA and moves the task to human review", async () => {
    const calls: unknown[] = [];
    const taskStore = createQaOutcomeTaskStore({
      calls,
      currentStatus: "ai_review",
      resultTask: taskWithQaReport({
        status: "human_review",
        verdict: "approved",
      }),
    });
    const approved = await Effect.runPromise(
      createTaskService({ taskStore }).qaApproved({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "Looks good",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "qa",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "human_review",
          markdown: "Looks good",
          verdict: "approved",
        },
      },
    ]);
    expect(approved).toMatchObject({
      id: "task-1",
      status: "human_review",
      agentWorkflows: { qa: { completed: true } },
    });
  });

  test("records approved QA from a blocked task", async () => {
    const calls: unknown[] = [];
    const taskStore = createQaOutcomeTaskStore({
      calls,
      currentStatus: "blocked",
      resultTask: taskWithQaReport({
        status: "human_review",
        verdict: "approved",
      }),
    });
    const approved = await Effect.runPromise(
      createTaskService({ taskStore }).qaApproved({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "Looks good",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "qa",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "human_review",
          markdown: "Looks good",
          verdict: "approved",
        },
      },
    ]);
    expect(approved).toMatchObject({
      id: "task-1",
      status: "human_review",
      agentWorkflows: { qa: { completed: true } },
    });
  });
  test("records rejected QA and moves the task back to in progress", async () => {
    const calls: unknown[] = [];
    const taskStore = createQaOutcomeTaskStore({
      calls,
      currentStatus: "human_review",
      resultTask: taskWithQaReport({
        status: "in_progress",
        verdict: "rejected",
      }),
    });
    const rejected = await Effect.runPromise(
      createTaskService({ taskStore }).qaRejected({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "Needs work",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "qa",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "in_progress",
          markdown: "Needs work",
          verdict: "rejected",
        },
      },
    ]);
    expect(rejected).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_qa"]),
    });
  });

  test("records rejected QA from a blocked task", async () => {
    const calls: unknown[] = [];
    const taskStore = createQaOutcomeTaskStore({
      calls,
      currentStatus: "blocked",
      resultTask: taskWithQaReport({
        status: "in_progress",
        verdict: "rejected",
      }),
    });
    const rejected = await Effect.runPromise(
      createTaskService({ taskStore }).qaRejected({
        repoPath: "/repo",
        taskId: "task-1",
        markdown: "Still needs work",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "qa",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "in_progress",
          markdown: "Still needs work",
          verdict: "rejected",
        },
      },
    ]);
    expect(rejected).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_qa"]),
    });
  });
  test("rejects QA outcomes outside blocked or review statuses before persisting", async () => {
    const taskStore: TaskStorePort = {
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [task({ id: "task-1", status: "in_progress" })];
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
            throw new Error("should not persist QA");
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
        createTaskService({ taskStore }).qaApproved({
          repoPath: "/repo",
          taskId: "task-1",
          markdown: "Looks good",
        }),
      ),
    ).rejects.toThrow("QA outcomes are only allowed from blocked, ai_review, or human_review");
  });
  test("requests human changes after checking direct merge metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              spec: { markdown: "" },
              plan: { markdown: "" },
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
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
            return task({ id: "task-1", status: "human_review" });
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
            return task({ id: "task-1", status: "in_progress" });
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
            throw new Error("should not list");
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
    const reopened = await Effect.runPromise(
      createTaskService({ taskStore }).humanRequestChanges({
        repoPath: "/repo",
        taskId: "task-1",
        note: "Please adjust",
      }),
    );
    expect(calls).toEqual([
      { type: "metadata", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress" },
      },
    ]);
    expect(reopened).toMatchObject({
      id: "task-1",
      status: "in_progress",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
  });
  test("blocks human change requests when direct merge metadata is pending", async () => {
    const taskStore: TaskStorePort = {
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
            return {
              spec: { markdown: "" },
              plan: { markdown: "" },
              directMerge: {
                method: "merge_commit",
                sourceBranch: "odt/task-1",
                targetBranch: { remote: "origin", branch: "main" },
                mergedAt: "2026-05-10T00:00:00.000Z",
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
      getTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not load task");
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
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not list");
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
        createTaskService({ taskStore }).humanRequestChanges({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).rejects.toThrow("local direct merge");
  });
  test("human approval closes review tasks", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1", status: "human_review" })];
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
            return task({ id: "task-1", status: "closed" });
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
    const closed = await Effect.runPromise(
      createTaskService({
        devServerService: createDirectMergeDevServerService(calls),
        gitPort: createBuildStartGitPort({ calls }),
        taskStore,
        terminalService: {
          acquireTaskCleanup(input) {
            return Effect.acquireRelease(
              Effect.sync(() => {
                calls.push({ type: "acquireTerminalCleanup", input });
                return { closedTerminalIds: ["terminal-1"] };
              }),
              () =>
                Effect.sync(() => {
                  calls.push({ type: "releaseTerminalCleanup" });
                }),
            );
          },
        },
      }).humanApprove({ repoPath: "/repo", taskId: "task-1" }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "canonicalizePath", path: "/repo" },
      {
        type: "acquireTerminalCleanup",
        input: { repoPath: "/repo", taskIds: ["task-1"] },
      },
      { type: "stopDevServers", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "transition", input: { repoPath: "/repo", taskId: "task-1", status: "closed" } },
      { type: "releaseTerminalCleanup" },
    ]);
    expect(closed).toMatchObject({
      id: "task-1",
      status: "closed",
      availableActions: ["view_details"],
    });
  });
});
