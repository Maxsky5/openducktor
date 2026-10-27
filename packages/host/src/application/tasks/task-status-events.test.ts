import { builtinTaskWorkflow } from "@openducktor/workflows";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { noMergeDetection } from "./sync/task-sync-service.test-support";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect, Fiber } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { HostOperationError } from "../../effect/host-errors";
import { collectTaskStatusChanges } from "../../ports/task-status-changes";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskServiceWithMutationProgressTestDouble } from "../../test-support/task-service-test-double";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { createTaskSyncService } from "./sync/task-sync-service";
import { enrichTask, enrichTasks } from "./support/task-workflow-helpers";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createTaskServiceWithMutationProgress,
  type TaskServiceWithMutationProgress,
} from "./task-service";

const createServices = (
  store: TaskStorePort,
  overrides: Partial<TaskServiceWithMutationProgress> = {},
) => {
  const events: ExternalTaskSyncEvent[] = [];
  const failures: unknown[] = [];
  const base = createTaskServiceWithMutationProgressTestDouble({
    listTasks: (input) =>
      store.listTasks(input).pipe(Effect.map((tasks) => enrichTasks(builtinTaskWorkflows, tasks))),
    transitionTask: (input) =>
      store.transitionTask(input).pipe(Effect.map((task) => enrichTask(builtinTaskWorkflow, task))),
    ...overrides,
  });
  const sync = createTaskSyncService({
    taskService: base,
    mergeDetection: noMergeDetection,
    taskEventStream: {
      publish: (event) => {
        events.push(event);
        return { epoch: "11111111-1111-4111-8111-111111111111", sequence: events.length };
      },
      subscribe: () => {
        throw new Error("Unexpected subscription");
      },
      acknowledge: () => {
        throw new Error("Unexpected acknowledgement");
      },
    },
    publicationReporter: {
      report: (failure) =>
        Effect.sync(() => {
          failures.push(failure);
        }),
    },
    onBackgroundFailure: (failure) =>
      Effect.sync(() => {
        failures.push(failure);
      }),
    workspaceSettingsService: {
      getWorkspaceCatalog: () =>
        Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
      listWorkspaces: () => Effect.succeed([]),
      getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
    },
  });
  return {
    events,
    failures,
    sync,
    service: createEventPublishingTaskService({
      taskWorkflows: builtinTaskWorkflows,
      taskService: base,
      taskSyncService: sync,
    }),
  };
};

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

test.each([
  ["buildCompleted", "in_progress", "build"],
  ["buildCompleted", "blocked", "build"],
  ["qaApproved", "blocked", "qa"],
  ["qaApproved", "ai_review", "qa"],
] as const)(
  "publishes the source role for %s from %s",
  async (operation, previousStatus, sourceRole) => {
    const harness = await createSqliteTaskStoreHarness();
    const { repoPath, store } = harness;
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          status: "open",
          task: { title: "Task", issueType: "task", priority: 2 },
        }),
      );
      await Effect.runPromise(
        store.transitionTask({ repoPath, taskId: task.id, status: previousStatus }),
      );
      const { service, events } = createServices(store, {
        workflowArtifactSave: createTaskServiceWithMutationProgress({
          taskWorkflows: builtinTaskWorkflows,
          taskStore: store,
        }).workflowArtifactSave,
        buildCompleted: () =>
          store
            .transitionTask({
              repoPath,
              taskId: task.id,
              status: "human_review",
              cause: { signal: "taskProgressedToHumanReview", sourceRole: "build" },
            })
            .pipe(Effect.map((task) => enrichTask(builtinTaskWorkflow, task))),
      });
      await Effect.runPromise(
        operation === "qaApproved"
          ? service
              .workflowArtifactSave({
                sourceTool: "workflow_artifact_save",
                updatedBy: "user",
                repoPath,
                taskId: task.id,
                markdown: "Approved",
                code: "qaReport",
                verdict: "approved",
                submit: true,
              })
              .pipe(Effect.asVoid)
          : service.buildCompleted({ repoPath, taskId: task.id }).pipe(Effect.asVoid),
      );
      expect(events).toMatchObject([
        {
          kind: "tasks_updated",
          statusChanges: [
            { previousStatus, sourceRole, task: { id: task.id, status: "human_review" } },
          ],
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  },
);

test("keeps the committed transition and reports a failed publication snapshot without retry", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    let snapshotReads = 0;
    let mutations = 0;
    const { service, events, failures } = createServices(store, {
      listTasks: () =>
        Effect.suspend(() => {
          snapshotReads += 1;
          return Effect.fail(
            new HostOperationError({ operation: "task.list", message: "Snapshot unavailable" }),
          );
        }),
      transitionTask: (input) =>
        Effect.gen(function* () {
          mutations += 1;
          return enrichTask(builtinTaskWorkflow, yield* store.transitionTask(input));
        }),
    });
    const failure = await Effect.runPromise(
      service.transitionTask({ repoPath, taskId: task.id, status: "spec_ready" }).pipe(Effect.flip),
    );
    expect(failure.message).toContain("Task changes were saved");
    expect(failure.message).toContain("Reload the workspace");
    expect(failure.message).toContain("Do not repeat the change");
    expect((await Effect.runPromise(store.listTasks({ repoPath })))[0]?.status).toBe("spec_ready");
    expect(mutations).toBe(1);
    expect(snapshotReads).toBe(1);
    expect(events).toEqual([]);
    expect(failures).toHaveLength(1);
  } finally {
    await harness.cleanup();
  }
});

