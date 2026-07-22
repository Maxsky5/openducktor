import { describe, expect, test } from "bun:test";
import type { TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { RepoPullRequestSyncPartialFailure } from "./repo-pull-request-sync-partial-failure";
import type { TaskSyncService } from "./sync/task-sync-service";
import type { TaskService } from "./task-service";

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
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z",
});

const createTaskServiceFake = (overrides: Partial<TaskService>): TaskService =>
  new Proxy(overrides, {
    get(target, property) {
      const method = target[property as keyof TaskService];
      if (method) {
        return method;
      }
      return () => Effect.die(`Unexpected TaskService call: ${String(property)}`);
    },
  }) as TaskService;

const createPublisher = () => {
  const calls: Array<{ kind: "created" | "updated"; repoPath: string; taskIds: string[] }> = [];
  const taskSyncService: Pick<
    TaskSyncService,
    "publishExternalTaskCreated" | "publishTasksUpdated"
  > = {
    publishExternalTaskCreated(repoPath, taskId) {
      return Effect.sync(() => {
        calls.push({ kind: "created", repoPath, taskIds: [taskId] });
      });
    },
    publishTasksUpdated(repoPath, taskIds) {
      return Effect.sync(() => {
        calls.push({ kind: "updated", repoPath, taskIds });
      });
    },
  };
  return { calls, taskSyncService };
};

