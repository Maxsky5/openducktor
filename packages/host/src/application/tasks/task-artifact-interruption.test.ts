import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { expect, test } from "bun:test";
import type { ExternalTaskSyncEvent } from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createSqliteTaskRepository } from "../../adapters/sqlite/sqlite-task-repository";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createDefaultGlobalConfig } from "../../config/global-config";
import { createEventPublishingTaskService } from "./event-publishing-task-service";
import { createTaskSyncServiceForTest } from "./sync/task-sync-service.test-support";
import { createTaskServiceWithMutationProgress } from "./task-service";
import { createTaskSessionLifecycleCoordinator } from "./worktrees/task-session-lifecycle-coordinator";

const run = Effect.runPromise;

test("an interrupted artifact write retains lifecycle exclusion and publishes before the next mutation", async () => {
  const harness = await createSqliteTaskStoreHarness();
  const insertStarted = Deferred.makeUnsafe<void>();
  const releaseInsert = Deferred.makeUnsafe<void>();
  const insertFinished = Deferred.makeUnsafe<void>();
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
                    queryOperation === "sqliteTaskRepository.createArtifact.insert"
                      ? Effect.gen(function* () {
                          yield* Deferred.succeed(insertStarted, undefined);
                          yield* Deferred.await(releaseInsert);
                          const result = yield* transaction.execute(query, queryOperation, details);
                          yield* Deferred.succeed(insertFinished, undefined);
                          return result;
                        })
                      : transaction.execute(query, queryOperation, details),
                }),
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
  const sync = createTaskSyncServiceForTest({
    taskService: base,
    workspaceSettingsService: {
      listWorkspaces: () => Effect.succeed([]),
      getWorkspaceCatalog: () =>
        Effect.succeed({ openWorkspaces: [], closedWorkspaces: [], incompleteRemovals: [] }),
      getSettingsSnapshot: () => Effect.succeed(createDefaultGlobalConfig()),
    },
    eventBus: { publish: (event) => events.push(event) },
  });
  const service = createEventPublishingTaskService({
    taskWorkflows: builtinTaskWorkflows,
    taskService: base,
    taskSyncService: sync,
  });
  const task = await run(
    harness.store.createTask({
      repoPath: harness.repoPath,
      status: "open",
      task: {
        title: "Interrupted artifact",
        issueType: "task",
        priority: 2,
      },
    }),
  );
  const scope = { repoPath: harness.repoPath, taskId: task.id };
  const writer = Effect.runFork(
    service.createTaskArtifact({
      ...scope,
      name: "Captured output",
      fileName: "output.txt",
      mediaType: "text/plain",
      dataBase64: Buffer.from("saved exactly once").toString("base64"),
    }),
  );
  let interruption: Promise<void> | undefined;
  let queuedReset: Promise<number> | undefined;
  try {
    await run(Deferred.await(insertStarted));
    interruption = run(Fiber.interrupt(writer));
    // A started SQLite Promise transaction must settle before interruption can release its owner.
    const settledBeforeWrite = await Promise.race([
      interruption.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    expect(settledBeforeWrite).toBe(false);
    const resetWhileWriting = await run(
      Effect.result(
        Effect.scoped(coordinator.acquireLifecycle(scope.repoPath, [scope.taskId], "reset task")),
      ),
    );
    expect(resetWhileWriting._tag).toBe("Failure");
    queuedReset = run(
      sync.runMutation(
        scope.repoPath,
        Effect.scoped(
          Effect.gen(function* () {
            yield* coordinator.acquireLifecycle(scope.repoPath, [scope.taskId], "reset task");
            return events.length;
          }),
        ),
      ),
    );
    expect(events).toHaveLength(0);
    await run(Deferred.succeed(releaseInsert, undefined));
    await interruption;
    expect(await queuedReset).toBe(1);
    const artifacts = await run(harness.store.listArtifacts(scope));
    expect(artifacts).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.boardChanges?.artifactChanges).toEqual([
      {
        taskId: task.id,
        artifactIds: artifacts.map((artifact) => artifact.artifactId),
        removedArtifactIds: [],
      },
    ]);
  } finally {
    await run(Deferred.succeed(releaseInsert, undefined));
    await run(Deferred.await(insertFinished));
    await interruption;
    await queuedReset;
    await harness.cleanup();
  }
});
