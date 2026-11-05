import { createTaskSyncService } from "./sync/task-sync-service";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createTaskEventStream } from "../../events/task-event-stream";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { noMergeDetection, syncWorkspace } from "./sync/task-sync-service.test-support";
import { createTaskServiceWithMutationProgress } from "./task-service";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";

const run = Effect.runPromise;

const createInterruptedTaskMutation = async (
  stage: "before-insert" | "after-commit",
  kind: "artifact" | "task" = "artifact",
) => {
  const harness = await createSqliteTaskStoreHarness();
  const insertStarted = Deferred.makeUnsafe<void>();
  const releaseInsert = Deferred.makeUnsafe<void>();
  const pause = Deferred.succeed(insertStarted, undefined).pipe(
    Effect.andThen(Deferred.await(releaseInsert)),
  );
  const coordinator = createTaskSessionLifecycleCoordinator();
  const events: ExternalTaskSyncEvent[] = [];
  const taskStore = createSqliteTaskRepository({
    contextProvider: (repoPath, operation, use) =>
      harness.contextProvider(repoPath, operation, (context) =>
        use({
          ...context,
          session: {
            ...context.session,
            transaction: (name, body) =>
              context.session.transaction(name, (transaction) =>
                body({
                  ...transaction,
                  execute: (query, queryOperation, details) =>
                    stage === "before-insert" &&
                    queryOperation === "sqliteTaskRepository.createArtifact.insert"
                      ? pause.pipe(
                          Effect.andThen(transaction.execute(query, queryOperation, details)),
                        )
                      : transaction.execute(query, queryOperation, details),
                }).pipe(
                  Effect.tap(() =>
                    stage === "after-commit" ? transaction.afterCommit(pause) : Effect.void,
                  ),
                ),
              ),
          },
        }),
      ),
  });
  const base = createTaskServiceWithMutationProgress({
    taskWorkflows: builtinTaskWorkflows,
    taskStore,
    taskSessionLifecycleCoordinator: coordinator,
  });
  const task = await run(
    harness.store.createTask({
      ...harness.scope,
      status: "open",
      task: {
        title: "Interrupted artifact",
        issueType: "task",
        priority: 2,
      },
    }),
  );
  const scope = { ...harness.scope, taskId: task.id };
  const stream = createTaskEventStream({ reporter: { report: () => {} } });
  const sync = createTaskSyncService({
    taskService: base,
    mergeDetection: noMergeDetection,
    taskEventStream: {
      ...stream,
      publish: (event) => {
        events.push(event);
        return stream.publish(event);
      },
    },
    settingsConfig: {
      readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()),
    },
    workspaceSettingsService: {
      listWorkspaces: () => Effect.succeed([]),
      getWorkspaceCatalog: () =>
        Effect.succeed({
          catalogRevision: 0,
          openWorkspaces: [syncWorkspace(harness.repoPath, harness.workspaceId)],
          closedWorkspaces: [],
          incompleteRemovals: [],
        }),
    },
    publicationReporter: { report: () => Effect.void },
    onBackgroundFailure: () => Effect.void,
  });
  const service = createEventPublishingTaskService({
    taskService: base,
    taskSyncService: sync,
  });
  const writer = Effect.runFork(
    kind === "task"
      ? service
          .createTask({
            ...harness.scope,
            task: { title: "Created during cancellation", issueType: "task", priority: 2 },
          })
          .pipe(Effect.asVoid)
      : service
          .createTaskArtifact({
            ...scope,
            name: "Captured output",
            fileName: "output.txt",
            mediaType: "text/plain",
            dataBase64: Buffer.from("saved exactly once").toString("base64"),
          })
          .pipe(Effect.asVoid),
  );
  return {
    harness,
    scope,
    writer,
    insertStarted,
    releaseInsert,
    coordinator,
    events,
  };
};

