import { builtinTaskWorkflows } from "../../test-support/task-workflows";
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
  createBuildWorktreeActions,
  createRuntimeDefinitionsService,
  createTaskService,
  createTaskServiceWithMutationProgress,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

const installAction = {
  items: [
    {
      id: "install",
      icon: "build" as const,
      name: "Install",
      command: "bun install",
      runOnWorktreeCreate: true,
      waitBeforeAgentStart: true,
    },
  ],
  defaultActionId: "install",
};

describe("createTaskService build and review", () => {
  test.each(["in_progress", "ai_review", "human_review", "blocked"] as const)(
    "build_blocked accepts %s and preserves task documents",
    async (status) => {
      const current = task({
        id: "task-1",
        status,
        artifactSummary: {
          spec: { present: true },
          plan: { present: true },
          qaReport: { present: true, verdict: "approved" },
        },
      });
      const transitions: unknown[] = [];
      const taskStore: TaskStorePort = {
        listTasks: () => Effect.succeed([current]),
        transitionTask: (input) => {
          transitions.push(input);
          return Effect.succeed({ ...current, status: "blocked" as const });
        },
      };
      const result = await Effect.runPromise(
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          taskStore,
          gitPort: createBuildStartGitPort({ calls: [] }),
        }).buildBlocked({
          repoPath: "/repo",
          taskId: current.id,
          reason: "Needs clarification",
        }),
      );
      expect(result.status).toBe("blocked");
      expect(result.artifactSummary).toEqual(current.artifactSummary);
      expect(transitions).toEqual(
        status === "blocked"
          ? []
          : [{ repoPath: "/repo", taskId: current.id, status: "blocked", cause: {} }],
      );
    },
  );

  test.each(["open", "spec_ready", "ready_for_dev", "closed"] as const)(
    "build_blocked rejects %s without writing",
    async (status) => {
      const transitions: unknown[] = [];
      const taskStore: TaskStorePort = {
        listTasks: () => Effect.succeed([task({ id: "task-1", status })]),
        transitionTask: (input) => {
          transitions.push(input);
          return Effect.succeed(task({ status: "blocked" }));
        },
      };
      await expect(
        Effect.runPromise(
          createTaskService({
            taskWorkflows: builtinTaskWorkflows,
            taskStore,
            gitPort: createBuildStartGitPort({ calls: [] }),
          }).buildBlocked({
            repoPath: "/repo",
            taskId: "task-1",
            reason: "Needs clarification",
          }),
        ),
      ).rejects.toThrow(`build-blocked is not allowed for task task-1 (task) from ${status}`);
      expect(transitions).toEqual([]);
    },
  );

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
      createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore,
        gitPort: createBuildStartGitPort({ calls: [] }),
      }).buildBlocked({
        repoPath: "/repo",
        taskId: "task-1",
        reason: " Waiting on API ",
      }),
    );
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "blocked", cause: {} },
      },
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
        createTaskService({
          taskWorkflows: builtinTaskWorkflows,
          taskStore,
          gitPort: createBuildStartGitPort({ calls: [] }),
        }).buildBlocked({
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
      createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).buildResumed({
        repoPath: "/repo",
        taskId: "task-1",
      }),
    );
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress", cause: {} },
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
        createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).buildResumed({
          repoPath: "/repo",
          taskId: "task-1",
        }),
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
        taskWorkflows: builtinTaskWorkflows,
        taskStore,
        gitPort: createBuildStartGitPort({ calls }),
        runtimeDefinitionsService: createRuntimeDefinitionsService(),
        runtimeRegistry: createBuildStartRuntimeRegistry(calls),
        settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
        worktreeActions: createBuildWorktreeActions(calls),
        worktreeFiles: createBuildStartWorktreeFiles(calls),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: [] },
          actions: installAction,
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
          type: "runWorktreeActions",
          context: { repoPath: "/repo", taskId: "task-1" },
          worktreePath: "/worktrees/repo/task-1",
          actions: installAction,
        },
        { type: "requireRuntime", runtimeKind: "opencode" },
        {
          type: "transition",
          input: { repoPath: "/repo", taskId: "task-1", status: "in_progress", cause: {} },
        },
      ]),
    );
  });
  test("rolls back the task worktree when a worktree action fails", async () => {
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
          taskStore,
          gitPort: createBuildStartGitPort({ calls }),
          runtimeDefinitionsService: createRuntimeDefinitionsService(),
          runtimeRegistry: createBuildStartRuntimeRegistry(calls),
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          worktreeActions: createBuildWorktreeActions(calls, {
            failMessage: 'Worktree action "Install" exited with code 1.',
          }),
          worktreeFiles: createBuildStartWorktreeFiles(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: [] },
            actions: installAction,
          }),
        }).buildStart({ repoPath: "/repo", taskId: "task-1", runtimeKind: "opencode" }),
      ),
    ).rejects.toThrow('Worktree action "Install" exited with code 1.');
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          type: "runWorktreeActions",
          context: { repoPath: "/repo", taskId: "task-1" },
          worktreePath: "/worktrees/repo/task-1",
          actions: installAction,
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
  test("completes a build into AI review and runs post-complete hooks in the task worktree", async () => {
    const calls: unknown[] = [];
    const updatedTask = task({ id: "task-1", status: "ai_review" });
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
      taskWorkflows: builtinTaskWorkflows,
      taskStore,
      settingsConfig: createBuildSettingsConfig(existingPaths),
      systemCommands: createBuildSystemCommands(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: ["sh -lc 'printf cleanup'"] },
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
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "ai_review",
          cause: { signal: "taskProgressedToAiReview" },
        },
      },
    ]);
    expect(completed).toMatchObject({ id: "task-1", status: "ai_review" });
  });
  test("does not run post-complete hooks outside the task worktree", async () => {
    const taskId = "../elsewhere";
    const calls: unknown[] = [];
    const current = task({ id: taskId, status: "in_progress" });
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([current]),
      transitionTask: (input) => {
        calls.push({ type: "transition", input });
        return Effect.succeed({ ...current, status: input.status });
      },
    };
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore,
      settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/../elsewhere"])),
      systemCommands: createBuildSystemCommands(calls),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { postComplete: ["sh -lc 'printf cleanup'"] },
      }),
    });

    await expect(
      Effect.runPromise(service.buildCompleted({ repoPath: "/repo", taskId })),
    ).rejects.toThrow("Task ID must name one worktree directory");
    expect(calls).not.toContainEqual(expect.objectContaining({ command: "sh" }));
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
                artifactSummary: {
                  spec: { present: false },
                  plan: { present: false },
                  qaReport: { present: true, verdict: "approved" },
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
          taskStore,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          systemCommands: createBuildSystemCommands(calls),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: ["  "] },
          }),
        }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: {
          repoPath: "/repo",
          taskId: "task-1",
          status: "human_review",
          cause: { signal: "taskProgressedToHumanReview", sourceRole: "build" },
        },
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
          taskStore,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
          systemCommands: createBuildSystemCommands(calls, false),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: ["sh -lc 'echo cleanup failed >&2; exit 1'"] },
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
        input: { repoPath: "/repo", taskId: "task-1", status: "blocked", cause: {} },
      },
    ]);
  });
  test("reports blocked build completion as partial progress", async () => {
    const transitions: string[] = [];
    const taskStore: TaskStorePort = {
      listTasks: () => Effect.succeed([task({ id: "task-1", status: "in_progress" })]),
      transitionTask: (input) => {
        transitions.push(input.status);
        return Effect.succeed(task({ id: "task-1", status: input.status }));
      },
    };

    const result = await Effect.runPromise(
      createTaskServiceWithMutationProgress({
        taskWorkflows: builtinTaskWorkflows,
        taskStore,
        settingsConfig: createBuildSettingsConfig(new Set(["/repo", "/worktrees/repo/task-1"])),
        systemCommands: createBuildSystemCommands([], false),
        workspaceSettingsService: createBuildWorkspaceSettingsService({
          workspaceId: "repo",
          repoPath: "/repo",
          hooks: { postComplete: ["sh -lc 'exit 1'"] },
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
          taskStore,
          settingsConfig: createBuildSettingsConfig(new Set(["/repo"])),
          systemCommands: createBuildSystemCommands([]),
          workspaceSettingsService: createBuildWorkspaceSettingsService({
            workspaceId: "repo",
            repoPath: "/repo",
            hooks: { postComplete: ["sh -lc 'exit 1'"] },
          }),
        }).buildCompleted({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });
  });
  test.each(["open", "spec_ready", "ready_for_dev", "blocked", "closed"] as const)(
    "human_request_changes rejects %s without writing",
    async (status) => {
      const current = task({ id: "task-1", status });
      const transitions: unknown[] = [];
      const service = createTaskService({
        taskWorkflows: builtinTaskWorkflows,
        taskStore: {
          getTaskMetadata: () =>
            Effect.succeed({
              artifacts: {},
              agentSessions: [],
            }),
          getTask: () => Effect.succeed(current),
          transitionTask: (input) =>
            Effect.sync(() => {
              transitions.push(input);
              return { ...current, status: input.status };
            }),
        },
      });

      const result = await Effect.runPromise(
        Effect.result(service.humanRequestChanges({ repoPath: "/repo", taskId: current.id })),
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "TaskPolicyError", code: "TASK_TRANSITION_NOT_ALLOWED" },
      });
      expect(transitions).toEqual([]);
    },
  );

  test("human_request_changes returns an in-progress task without writing", async () => {
    const current = task({ id: "task-1", status: "in_progress" });
    const transitions: unknown[] = [];
    const service = createTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskStore: {
        getTaskMetadata: () =>
          Effect.succeed({
            artifacts: {},
            agentSessions: [],
          }),
        getTask: () => Effect.succeed(current),
        transitionTask: (input) =>
          Effect.sync(() => {
            transitions.push(input);
            return { ...current, status: input.status };
          }),
      },
    });

    const result = await Effect.runPromise(
      service.humanRequestChanges({ repoPath: "/repo", taskId: current.id }),
    );

    expect(result).toMatchObject({ id: current.id, status: "in_progress" });
    expect(transitions).toEqual([]);
  });

  test("requests human changes after checking direct merge metadata", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "metadata", input });
            return {
              artifacts: {},
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
      createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).humanRequestChanges({
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
        input: { repoPath: "/repo", taskId: "task-1", status: "in_progress", cause: {} },
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
        return Effect.sync(() => {
          return {
            artifacts: {},
            directMerge: {
              method: "merge_commit",
              sourceBranch: "odt/task-1",
              targetBranch: { remote: "origin", branch: "main" },
              mergedAt: "2026-05-10T00:00:00.000Z",
            },
            agentSessions: [],
          };
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
        createTaskService({ taskWorkflows: builtinTaskWorkflows, taskStore }).humanRequestChanges({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).rejects.toThrow("local direct merge");
  });
});
