import { afterEach, describe, expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit } from "effect";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { HostOperationError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import { createTaskAssetAwareTaskStore } from "./task-asset-aware-task-store";
import { createTaskAssetStagingService } from "./task-asset-staging-service";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const cleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

const createHarness = async () => {
  const sqlite = await createSqliteTaskStoreHarness();
  cleanups.add(sqlite.cleanup);
  const filePort = createNodeTaskAssetFilePort({ configDir: sqlite.configDir });
  const staging = createTaskAssetStagingService(filePort);
  const registry = createSqliteTaskAssetRegistry({
    contextProvider: sqlite.contextProvider,
  });
  const store = createTaskAssetAwareTaskStore({
    inner: sqlite.store,
    filePort,
    registry,
    persistence: registry,
    staging,
    resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
  });
  return { ...sqlite, innerStore: sqlite.store, filePort, registry, staging, store };
};

const createTaskWithAsset = async (harness: Awaited<ReturnType<typeof createHarness>>) => {
  const staged = await Effect.runPromise(
    harness.staging.stage({
      workspaceId: "fairnest",
      scope: "description",
      originalName: "owned.png",
      declaredMediaType: "image/png",
      bytesBase64: PNG_BASE64,
    }),
  );
  const description = `![image](odt-asset:${staged.assetId})`;
  const task = await Effect.runPromise(
    harness.store.createTask({
      repoPath: harness.repoPath,
      task: {
        title: "Asset owner",
        issueType: "task",
        aiReviewEnabled: true,
        priority: 2,
        description,
      },
      descriptionAssets: { stagedAssetIds: [staged.assetId] },
    }),
  );
  return { staged, task, description };
};

const captureTaskAssetError = async <A>(effect: Effect.Effect<A, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected a task asset failure.");
  }
  const failure = Array.from(Cause.failures(exit.cause))[0];
  if (failure instanceof TaskAssetError) {
    return failure;
  }
  throw new Error("Expected a typed task asset failure.");
};

