import { afterEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import { createSqliteTaskAssetRegistry } from "./sqlite-task-asset-registry";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

const cleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

describe("SQLite task asset registry", () => {
  test("rolls back a new task and its asset rows when file preparation fails", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const registry = createSqliteTaskAssetRegistry({
      contextProvider: harness.contextProvider,
    });
    const assetId = "550e8400-e29b-41d4-a716-446655440000";
    const failure = new HostOperationError({
      operation: "taskAsset.prepareFiles",
      message: "Injected file preparation failure.",
    });
    let preparedTaskId: string | null = null;

    const exit = await Effect.runPromiseExit(
      registry.createTaskWithDescriptionAssets({
        repoPath: harness.repoPath,
        task: {
          title: "Atomic asset create",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![diagram](odt-asset:${assetId})`,
        },
        assets: [
          {
            id: assetId,
            scope: "description",
            originalName: "diagram.png",
            mediaType: "image/png",
            byteSize: 10,
            createdAt: new Date("2026-07-22T10:00:00Z"),
          },
        ],
        prepareFiles: (taskId) => {
          preparedTaskId = taskId;
          return Effect.fail(failure);
        },
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(preparedTaskId).not.toBeNull();
    expect(
      await Effect.runPromise(harness.store.listTasks({ repoPath: harness.repoPath })),
    ).toEqual([]);
    expect(
      await Effect.runPromise(registry.assetIdExists({ repoPath: harness.repoPath, assetId })),
    ).toBe(false);
  });

  test("registers exact ownership and updates description rows in one transaction", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const registry = createSqliteTaskAssetRegistry({
      contextProvider: harness.contextProvider,
    });
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: { title: "Assets", issueType: "task", aiReviewEnabled: true, priority: 2 },
      }),
    );
    const firstId = "550e8400-e29b-41d4-a716-446655440000";
    const secondId = "550e8400-e29b-41d4-a716-446655440001";

    await Effect.runPromise(
      registry.registerAssets({
        repoPath: harness.repoPath,
        taskId: task.id,
        assets: [
          {
            id: firstId,
            scope: "description",
            originalName: "one.png",
            mediaType: "image/png",
            byteSize: 10,
            createdAt: new Date("2026-07-22T10:00:00Z"),
          },
        ],
      }),
    );
    expect(
      await Effect.runPromise(
        registry.assetIdExists({ repoPath: harness.repoPath, assetId: firstId }),
      ),
    ).toBe(true);
    expect(
      await Effect.runPromise(
        registry.getAsset({
          repoPath: harness.repoPath,
          taskId: task.id,
          scope: "description",
          assetId: firstId,
        }),
      ),
    ).toMatchObject({ id: firstId, taskId: task.id, originalName: "one.png" });

    const updated = await Effect.runPromise(
      registry.updateTaskWithDescriptionAssets({
        repoPath: harness.repoPath,
        taskId: task.id,
        expectedTask: task,
        expectedAssetIds: [firstId],
        patch: { description: `![two](odt-asset:${secondId})` },
        insertAssets: [
          {
            id: secondId,
            scope: "description",
            originalName: "two.webp",
            mediaType: "image/webp",
            byteSize: 20,
            createdAt: new Date("2026-07-22T10:01:00Z"),
          },
        ],
        removeAssetIds: [firstId],
      }),
    );

    expect(updated.description).toBe(`![two](odt-asset:${secondId})`);
    expect(
      await Effect.runPromise(
        registry.listAssets({ repoPath: harness.repoPath, taskId: task.id, scope: "description" }),
      ),
    ).toEqual([expect.objectContaining({ id: secondId, taskId: task.id })]);
  });

  test("rejects an update when its task and asset snapshot is stale", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const registry = createSqliteTaskAssetRegistry({
      contextProvider: harness.contextProvider,
    });
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Concurrent assets",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "Original",
        },
      }),
    );

    await Effect.runPromise(
      registry.updateTaskWithDescriptionAssets({
        repoPath: harness.repoPath,
        taskId: task.id,
        expectedTask: task,
        expectedAssetIds: [],
        patch: { description: "First save" },
        insertAssets: [],
        removeAssetIds: [],
      }),
    );

    const exit = await Effect.runPromiseExit(
      registry.updateTaskWithDescriptionAssets({
        repoPath: harness.repoPath,
        taskId: task.id,
        expectedTask: task,
        expectedAssetIds: [],
        patch: { description: "Stale save" },
        insertAssets: [],
        removeAssetIds: [],
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected a stale update to fail.");
    }
    const failure = Array.from(Cause.failures(exit.cause))[0];
    expect(failure).toBeInstanceOf(TaskAssetError);
    expect(failure).toMatchObject({
      _tag: "TaskAssetError",
      code: "validation",
      failedPhase: "verify_update_snapshot",
      durableState: "unchanged",
      retryAllowed: true,
    });
    expect(
      (
        await Effect.runPromise(
          harness.store.getTask({ repoPath: harness.repoPath, taskId: task.id }),
        )
      ).description,
    ).toBe("First save");
  });

  test("rejects an asset update when another save changed a patched task field", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const registry = createSqliteTaskAssetRegistry({
      contextProvider: harness.contextProvider,
    });
    const expectedTask = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Original title",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "Original description",
        },
      }),
    );
    await Effect.runPromise(
      harness.store.updateTask({
        repoPath: harness.repoPath,
        taskId: expectedTask.id,
        patch: { title: "Concurrent title" },
      }),
    );

    const exit = await Effect.runPromiseExit(
      registry.updateTaskWithDescriptionAssets({
        repoPath: harness.repoPath,
        taskId: expectedTask.id,
        expectedAssetIds: [],
        expectedTask,
        patch: { title: "Stale title", description: "New description" },
        insertAssets: [],
        removeAssetIds: [],
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(
      (
        await Effect.runPromise(
          harness.store.getTask({ repoPath: harness.repoPath, taskId: expectedTask.id }),
        )
      ).title,
    ).toBe("Concurrent title");
  });
});