test.each([false, true])(
  "publishes concurrent mutations in commit order, background sync=%s",
  async (viaSync) => {
    const harness = await createSqliteTaskStoreHarness();
    const { repoPath, store } = harness;
    const committed = deferred();
    const release = deferred();
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          status: "open",
          task: { title: "Task", issueType: "task", priority: 2 },
        }),
      );
      const { service, sync, events, failures } = createServices(store, {
        repoPullRequestSyncDetailed: () =>
          store
            .transitionTask({ repoPath, taskId: task.id, status: "ready_for_dev" })
            .pipe(Effect.as({ ran: true, changedTaskIds: [task.id] })),
        transitionTask: (input) =>
          Effect.gen(function* () {
            const result = yield* store.transitionTask(input);
            if (input.status === "spec_ready") {
              committed.resolve();
              yield* Effect.promise(() => release.promise);
            }
            return enrichTask(builtinTaskWorkflow, result);
          }),
      });
      const first = Effect.runPromise(
        service.transitionTask({ repoPath, taskId: task.id, status: "spec_ready" }),
      );
      await committed.promise;
      const secondStarted = deferred();
      const secondMutation = viaSync
        ? sync.syncRepoPullRequests(repoPath).pipe(Effect.asVoid)
        : service
            .transitionTask({ repoPath, taskId: task.id, status: "ready_for_dev" })
            .pipe(Effect.asVoid);
      const second = Effect.runFork(
        Effect.sync(secondStarted.resolve).pipe(Effect.andThen(secondMutation)),
      );
      await secondStarted.promise;
      expect(events).toEqual([]);
      expect((await Effect.runPromise(store.listTasks({ repoPath })))[0]?.status).toBe(
        "spec_ready",
      );
      release.resolve();
      await first;
      await Effect.runPromise(Fiber.join(second));
      expect(failures).toEqual([]);
      expect(events).toMatchObject([
        {
          kind: "tasks_updated",
          statusChanges: [{ previousStatus: "open", task: { id: task.id, status: "spec_ready" } }],
          taskSnapshots: [{ id: task.id, status: "spec_ready" }],
        },
        {
          kind: "tasks_updated",
          statusChanges: [
            { previousStatus: "spec_ready", task: { id: task.id, status: "ready_for_dev" } },
          ],
          taskSnapshots: [{ id: task.id, status: "ready_for_dev" }],
        },
      ]);
      // A metadata/no-op status update must not repeat either transition.
      await Effect.runPromise(
        service.transitionTask({ repoPath, taskId: task.id, status: "ready_for_dev" }),
      );
      expect(events[2]).toMatchObject({ statusChanges: [] });
    } finally {
      release.resolve();
      await harness.cleanup();
    }
  },
);

test("publishes committed transitions when the rest of a mutation fails", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const failure = new HostOperationError({
      operation: "build-completed",
      message: "Cleanup failed",
    });
    const { service, events, failures } = createServices(store, {
      buildCompleted: (input) =>
        Effect.gen(function* () {
          yield* store.transitionTask({
            repoPath: input.repoPath,
            taskId: input.taskId,
            status: "spec_ready",
          });
          return yield* new TaskMutationProgressFailure({
            operation: "build-completed",
            changes: { taskIds: [input.taskId], removedTaskIds: [] },
            failure,
          });
        }),
    });
    const result = await Effect.runPromise(
      Effect.result(service.buildCompleted({ repoPath, taskId: task.id })),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure).toBe(failure);
    expect(failures).toEqual([]);
    expect(events).toMatchObject([
      { statusChanges: [{ previousStatus: "open", task: { id: task.id, status: "spec_ready" } }] },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("records QA transitions only after the entire SQLite transaction commits", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store, databasePath } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const database = new Database(databasePath);
    database.run(
      "CREATE TRIGGER reject_qa BEFORE INSERT ON tasks_artifacts BEGIN SELECT RAISE(ABORT, 'QA insert rejected'); END",
    );
    database.close();
    const input = {
      repoPath,
      taskId: task.id,
      status: "human_review" as const,
      verdict: "approved" as const,
      markdown: "Approved",
    };
    const failed = await Effect.runPromise(
      collectTaskStatusChanges(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...input,
          code: "qaReport",
        }),
      ),
    );
    expect(failed.result._tag).toBe("Failure");
    expect(failed.statusChanges).toEqual([]);
    expect((await Effect.runPromise(store.getTask({ repoPath, taskId: task.id }))).status).toBe(
      "open",
    );
    const cleanupDatabase = new Database(databasePath);
    cleanupDatabase.run("DROP TRIGGER reject_qa");
    cleanupDatabase.close();
    const completed = await Effect.runPromise(
      collectTaskStatusChanges(
        store.saveWorkflowArtifact({
          sourceTool: "workflow_artifact_save",
          updatedBy: "user",
          ...input,
          code: "qaReport",
        }),
      ),
    );
    expect(completed.result._tag).toBe("Success");
    expect(completed.statusChanges).toEqual([
      { previousStatus: "open", task: { id: task.id, title: "Task", status: "human_review" } },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("captures transitions made by pull request synchronization", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const { sync, events, failures } = createServices(store, {
      repoPullRequestSyncDetailed: () =>
        store
          .transitionTask({ repoPath, taskId: task.id, status: "closed" })
          .pipe(Effect.as({ ran: true, changedTaskIds: [task.id] })),
    });
    await Effect.runPromise(sync.syncRepoPullRequests(repoPath));
    expect(failures).toEqual([]);
    expect(events).toMatchObject([
      { statusChanges: [{ previousStatus: "open", task: { id: task.id, status: "closed" } }] },
    ]);
  } finally {
    await harness.cleanup();
  }
});