describe("asset-aware task store", () => {
  test("delegates asset-free creates when shared asset persistence is unavailable", async () => {
    const harness = await createHarness();
    let workspaceResolutionRequested = false;
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      filePort: harness.filePort,
      registry: harness.registry,
      staging: harness.staging,
      persistence: null,
      resolveWorkspaceIdForRepoPath: () => {
        workspaceResolutionRequested = true;
        return Effect.die("Asset-free creates must not resolve an asset workspace.");
      },
    });

    const task = await Effect.runPromise(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Asset-free task",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
        },
      }),
    );

    expect(task.title).toBe("Asset-free task");
    expect(workspaceResolutionRequested).toBe(false);
  });

  test("preserves an asset-free create failure from the inner task store", async () => {
    const harness = await createHarness();
    const failure = new HostOperationError({
      operation: "sqliteTaskRepository.createTask",
      message: "The task database is unavailable.",
    });
    const store = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        createTask: () => Effect.fail(failure),
      },
      filePort: harness.filePort,
      registry: harness.registry,
      staging: harness.staging,
      persistence: null,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const result = await Effect.runPromise(
      Effect.flip(
        store.createTask({
          repoPath: harness.repoPath,
          task: {
            title: "Asset-free failure",
            issueType: "task",
            aiReviewEnabled: true,
            priority: 2,
          },
        }),
      ),
    );

    expect(result).toBe(failure);
  });

  test("retains the original cause when an asset create wraps a task-store failure", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "diagram.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const failure = new HostOperationError({
      operation: "sqliteTaskRepository.createTask",
      message: "The task database is unavailable.",
    });
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      filePort: harness.filePort,
      registry: harness.registry,
      staging: harness.staging,
      persistence: {
        ...harness.registry,
        createTaskWithDescriptionAssets: () => Effect.fail(failure),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const result = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Asset failure",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![Architecture](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(result.cause).toBe(failure);
  });

  test("rejects asset mutations when shared asset persistence is unavailable", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "unsupported.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      filePort: harness.filePort,
      registry: harness.registry,
      staging: harness.staging,
      persistence: null,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Unsupported asset persistence",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error).toMatchObject({
      code: "validation",
      failedPhase: "validate_asset_persistence",
      durableState: "unchanged",
      retryAllowed: false,
    });
    expect(
      await Effect.runPromise(harness.innerStore.listTasks({ repoPath: harness.repoPath })),
    ).toEqual([]);
  });

  test("restores quarantined files and preserves the previous description when the update transaction fails", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "rollback.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const originalDescription = `![image](odt-asset:${staged.assetId})`;
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Rollback",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: originalDescription,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );
    const failingStore = createTaskAssetAwareTaskStore({
      inner: harness.store,
      filePort: harness.filePort,
      staging: harness.staging,
      registry: harness.registry,
      persistence: {
        ...harness.registry,
        updateTaskWithDescriptionAssets: () =>
          Effect.fail(
            new TaskAssetError({
              operation: "update",
              code: "database",
              taskId: task.id,
              assetIds: [staged.assetId],
              failedPhase: "save_transaction",
              durableState: "unchanged",
              retryAllowed: true,
              message: "Injected database failure.",
            }),
          ),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    await expect(
      Effect.runPromise(
        failingStore.updateTask({
          repoPath: harness.repoPath,
          taskId: task.id,
          patch: { description: "Remove image" },
          descriptionAssets: { stagedAssetIds: [] },
        }),
      ),
    ).rejects.toThrow("Injected database failure");
    expect(
      (
        await Effect.runPromise(
          harness.store.getTask({ repoPath: harness.repoPath, taskId: task.id }),
        )
      ).description,
    ).toBe(originalDescription);
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: staged.assetId,
        }),
      ),
    ).not.toBeNull();
  });

  test("rejects a stale concurrent save and removes only its promoted files", async () => {
    const harness = await createHarness();
    const { staged: original, task } = await createTaskWithAsset(harness);
    const first = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "first.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const second = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "second.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const bothUpdatesReady = await Effect.runPromise(Deferred.make<void>());
    const firstUpdateFinished = await Effect.runPromise(Deferred.make<void>());
    let updateNumber = 0;
    const registry = {
      ...harness.registry,
      updateTaskWithDescriptionAssets: (
        input: Parameters<typeof harness.registry.updateTaskWithDescriptionAssets>[0],
      ) =>
        Effect.gen(function* () {
          updateNumber += 1;
          const currentUpdate = updateNumber;
          if (currentUpdate === 1) {
            yield* Deferred.await(bothUpdatesReady);
            const result = yield* harness.registry.updateTaskWithDescriptionAssets(input);
            yield* Deferred.succeed(firstUpdateFinished, undefined);
            return result;
          }
          yield* Deferred.succeed(bothUpdatesReady, undefined);
          yield* Deferred.await(firstUpdateFinished);
          return yield* harness.registry.updateTaskWithDescriptionAssets(input);
        }),
    };
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      filePort: harness.filePort,
      registry,
      persistence: registry,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const retainedDescription = `![owned](odt-asset:${original.assetId})`;
    const firstDescription = `${retainedDescription}\n\n![first](odt-asset:${first.assetId})`;
    const secondDescription = `${retainedDescription}\n\n![second](odt-asset:${second.assetId})`;
    const [firstExit, secondExit] = await Promise.all([
      Effect.runPromiseExit(
        store.updateTask({
          repoPath: harness.repoPath,
          taskId: task.id,
          patch: { description: firstDescription },
          descriptionAssets: { stagedAssetIds: [first.assetId] },
        }),
      ),
      Effect.runPromiseExit(
        store.updateTask({
          repoPath: harness.repoPath,
          taskId: task.id,
          patch: { description: secondDescription },
          descriptionAssets: { stagedAssetIds: [second.assetId] },
        }),
      ),
    ]);

    const successfulSave = Exit.isSuccess(firstExit) ? first : second;
    const failedExit = Exit.isFailure(firstExit) ? firstExit : secondExit;
    const failedSave = Exit.isFailure(firstExit) ? first : second;
    const successfulDescription = Exit.isSuccess(firstExit) ? firstDescription : secondDescription;
    expect([firstExit, secondExit].filter(Exit.isSuccess)).toHaveLength(1);
    expect([firstExit, secondExit].filter(Exit.isFailure)).toHaveLength(1);
    if (Exit.isSuccess(failedExit)) {
      throw new Error("Expected the stale save to fail.");
    }
    expect(Array.from(Cause.failures(failedExit.cause))[0]).toMatchObject({
      _tag: "TaskAssetError",
      failedPhase: "verify_update_snapshot",
      durableState: "unchanged",
    });
    expect(
      (
        await Effect.runPromise(
          harness.innerStore.getTask({ repoPath: harness.repoPath, taskId: task.id }),
        )
      ).description,
    ).toBe(successfulDescription);
    expect(
      await Effect.runPromise(
        harness.registry.listAssets({
          repoPath: harness.repoPath,
          taskId: task.id,
          scope: "description",
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.assetId }),
        expect.objectContaining({ id: successfulSave.assetId }),
      ]),
    );
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: successfulSave.assetId,
        }),
      ),
    ).not.toBeNull();
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: failedSave.assetId,
        }),
      ),
    ).toBeNull();
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: original.assetId,
        }),
      ),
    ).not.toBeNull();
  }, 15_000);
});
