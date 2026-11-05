import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import {
  createBuildSettingsConfig,
  createBuildStartGitPort,
  createBuildSystemCommands,
  createBuildWorkspaceSettingsService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService build and review", () => {
  test.each(["in_progress", "ai_review", "human_review", "blocked"] as const)(
    "buildBlocked accepts %s and preserves task documents",
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
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: current.id,
        }),
      );
      expect(result.status).toBe("blocked");
      expect(result.artifactSummary).toEqual(current.artifactSummary);
      expect(transitions).toMatchObject(
        status === "blocked"
          ? []
          : [{ repoPath: "/repo", taskId: current.id, status: "blocked", cause: {} }],
      );
    },
  );

  test.each(["open", "spec_ready", "ready_for_dev", "closed"] as const)(
    "buildBlocked rejects %s without writing",
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
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: "task-1",
          }),
        ),
      ).rejects.toThrow(`build-blocked is not allowed for task task-1 (task) from ${status}`);
      expect(transitions).toMatchObject([]);
    },
  );

  test("blocks a build through the task store", async () => {
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
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
      }),
    );
    expect(calls).toMatchObject([
      { type: "list", input: { repoPath: "/repo" } },
      {
        type: "transition",
        input: {
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          status: "blocked",
          cause: {},
        },
      },
    ]);
    expect(blocked).toMatchObject({
      id: "task-1",
      status: "blocked",
      availableActions: expect.arrayContaining(["open_builder"]),
    });
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
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
      }),
    );
    expect(calls).toMatchObject([
      { type: "get", input: { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: {
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          status: "in_progress",
          cause: {},
        },
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
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "in_progress" });
  });
  test("completes a build into AI review without running the before worktree removal script", async () => {
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
      systemCommands: createBuildSystemCommands(calls, false),
      workspaceSettingsService: createBuildWorkspaceSettingsService({
        workspaceId: "repo",
        repoPath: "/repo",
        hooks: { beforeWorktreeRemoval: ["sh -lc 'printf cleanup'"] },
      }),
    });
    const completed = await Effect.runPromise(
      service.buildCompleted({
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
      }),
    );
    expect(calls).not.toContainEqual(expect.objectContaining({ command: "sh" }));
    expect(calls.at(-1)).toMatchObject({
      type: "transition",
      input: {
        repoPath: "/repo",
        taskId: "task-1",
        status: "ai_review",
        cause: { signal: "taskProgressedToAiReview" },
      },
    });
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
            hooks: { beforeWorktreeRemoval: ["  "] },
          }),
        }).buildCompleted({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toMatchObject({ id: "task-1", status: "human_review" });
    expect(calls).toMatchObject([
      { type: "list", input: { repoPath: "/repo" } },
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
            hooks: { beforeWorktreeRemoval: ["sh -lc 'exit 1'"] },
          }),
        }).buildCompleted({ workspaceId: "repo", repoPath: "/repo", taskId: "task-1" }),
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
        Effect.result(
          service.humanRequestChanges({
            workspaceId: "repo",
            repoPath: "/repo",
            taskId: current.id,
          }),
        ),
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "TaskPolicyError", code: "TASK_TRANSITION_NOT_ALLOWED" },
      });
      expect(transitions).toMatchObject([]);
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
      service.humanRequestChanges({ workspaceId: "repo", repoPath: "/repo", taskId: current.id }),
    );

    expect(result).toMatchObject({ id: current.id, status: "in_progress" });
    expect(transitions).toMatchObject([]);
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
        workspaceId: "repo",
        repoPath: "/repo",
        taskId: "task-1",
        note: "Please adjust",
      }),
    );
    expect(calls).toMatchObject([
      { type: "metadata", input: { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" } },
      { type: "get", input: { workspaceId: "repo", repoPath: "/repo", taskId: "task-1" } },
      {
        type: "transition",
        input: {
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
          status: "in_progress",
          cause: {},
        },
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
      getTask: () => Effect.succeed(task({ id: "task-1", status: "human_review" })),
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
          workspaceId: "repo",
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).rejects.toThrow("Task task-1 has a local direct merge that is not published.");
  });
});
