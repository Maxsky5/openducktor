import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import type { TaskSyncService } from "./sync/task-sync-service";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import type { TaskServiceWithMutationProgress } from "./task-service";

const taskCard = (): TaskCard => ({
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: false, completed: false },
    planner: { required: false, canSkip: true, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const fakeTaskService = (
  overrides: Partial<TaskServiceWithMutationProgress>,
): TaskServiceWithMutationProgress =>
  new Proxy(overrides, {
    get: (target, property) =>
      target[property as keyof TaskServiceWithMutationProgress] ??
      (() => Effect.die(`Unexpected call: ${String(property)}`)),
  }) as TaskServiceWithMutationProgress;
const sync = (
  events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }>,
): Pick<
  TaskSyncService,
  "publishExternalTaskCreated" | "publishTasksUpdated" | "syncRepoPullRequests"
> => ({
  publishExternalTaskCreated: () => Effect.void,
  publishTasksUpdated: (_repoPath, changes) =>
    Effect.sync(() => {
      events.push({ changes });
    }),
  syncRepoPullRequests: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
});

describe("createEventPublishingTaskService", () => {
  test("returns committed create and update results after publication acceptance failures", async () => {
    const reports: unknown[] = [];
    const taskSyncService: Pick<
      TaskSyncService,
      "publishExternalTaskCreated" | "publishTasksUpdated" | "syncRepoPullRequests"
    > = {
      publishExternalTaskCreated: () => Effect.void,
      publishTasksUpdated: () =>
        Effect.sync(() => {
          reports.push("acceptance failure reported");
        }),
      syncRepoPullRequests: () => Effect.succeed({ ran: true, changedTaskIds: [] }),
    };
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        createTask: () => Effect.succeed(taskCard()),
        updateTask: () => Effect.succeed(taskCard()),
      }),
      taskSyncService,
    });
    await expect(
      Effect.runPromise(
        service.createTask({
          repoPath: "/repo",
          task: { title: "Task", issueType: "task", aiReviewEnabled: true, priority: 2 },
        }),
      ),
    ).resolves.toEqual(taskCard());
    await expect(
      Effect.runPromise(service.updateTask({ repoPath: "/repo", taskId: "task-1", patch: {} })),
    ).resolves.toEqual(taskCard());
    expect(reports).toEqual(["acceptance failure reported"]);
  });
  test("publishes set-plan partial progress and preserves the original failure", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "set-plan",
      message: "replacement failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        setPlan: () =>
          Effect.fail(
            new TaskMutationProgressFailure({
              operation: "set-plan",
              changes: { taskIds: ["epic-1", "child-1"], removedTaskIds: ["child-1"] },
              failure,
            }),
          ),
      }),
      taskSyncService: sync(events),
    });
    await expect(
      Effect.runPromise(
        service
          .setPlan({
            repoPath: "/repo",
            taskId: "epic-1",
            markdown: "# Plan",
            subtasks: [],
            hasExplicitSubtasks: true,
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([
      { changes: { taskIds: ["epic-1", "child-1"], removedTaskIds: ["child-1"] } },
    ]);
  });
  test("publishes set-spec partial progress and preserves the original failure", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "set-spec",
      message: "transition failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        setSpec: () =>
          Effect.fail(
            new TaskMutationProgressFailure({
              operation: "set-spec",
              changes: { taskIds: ["task-1"], removedTaskIds: [] },
              failure,
            }),
          ),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([{ changes: { taskIds: ["task-1"], removedTaskIds: [] } }]);
  });
  test("does not publish an update when the task is missing", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "update-task",
      message: "Task task-1 not found",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        updateTask: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service.updateTask({ repoPath: "/repo", taskId: "task-1", patch: {} }).pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish when deleting a task fails", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "delete-task",
      message: "Delete failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        deleteTask: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .deleteTask({ repoPath: "/repo", taskId: "task-1", deleteSubtasks: false })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish when pull request detection fails", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "detect-pull-request",
      message: "Detection failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        detectPullRequest: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service.detectPullRequest({ repoPath: "/repo", taskId: "task-1" }).pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish ordinary set-plan failures", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "set-plan",
      message: "Plan update failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        setPlan: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .setPlan({
            repoPath: "/repo",
            taskId: "task-1",
            markdown: "# Plan",
            subtasks: [],
            hasExplicitSubtasks: true,
          })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("does not publish ordinary pre-write set-spec failures", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const failure = new HostOperationError({
      operation: "set-spec",
      message: "Document write failed",
    });
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        setSpec: () => Effect.fail(failure),
      }),
      taskSyncService: sync(events),
    });

    await expect(
      Effect.runPromise(
        service
          .setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "# Spec" })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(failure);
    expect(events).toEqual([]);
  });
  test("publishes deleted task ids as removed", async () => {
    const events: Array<{ changes: { taskIds: string[]; removedTaskIds: string[] } }> = [];
    const service = createEventPublishingTaskService({
      taskService: fakeTaskService({
        deleteTask: () =>
          Effect.succeed({
            ok: true,
            changes: { taskIds: ["epic-1", "child-1"], removedTaskIds: ["epic-1", "child-1"] },
          }),
      }),
      taskSyncService: sync(events),
    });
    await Effect.runPromise(
      service.deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true }),
    );
    expect(events).toEqual([
      { changes: { taskIds: ["epic-1", "child-1"], removedTaskIds: ["epic-1", "child-1"] } },
    ]);
  });
});
