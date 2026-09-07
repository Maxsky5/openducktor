import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Effect } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { HostOperationError } from "../../effect/host-errors";
import { collectTaskStatusChanges } from "../../ports/task-status-changes";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskServiceWithMutationProgressTestDouble } from "../../test-support/task-service-test-double";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { createTaskSyncService } from "./sync/task-sync-service";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import type { TaskServiceWithMutationProgress } from "./task-service";

const createServices = (
  store: TaskStorePort,
  overrides: Partial<TaskServiceWithMutationProgress> = {},
) => {
  const events: ExternalTaskSyncEvent[] = [];
  const failures: unknown[] = [];
  const base = createTaskServiceWithMutationProgressTestDouble({
    listTasks: (input) => store.listTasks(input),
    transitionTask: (input) => store.transitionTask(input),
    ...overrides,
  });
  const sync = createTaskSyncService({
    taskService: base,
    taskEventStream: {
      publish: (event) => {
        events.push(event);
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
    workspaceSettingsService: { listWorkspaces: () => Effect.succeed([]) },
  });
  return {
    events,
    failures,
    sync,
    service: createEventPublishingTaskService({ taskService: base, taskSyncService: sync }),
  };
};

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
};

test("keeps the committed transition and reports a failed publication snapshot without retry", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
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
          return yield* store.transitionTask(input);
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

test("captures each committed transition despite a concurrent mutation overtaking publication", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store } = harness;
  const committed = deferred();
  const release = deferred();
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const { service, events, failures } = createServices(store, {
      transitionTask: (input) =>
        Effect.gen(function* () {
          const result = yield* store.transitionTask(input);
          if (input.status === "spec_ready") {
            committed.resolve();
            yield* Effect.promise(() => release.promise);
          }
          return result;
        }),
    });
    const first = Effect.runPromise(
      service.transitionTask({ repoPath, taskId: task.id, status: "spec_ready" }),
    );
    await committed.promise;
    await Effect.runPromise(
      service.transitionTask({ repoPath, taskId: task.id, status: "ready_for_dev" }),
    );
    release.resolve();
    await first;
    expect(failures).toEqual([]);
    expect(events).toMatchObject([
      {
        kind: "tasks_updated",
        statusChanges: [
          { previousStatus: "spec_ready", task: { id: task.id, status: "ready_for_dev" } },
        ],
      },
      {
        kind: "tasks_updated",
        statusChanges: [{ previousStatus: "open", task: { id: task.id, status: "spec_ready" } }],
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
});

test("publishes committed transitions when the rest of a mutation fails", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const failure = new HostOperationError({ operation: "set-spec", message: "Cleanup failed" });
    const { service, events, failures } = createServices(store, {
      setSpec: (input) =>
        Effect.gen(function* () {
          yield* store.transitionTask({ ...input, status: "spec_ready" });
          return yield* new TaskMutationProgressFailure({
            operation: "set-spec",
            changes: { taskIds: [input.taskId], removedTaskIds: [] },
            failure,
          });
        }),
    });
    const result = await Effect.runPromise(
      Effect.either(service.setSpec({ repoPath, taskId: task.id, markdown: "Spec" })),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left).toBe(failure);
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
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
      }),
    );
    const database = new Database(databasePath);
    database.run(
      "CREATE TRIGGER reject_qa BEFORE INSERT ON task_documents BEGIN SELECT RAISE(ABORT, 'QA insert rejected'); END",
    );
    database.close();
    const input = {
      repoPath,
      taskId: task.id,
      status: "human_review" as const,
      verdict: "approved" as const,
      markdown: "Approved",
    };
    const failed = await Effect.runPromise(collectTaskStatusChanges(store.recordQaOutcome(input)));
    expect(failed.result._tag).toBe("Left");
    expect(failed.statusChanges).toEqual([]);
    expect((await Effect.runPromise(store.getTask({ repoPath, taskId: task.id }))).status).toBe(
      "open",
    );
    const cleanupDatabase = new Database(databasePath);
    cleanupDatabase.run("DROP TRIGGER reject_qa");
    cleanupDatabase.close();
    const completed = await Effect.runPromise(
      collectTaskStatusChanges(store.recordQaOutcome(input)),
    );
    expect(completed.result._tag).toBe("Right");
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
        task: { title: "Task", issueType: "task", priority: 2, aiReviewEnabled: true },
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
