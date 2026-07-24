import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createTaskService,
  createTaskServiceWithMutationProgress,
  type TaskStorePort,
  task,
} from "./test-support/task-workflow-harness";

describe("createTaskService planning", () => {
  test("sets spec markdown and promotes open tasks to spec_ready", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [task({ id: "task-1", status: "open", issueType: "feature" })];
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "test.effect",
              message: cause instanceof Error ? cause.message : String(cause),
              cause: cause,
            }),
        });
      },
      setSpecDocument(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setSpec", input });
            return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 1 };
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
            return task({ id: "task-1", status: "spec_ready", issueType: "feature" });
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
        createTaskService({ taskStore }).setSpec({
          repoPath: "/repo",
          taskId: "task-1",
          markdown: "# Spec",
        }),
      ),
    ).resolves.toEqual({
      markdown: "# Spec",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 1,
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "setSpec", input: { repoPath: "/repo", taskId: "task-1", markdown: "# Spec" } },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "task-1", status: "spec_ready" },
      },
    ]);
  });
  test("reports spec transition failures after writing a document as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.transition-task",
      message: "transition failed",
    });
    const taskStore: TaskStorePort = {
      listTasks: () =>
        Effect.succeed([task({ id: "task-1", issueType: "feature", status: "open" })]),
      setSpecDocument: (input) => Effect.succeed({ markdown: input.markdown, revision: 1 }),
      transitionTask: () => Effect.fail(failure),
    };

    const result = await Effect.runPromise(
      createTaskServiceWithMutationProgress({ taskStore })
        .setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" })
        .pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(result.operation).toBe("set-spec");
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure).toBe(failure);
  });
  test("sets an epic plan, replaces direct subtasks, and promotes to ready_for_dev", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      listTasks(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "list", input });
            return [
              task({ id: "epic-1", status: "spec_ready", issueType: "epic" }),
              task({ id: "old-child", status: "ready_for_dev", parentId: "epic-1" }),
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
      setPlanDocument(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPlan", input });
            return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 2 };
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
      createTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "create", input });
            return task({ id: `created-${input.task.title}`, parentId: "epic-1" });
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
            return task({ id: "epic-1", status: "ready_for_dev", issueType: "epic" });
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
    };
    await expect(
      Effect.runPromise(
        createTaskService({ taskStore }).setPlan({
          repoPath: "/repo",
          taskId: "epic-1",
          markdown: "# Plan",
          hasExplicitSubtasks: true,
          subtasks: [
            { title: " Build UI ", issueType: "task", priority: 1, description: " Ship it " },
            { title: "build ui", issueType: "task", priority: 1 },
            { title: "Wire API", issueType: "feature" },
          ],
        }),
      ),
    ).resolves.toEqual({
      document: {
        markdown: "# Plan",
        updatedAt: "2026-05-10T10:00:00.000Z",
        revision: 2,
      },
      changes: { taskIds: ["epic-1", "old-child"], removedTaskIds: ["old-child"] },
    });
    expect(calls).toEqual([
      { type: "list", input: { repoPath: "/repo" } },
      { type: "setPlan", input: { repoPath: "/repo", taskId: "epic-1", markdown: "# Plan" } },
      {
        type: "delete",
        input: { repoPath: "/repo", taskId: "old-child", deleteSubtasks: false },
      },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Build UI",
            issueType: "task",
            priority: 1,
            description: "Ship it",
            aiReviewEnabled: true,
            parentId: "epic-1",
          },
        },
      },
      {
        type: "create",
        input: {
          repoPath: "/repo",
          task: {
            title: "Wire API",
            issueType: "feature",
            priority: 2,
            description: undefined,
            aiReviewEnabled: true,
            parentId: "epic-1",
          },
        },
      },
      {
        type: "transition",
        input: { repoPath: "/repo", taskId: "epic-1", status: "ready_for_dev" },
      },
    ]);
  });
  test("saves plan documents without applying workflow transitions", async () => {
    const calls: unknown[] = [];
    const taskStore: TaskStorePort = {
      getTask(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "get", input });
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
      setPlanDocument(input) {
        return Effect.tryPromise({
          try: async () => {
            calls.push({ type: "setPlan", input });
            return { markdown: input.markdown, updatedAt: "2026-05-10T10:00:00.000Z", revision: 3 };
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
        createTaskService({ taskStore }).savePlanDocument({
          repoPath: "/repo",
          taskId: "task-1",
          markdown: "# Plan",
        }),
      ),
    ).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-05-10T10:00:00.000Z",
      revision: 3,
    });
    expect(calls).toEqual([
      { type: "get", input: { repoPath: "/repo", taskId: "task-1" } },
      { type: "setPlan", input: { repoPath: "/repo", taskId: "task-1", markdown: "# Plan" } },
    ]);
  });
  test("reports transition failures after writing a plan as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.transition-task",
      message: "transition failed",
    });
    const taskStore: TaskStorePort = {
      listTasks: () =>
        Effect.succeed([task({ id: "task-1", issueType: "feature", status: "spec_ready" })]),
      setPlanDocument: (input) => Effect.succeed({ markdown: input.markdown, revision: 1 }),
      transitionTask: () => Effect.fail(failure),
    };

    const result = await Effect.runPromise(
      createTaskServiceWithMutationProgress({ taskStore })
        .setPlan({
          repoPath: "/repo",
          taskId: "task-1",
          markdown: "# Plan",
          subtasks: [],
          hasExplicitSubtasks: false,
        })
        .pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(result.changes).toEqual({ taskIds: ["task-1"], removedTaskIds: [] });
    expect(result.failure).toBe(failure);
  });
  test("reports initial epic subtask replacement failures as partial progress", async () => {
    const failure = new HostOperationError({
      operation: "task-store.delete-task",
      message: "child delete failed",
    });
    const taskStore: TaskStorePort = {
      listTasks: () =>
        Effect.succeed([
          task({ id: "epic-1", issueType: "epic", status: "spec_ready" }),
          task({ id: "child-1", parentId: "epic-1" }),
        ]),
      setPlanDocument: (input) => Effect.succeed({ markdown: input.markdown, revision: 1 }),
      deleteTask: () => Effect.fail(failure),
    };

    const result = await Effect.runPromise(
      createTaskServiceWithMutationProgress({ taskStore })
        .setPlan({
          repoPath: "/repo",
          taskId: "epic-1",
          markdown: "# Plan",
          hasExplicitSubtasks: true,
          subtasks: [{ title: "Replacement", issueType: "task" }],
        })
        .pipe(Effect.flip),
    );

    if (!(result instanceof TaskMutationProgressFailure)) {
      throw new Error("Expected a TaskMutationProgressFailure");
    }
    expect(result.changes).toEqual({ taskIds: ["epic-1"], removedTaskIds: [] });
    expect(result.failure).toBe(failure);
  });
  test("publishes removed epic children when later replacement deletion fails", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task-store.delete-task",
      message: "second child delete failed",
    });
    let deletionCount = 0;
    const taskStore: TaskStorePort = {
      listTasks: () =>
        Effect.succeed([
          task({ id: "epic-1", issueType: "epic", status: "spec_ready" }),
          task({ id: "child-1", parentId: "epic-1" }),
          task({ id: "child-2", parentId: "epic-1" }),
        ]),
      setPlanDocument: (input) => Effect.succeed({ markdown: input.markdown, revision: 1 }),
      deleteTask: () => {
        deletionCount += 1;
        return deletionCount === 1 ? Effect.succeed(true) : Effect.fail(mutationFailure);
      },
    };
    const events: Array<{ taskIds: string[]; removedTaskIds: string[] }> = [];
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceWithMutationProgress({ taskStore }),
      taskSyncService: {
        publishExternalTaskCreated: () => Effect.void,
        publishTasksUpdated: (_repoPath, changes) =>
          Effect.sync(() => {
            events.push(changes);
          }),
        syncRepoPullRequests: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
      },
    });

    await expect(
      Effect.runPromise(
        service
          .setPlan({
            repoPath: "/repo",
            taskId: "epic-1",
            markdown: "# Plan",
            hasExplicitSubtasks: true,
            subtasks: [{ title: "Replacement", issueType: "task" }],
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(mutationFailure);
    expect(events).toEqual([{ taskIds: ["epic-1", "child-1"], removedTaskIds: ["child-1"] }]);
  });
});
