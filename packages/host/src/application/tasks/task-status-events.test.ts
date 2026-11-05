import { specPlanBuildWorkflow, type TransitionCause } from "@openducktor/workflows";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { noMergeDetection, syncWorkspace } from "./sync/task-sync-service.test-support";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { ExternalTaskSyncEvent, WorkspaceRef } from "@openducktor/contracts";
import { Effect, Fiber, Result } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createTaskSyncService } from "./sync/task-sync-service";
import { HostOperationError } from "../../effect/host-errors";
import { collectTaskStatusChanges } from "../../ports/task-status-changes";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { createTaskServiceWithMutationProgressTestDouble } from "../../test-support/task-service-test-double";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { enrichTask, enrichTasks } from "./support/task-workflow-helpers";
import { TaskMutationProgressFailure } from "./task-mutation-progress-failure";
import {
  createTaskServiceWithMutationProgress,
  type TaskServiceWithMutationProgress,
} from "./task-service";

const transition = (
  store: TaskStorePort,
  {
    status,
    cause,
    ...scope
  }: WorkspaceRef & { taskId: string; status: string; cause?: TransitionCause },
) =>
  store.transitionTask({
    ...scope,
    decide: () =>
      Result.succeed({
        status,
        workflowId: specPlanBuildWorkflow.definition.id,
        ...(cause && { cause }),
      }),
  });