test("canceling an uncommitted artifact write rolls back and releases lifecycle exclusion", async () => {
  const { harness, scope, writer, insertStarted, releaseInsert, coordinator, events } =
    await createInterruptedTaskMutation("before-insert");
  let interruption: Promise<void> | undefined;
  try {
    await run(Deferred.await(insertStarted));
    const blocked = await run(
      Effect.result(
        Effect.scoped(coordinator.acquireLifecycle(scope.repoPath, [scope.taskId], "reset task")),
      ),
    );
    expect(blocked._tag).toBe("Failure");
    interruption = run(Fiber.interrupt(writer));
    const settled = await Promise.race([
      interruption.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(settled).toBe(true);
    expect(await run(harness.store.listArtifacts(scope))).toEqual([]);
    expect(events).toEqual([]);
    await run(
      Effect.scoped(coordinator.acquireLifecycle(scope.repoPath, [scope.taskId], "reset task")),
    );
  } finally {
    await run(Deferred.succeed(releaseInsert, undefined));
    await interruption;
    await run(Fiber.interrupt(writer));
    await harness.cleanup();
  }
});

test("a write canceled after commit retains data and reaches the change stream", async () => {
  const { harness, scope, writer, insertStarted, releaseInsert, coordinator, events } =
    await createInterruptedTaskMutation("after-commit");
  let interruption: Promise<void> | undefined;
  try {
    await run(Deferred.await(insertStarted));
    const observer = new Database(harness.databasePath, { readonly: true });
    try {
      expect(
        observer
          .query<{ count: number }, [string, string]>(
            "SELECT count(*) AS count FROM task_artifacts WHERE workspace_id = ? AND task_id = ?",
          )
          .get(scope.workspaceId, scope.taskId)?.count,
      ).toBe(1);
    } finally {
      observer.close();
    }
    const blocked = await run(
      Effect.result(
        Effect.scoped(coordinator.acquireLifecycle(scope.repoPath, [scope.taskId], "reset task")),
      ),
    );
    expect(blocked._tag).toBe("Failure");
    interruption = run(Fiber.interrupt(writer));
    const settled = await Promise.race([
      interruption.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    expect(settled).toBe(false);
    await run(Deferred.succeed(releaseInsert, undefined));
    await interruption;
    expect(await run(harness.store.listArtifacts(scope))).toHaveLength(1);
    expect(events).toHaveLength(1);
    await run(
      Effect.scoped(coordinator.acquireLifecycle(scope.repoPath, [scope.taskId], "reset task")),
    );
  } finally {
    await run(Deferred.succeed(releaseInsert, undefined));
    await interruption;
    await run(Fiber.interrupt(writer));
    await harness.cleanup();
  }
});

test("a task created before cancellation publishes its saved identity exactly once", async () => {
  const { harness, writer, insertStarted, releaseInsert, events } =
    await createInterruptedTaskMutation("after-commit", "task");
  let interruption: Promise<void> | undefined;
  try {
    await run(Deferred.await(insertStarted));
    const observer = new Database(harness.databasePath, { readonly: true });
    let created: { id: string; title: string; status: string } | null;
    try {
      created = observer
        .query<{ id: string; title: string; status: string }, [string]>(
          "SELECT id, title, status FROM tasks WHERE workspace_id = ? AND title = 'Created during cancellation'",
        )
        .get(harness.workspaceId);
    } finally {
      observer.close();
    }
    expect(created).not.toBeNull();
    interruption = run(Fiber.interrupt(writer));
    const settled = await Promise.race([
      interruption.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    expect(settled).toBe(false);
    await run(Deferred.succeed(releaseInsert, undefined));
    await interruption;
    expect(events).toEqual([
      expect.objectContaining({
        kind: "external_task_created",
        workspaceId: harness.workspaceId,
        taskId: created!.id,
        taskSnapshot: expect.objectContaining({
          id: created!.id,
          title: created!.title,
          status: created!.status,
        }),
      }),
    ]);
    expect(await run(harness.store.listTasks(harness.scope))).toHaveLength(2);
  } finally {
    await run(Deferred.succeed(releaseInsert, undefined));
    await interruption;
    await run(Fiber.interrupt(writer));
    await harness.cleanup();
  }
});