describe("createEventPublishingTaskService", () => {
  test("publishes external_task_created after a successful task create", async () => {
    const { calls, taskSyncService } = createPublisher();
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({ createTask: () => Effect.succeed(taskCard()) }),
      taskSyncService,
    });

    await expect(
      Effect.runPromise(
        service.createTask({
          repoPath: "/repo",
          task: {
            title: "Task",
            description: "",
            issueType: "task",
            aiReviewEnabled: true,
            priority: 2,
            labels: [],
          },
        }),
      ),
    ).resolves.toEqual(taskCard());
    expect(calls).toEqual([{ kind: "created", repoPath: "/repo", taskIds: ["task-1"] }]);
  });

  test("publishes one tasks_updated event for a task mutation", async () => {
    const { calls, taskSyncService } = createPublisher();
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({ setSpec: () => Effect.succeed({ markdown: "spec" }) }),
      taskSyncService,
    });

    await Effect.runPromise(
      service.setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "spec" }),
    );
    expect(calls).toEqual([{ kind: "updated", repoPath: "/repo", taskIds: ["task-1"] }]);
  });

  test("publishes after a mutation failure and preserves the mutation failure", async () => {
    const { calls, taskSyncService } = createPublisher();
    const mutationFailure = new HostOperationError({
      operation: "task.set-spec",
      message: "write failed",
    });
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({ setSpec: () => Effect.fail(mutationFailure) }),
      taskSyncService,
    });

    await expect(
      Effect.runPromise(
        service
          .setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "spec" })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(mutationFailure);
    expect(calls).toEqual([{ kind: "updated", repoPath: "/repo", taskIds: ["task-1"] }]);
  });

  test("reports both mutation and publication failures", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task.set-spec",
      message: "write failed",
    });
    const publicationFailure = new HostOperationError({
      operation: "task-sync.publish-event",
      message: "event failed",
    });
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({ setSpec: () => Effect.fail(mutationFailure) }),
      taskSyncService: {
        publishExternalTaskCreated: () => Effect.void,
        publishTasksUpdated: () => Effect.fail(publicationFailure),
      },
    });

    await expect(
      Effect.runPromise(
        service
          .setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "spec" })
          .pipe(Effect.flip),
      ),
    ).resolves.toMatchObject({
      operation: "task-event-publishing.set-spec",
      cause: mutationFailure,
      details: { publicationFailure },
    });
  });

  test("propagates publisher failures after successful mutations", async () => {
    const publicationFailure = new HostOperationError({
      operation: "task-sync.publish-event",
      message: "event failed",
    });
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({ setSpec: () => Effect.succeed({ markdown: "spec" }) }),
      taskSyncService: {
        publishExternalTaskCreated: () => Effect.void,
        publishTasksUpdated: () => Effect.fail(publicationFailure),
      },
    });

    await expect(
      Effect.runPromise(
        service
          .setSpec({ repoPath: "/repo", taskId: "task-1", markdown: "spec" })
          .pipe(Effect.flip),
      ),
    ).resolves.toBe(publicationFailure);
  });

  test("does not publish for reads or agent session mutations", async () => {
    const { calls, taskSyncService } = createPublisher();
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        listTasks: () => Effect.succeed([]),
        agentSessionUpsert: () => Effect.succeed(true),
      }),
      taskSyncService,
    });

    await Effect.runPromise(service.listTasks({ repoPath: "/repo" }));
    await Effect.runPromise(
      service.agentSessionUpsert({
        repoPath: "/repo",
        taskId: "task-1",
        session: {
          role: "build",
          externalSessionId: "session-1",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
          startedAt: "2026-07-22T00:00:00.000Z",
          selectedModel: null,
        },
      }),
    );
    expect(calls).toEqual([]);
  });

  test("does not publish conditional delivery no-ops", async () => {
    const { calls, taskSyncService } = createPublisher();
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        detectPullRequest: () =>
          Effect.succeed({ outcome: "not_found", sourceBranch: "task", targetBranch: "main" }),
        directMerge: () =>
          Effect.succeed({
            outcome: "conflicts",
            conflict: {
              operation: "direct_merge_merge_commit",
              targetBranch: "main",
              conflictedFiles: [],
              output: "conflict",
            },
          }),
      }),
      taskSyncService,
    });

    await Effect.runPromise(service.detectPullRequest({ repoPath: "/repo", taskId: "task-1" }));
    await Effect.runPromise(
      service.directMerge({
        repoPath: "/repo",
        taskId: "task-1",
        input: { mergeMethod: "merge_commit" },
      }),
    );
    expect(calls).toEqual([]);
  });

  test("leaves detailed repo sync unwrapped and publishes the manual sync's changed ids once", async () => {
    const { calls, taskSyncService } = createPublisher();
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed: () =>
          Effect.succeed({ ran: true, changedTaskIds: ["task-1", "task-1", "task-2"] }),
      }),
      taskSyncService,
    });

    await Effect.runPromise(service.repoPullRequestSyncDetailed({ repoPath: "/repo" }));
    expect(calls).toEqual([]);
    await expect(
      Effect.runPromise(service.repoPullRequestSync({ repoPath: "/repo" })),
    ).resolves.toEqual({
      ok: true,
    });
    expect(calls).toEqual([{ kind: "updated", repoPath: "/repo", taskIds: ["task-1", "task-2"] }]);
  });

  test("publishes partial repo sync progress once and fails with the original failure", async () => {
    const { calls, taskSyncService } = createPublisher();
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "second task failed",
    });
    const partialFailure = new RepoPullRequestSyncPartialFailure({
      changedTaskIds: ["task-1", "task-1", "task-2"],
      failure: mutationFailure,
    });
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed: () => Effect.fail(partialFailure),
      }),
      taskSyncService,
    });

    await expect(
      Effect.runPromise(service.repoPullRequestSync({ repoPath: "/repo" }).pipe(Effect.flip)),
    ).resolves.toBe(mutationFailure);
    expect(calls).toEqual([{ kind: "updated", repoPath: "/repo", taskIds: ["task-1", "task-2"] }]);
  });

  test("combines partial repo sync and publication failures", async () => {
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "second task failed",
    });
    const publicationFailure = new HostOperationError({
      operation: "task-sync.publish-event",
      message: "event failed",
    });
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed: () =>
          Effect.fail(
            new RepoPullRequestSyncPartialFailure({
              changedTaskIds: ["task-1"],
              failure: mutationFailure,
            }),
          ),
      }),
      taskSyncService: {
        publishExternalTaskCreated: () => Effect.void,
        publishTasksUpdated: () => Effect.fail(publicationFailure),
      },
    });

    await expect(
      Effect.runPromise(service.repoPullRequestSync({ repoPath: "/repo" }).pipe(Effect.flip)),
    ).resolves.toMatchObject({
      operation: "task-event-publishing.repo-pull-request-sync",
      cause: mutationFailure,
      details: { mutationFailure, publicationFailure },
    });
  });

  test("does not publish ordinary repo sync failures without durable writes", async () => {
    const { calls, taskSyncService } = createPublisher();
    const mutationFailure = new HostOperationError({
      operation: "task.repo-pull-request-sync",
      message: "first task failed",
    });
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        repoPullRequestSyncDetailed: () => Effect.fail(mutationFailure),
      }),
      taskSyncService,
    });

    await expect(
      Effect.runPromise(service.repoPullRequestSync({ repoPath: "/repo" }).pipe(Effect.flip)),
    ).resolves.toBe(mutationFailure);
    expect(calls).toEqual([]);
  });

  test("publishes delete and plan replacement affected task ids", async () => {
    const { calls, taskSyncService } = createPublisher();
    const service = createEventPublishingTaskService({
      taskService: createTaskServiceFake({
        deleteTask: () => Effect.succeed({ ok: true, affectedTaskIds: ["epic-1", "child-1"] }),
        setPlan: (input) =>
          Effect.succeed({
            document: { markdown: "# Plan" },
            affectedTaskIds: input.hasExplicitSubtasks ? ["epic-1", "child-1"] : ["epic-1"],
          }),
      }),
      taskSyncService,
    });

    await Effect.runPromise(
      service.deleteTask({ repoPath: "/repo", taskId: "epic-1", deleteSubtasks: true }),
    );
    await Effect.runPromise(
      service.setPlan({
        repoPath: "/repo",
        taskId: "epic-1",
        markdown: "# Plan",
        subtasks: [],
        hasExplicitSubtasks: true,
      }),
    );
    await Effect.runPromise(
      service.setPlan({
        repoPath: "/repo",
        taskId: "epic-1",
        markdown: "# Plan",
        subtasks: [],
        hasExplicitSubtasks: false,
      }),
    );
    expect(calls).toEqual([
      { kind: "updated", repoPath: "/repo", taskIds: ["epic-1", "child-1"] },
      { kind: "updated", repoPath: "/repo", taskIds: ["epic-1", "child-1"] },
      { kind: "updated", repoPath: "/repo", taskIds: ["epic-1"] },
    ]);
  });
});
