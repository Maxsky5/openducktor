import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TaskService } from "./task-service";
import {
  createAgentSessionRecord,
  createAgentSessionSettingsConfig,
  createAgentSessionTaskStore,
  createAgentSessionWorkspaceSettingsService,
  createTaskService,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService list and session reads", () => {
  test("loads tasks and enriches available actions and workflow state", async () => {
    const calls: unknown[] = [];
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
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return [
              task({
                id: "epic-1",
                issueType: "epic",
                status: "human_review",
                documentSummary: {
                  spec: { has: true, updatedAt: "2026-01-03T00:00:00Z" },
                  plan: { has: true, updatedAt: "2026-01-04T00:00:00Z" },
                  qaReport: { has: false, verdict: "not_reviewed" },
                },
              }),
              task({ id: "task-2", parentId: "epic-1" }),
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
    };
    const service = createTaskService({ taskStore });
    const tasks = await Effect.runPromise(
      service.listTasks({ repoPath: "/repo", doneVisibleDays: 3 }),
    );
    expect(calls).toEqual([{ repoPath: "/repo", doneVisibleDays: 3 }]);
    expect(tasks[0]).toMatchObject({
      id: "epic-1",
      availableActions: [
        "view_details",
        "set_spec",
        "set_plan",
        "qa_start",
        "open_builder",
        "reset_implementation",
        "reset_task",
        "human_request_changes",
      ],
      agentWorkflows: {
        spec: { required: true, canSkip: false, available: true, completed: true },
        planner: { required: true, canSkip: false, available: true, completed: true },
        builder: { required: true, canSkip: false, available: true, completed: true },
        qa: { required: true, canSkip: false, available: true, completed: false },
      },
    });
  });
  test("allows human approval only when an epic has no active direct subtasks", async () => {
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
      listTasks() {
        return Effect.tryPromise({
          try: async () => {
            return [
              task({
                id: "epic-1",
                issueType: "epic",
                status: "human_review",
              }),
              task({ id: "task-2", parentId: "epic-1", status: "closed" }),
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
    };
    const tasks = await Effect.runPromise(
      createTaskService({ taskStore }).listTasks({ repoPath: "/repo" }),
    );
    expect(tasks[0]?.availableActions).toContain("human_approve");
  });
  test("rejects invalid list command input before calling the service", async () => {
    const taskStore: TaskStorePort = {
      createTask() {
        return Effect.tryPromise({
          try: async () => {
            throw new Error("should not call store");
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
            throw new Error("should not call store");
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
            throw new Error("should not call store");
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
            throw new Error("should not call store");
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
            throw new Error("should not call store");
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
            throw new Error("should not call store");
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
    const { createTaskCommandHandlers } = await import(
      "../../interface/commands/task-command-handlers"
    );
    const service = createTaskService({ taskStore });
    const handlers = createTaskCommandHandlers(service as unknown as TaskService);
    expect(() =>
      handlers.tasks_list?.(
        { repoPath: "/repo", doneVisibleDays: -1 },
        { command: "tasks_list", args: { repoPath: "/repo", doneVisibleDays: -1 } },
      ),
    ).toThrow("doneVisibleDays must be greater than or equal to 0.");
  });
  test("loads task metadata through the task store", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return {
              spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
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
        createTaskService({ taskStore }).getTaskMetadata({
          repoPath: "/repo",
          taskId: "task-1",
        }),
      ),
    ).resolves.toEqual({
      spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
      plan: { markdown: "# Plan" },
      agentSessions: [],
    });
    expect(calls).toEqual([{ repoPath: "/repo", taskId: "task-1" }]);
  });
  test("loads host-compatible document and agent-session read commands from metadata", async () => {
    const calls: unknown[] = [];
    const session = createAgentSessionRecord();
    const taskStore: TaskStorePort = {
      getTaskMetadata(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push(input);
            return {
              spec: { markdown: "# Spec", updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 },
              plan: { markdown: "# Plan", updatedAt: "2026-05-10T11:00:00.000Z", revision: 2 },
              qaReport: {
                markdown: "# QA",
                verdict: "approved",
                updatedAt: "2026-05-10T12:00:00.000Z",
                revision: 3,
              },
              agentSessions: [session],
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
    const service = createTaskService({ taskStore });
    await expect(
      Effect.runPromise(service.specGet({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 1,
    });
    await expect(
      Effect.runPromise(service.planGet({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T11:00:00.000Z",
      revision: 2,
    });
    await expect(
      Effect.runPromise(service.qaGetReport({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual({
      markdown: "# QA",
      updatedAt: "2026-05-10T12:00:00.000Z",
      revision: 3,
    });
    await expect(
      Effect.runPromise(service.agentSessionsList({ repoPath: "/repo", taskId: "task-1" })),
    ).resolves.toEqual([session]);
    expect(calls).toEqual([
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
    ]);
  });
  test("returns an empty QA document when no report is present", async () => {
    const taskStore: TaskStorePort = {
      getTaskMetadata() {
        return Effect.tryPromise({
          try: async () => {
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
        createTaskService({ taskStore }).qaGetReport({ repoPath: "/repo", taskId: "task-1" }),
      ),
    ).resolves.toEqual({ markdown: "" });
  });
  test("upserts an agent session after validating a repository working directory", async () => {
    const calls: unknown[] = [];
    const taskStore = createAgentSessionTaskStore(calls);
    const service = createTaskService({
      taskStore,
      settingsConfig: createAgentSessionSettingsConfig(new Set(["/repo", "/repo/task-1"])),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({
            workingDirectory: "/repo/task-1",
          }),
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([
      {
        repoPath: "/repo",
        taskId: "task-1",
        session: createAgentSessionRecord({ workingDirectory: "/repo/task-1" }),
      },
    ]);
  });
  test("deletes one exact durable agent session identity", async () => {
    const calls: unknown[] = [];
    const taskStore = {
      deleteAgentSession(input: unknown) {
        return Effect.sync(() => {
          calls.push(input);
          return true;
        });
      },
    } as TaskStorePort;
    const service = createTaskService({ taskStore });
    const identity = {
      externalSessionId: "session-1",
      runtimeKind: "opencode" as const,
      workingDirectory: "/repo/task-1",
    };

    await expect(
      Effect.runPromise(
        service.agentSessionDelete({ repoPath: "/repo", taskId: "task-1", identity }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([{ repoPath: "/repo", taskId: "task-1", identity }]);
  });
  test("upserts an agent session from the configured worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/worktrees/repo", "/worktrees/repo/task-1"]),
      ),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({ workingDirectory: "/worktrees/repo/task-1" }),
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });
  test("upserts an agent session from the repository default worktree base", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(
        new Set(["/repo", "/repo-default-worktrees/repo", "/repo-default-worktrees/repo/task-1"]),
      ),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({
            workingDirectory: "/repo-default-worktrees/repo/task-1",
          }),
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });
  test("rejects agent sessions outside the repository and worktree bases", async () => {
    const calls: unknown[] = [];
    const service = createTaskService({
      taskStore: createAgentSessionTaskStore(calls),
      settingsConfig: createAgentSessionSettingsConfig(new Set(["/repo", "/outside/task-1"])),
      workspaceSettingsService: createAgentSessionWorkspaceSettingsService({
        repoPath: "/repo",
        effectiveWorktreeBasePath: "/worktrees/repo",
      }),
    });
    await expect(
      Effect.runPromise(
        service.agentSessionUpsert({
          repoPath: "/repo",
          taskId: "task-1",
          session: createAgentSessionRecord({ workingDirectory: "/outside/task-1" }),
        }),
      ),
    ).rejects.toThrow("Agent session workingDirectory must stay inside repository");
    expect(calls).toEqual([]);
  });
});