const createServices = (
  harness: SqliteTaskStoreTestHarness,
  overrides: Partial<TaskServiceWithMutationProgress> = {},
) => {
  const { store, repoPath, workspaceId } = harness;
  const workspace = syncWorkspace(repoPath, workspaceId);
  const events: ExternalTaskSyncEvent[] = [];
  const failures: unknown[] = [];
  const base = createTaskServiceWithMutationProgressTestDouble({
    listTasks: (input) =>
      store.listTasks(input).pipe(Effect.map((tasks) => enrichTasks(builtinTaskWorkflows, tasks))),
    transitionTask: (input) =>
      transition(store, input).pipe(Effect.map((task) => enrichTask(specPlanBuildWorkflow, task))),
    ...overrides,
  });
  const sync = createTaskSyncService({
    taskService: base,
    mergeDetection: noMergeDetection,
    taskEventStream: {
      cursor: () => ({ epoch: "11111111-1111-4111-8111-111111111111", sequence: events.length }),
      reset: () => ({ epoch: "11111111-1111-4111-8111-111111111111", sequence: events.length }),
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
    settingsConfig: {
      readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()),
    },
    workspaceSettingsService: {
      getWorkspaceCatalog: () =>
        Effect.succeed({
          catalogRevision: 0,
          openWorkspaces: [workspace],
          closedWorkspaces: [],
          incompleteRemovals: [],
        }),
      listWorkspaces: () => Effect.succeed([workspace]),
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
    const { repoPath, store, workspaceId } = harness;
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          workspaceId,
          status: "open",
          task: { title: "Task", issueType: "task", priority: 2 },
        }),
      );
      await Effect.runPromise(
        transition(store, { workspaceId, repoPath, taskId: task.id, status: previousStatus }),
      );
      const { service, events } = createServices(harness, {
        workflowArtifactSave: createTaskServiceWithMutationProgress({
          taskWorkflows: builtinTaskWorkflows,
          taskStore: store,
        }).workflowArtifactSave,
        buildCompleted: () =>
          transition(store, {
            repoPath,
            workspaceId,
            taskId: task.id,
            status: "human_review",
            cause: { signal: "taskProgressedToHumanReview", sourceRole: "build" },
          }).pipe(Effect.map((task) => enrichTask(specPlanBuildWorkflow, task))),
      });
      await Effect.runPromise(
        operation === "qaApproved"
          ? service
              .workflowArtifactSave({
                sourceTool: "workflow_artifact_save",
                updatedBy: "user",
                repoPath,
                workspaceId,
                taskId: task.id,
                markdown: "Approved",
                code: "qaReport",
                verdict: "approved",
                submit: true,
              })
              .pipe(Effect.asVoid)
          : service.buildCompleted({ workspaceId, repoPath, taskId: task.id }).pipe(Effect.asVoid),
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

test.each([false, true])(
  "publishes concurrent mutations in commit order, background sync=%s",
  async (viaSync) => {
    const harness = await createSqliteTaskStoreHarness();
    const { repoPath, store, workspaceId } = harness;
    const committed = deferred();
    const release = deferred();
    try {
      const task = await Effect.runPromise(
        store.createTask({
          repoPath,
          workspaceId,
          status: "open",
          task: { title: "Task", issueType: "task", priority: 2 },
        }),
      );
      const { service, sync, events, failures } = createServices(harness, {
        repoPullRequestSyncDetailed: () =>
          transition(store, {
            workspaceId,
            repoPath,
            taskId: task.id,
            status: "ready_for_dev",
          }).pipe(Effect.as({ ran: true, changedTaskIds: [task.id], autoCloseFailures: [] })),
        transitionTask: (input) =>
          Effect.gen(function* () {
            const result = yield* transition(store, input);
            if (input.status === "spec_ready") {
              committed.resolve();
              yield* Effect.promise(() => release.promise);
            }
            return enrichTask(specPlanBuildWorkflow, result);
          }),
      });
      const first = Effect.runPromise(
        service.transitionTask({ workspaceId, repoPath, taskId: task.id, status: "spec_ready" }),
      );
      await committed.promise;
      const secondStarted = deferred();
      const secondMutation = viaSync
        ? sync.syncRepoPullRequests(repoPath, workspaceId).pipe(Effect.asVoid)
        : service
            .transitionTask({ workspaceId, repoPath, taskId: task.id, status: "ready_for_dev" })
            .pipe(Effect.asVoid);
      const second = Effect.runFork(
        Effect.sync(secondStarted.resolve).pipe(Effect.andThen(secondMutation)),
      );
      await secondStarted.promise;
      expect(events).toEqual([]);
      expect((await Effect.runPromise(store.listTasks({ workspaceId, repoPath })))[0]?.status).toBe(
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
        service.transitionTask({ workspaceId, repoPath, taskId: task.id, status: "ready_for_dev" }),
      );
      expect(
        events.flatMap((event) => (event.kind === "tasks_updated" ? event.statusChanges : [])),
      ).toHaveLength(2);
    } finally {
      release.resolve();
      await harness.cleanup();
    }
  },
);

test("publishes committed transitions when the rest of a mutation fails", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store, workspaceId } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        workspaceId,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const failure = new HostOperationError({
      operation: "build-completed",
      message: "Cleanup failed",
    });
    const { service, events, failures } = createServices(harness, {
      buildCompleted: (input) =>
        Effect.gen(function* () {
          yield* transition(store, {
            workspaceId: input.workspaceId,
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
      Effect.result(service.buildCompleted({ workspaceId, repoPath, taskId: task.id })),
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
  const { repoPath, store, databasePath, workspaceId } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        workspaceId,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const database = new Database(databasePath);
    database.run(
      "CREATE TRIGGER reject_qa BEFORE INSERT ON task_artifacts BEGIN SELECT RAISE(ABORT, 'QA insert rejected'); END",
    );
    database.close();
    const input = {
      workspaceId,
      repoPath,
      taskId: task.id,
      decide: () =>
        Result.succeed({ status: "human_review", workflowId: specPlanBuildWorkflow.definition.id }),
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
    expect(
      (await Effect.runPromise(store.getTask({ workspaceId, repoPath, taskId: task.id }))).status,
    ).toBe("open");
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
      {
        previousStatus: "open",
        task: {
          workflow: { id: "openducktor-spec-plan-build", revision: 2 },
          id: task.id,
          title: "Task",
          status: "human_review",
        },
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("captures transitions made by pull request synchronization", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const { repoPath, store, workspaceId } = harness;
  try {
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        workspaceId,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const { sync, events, failures } = createServices(harness, {
      repoPullRequestSyncDetailed: () =>
        transition(store, { workspaceId, repoPath, taskId: task.id, status: "closed" }).pipe(
          Effect.as({ ran: true, changedTaskIds: [task.id], autoCloseFailures: [] }),
        ),
    });
    await Effect.runPromise(sync.syncRepoPullRequests(repoPath, workspaceId));
    expect(failures).toEqual([]);
    expect(events).toMatchObject([
      { statusChanges: [{ previousStatus: "open", task: { id: task.id, status: "closed" } }] },
    ]);
  } finally {
    await harness.cleanup();
  }
});
