import { afterEach, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { createNodeTaskAssetFilePort } from "../../adapters/node/filesystem-task-asset-file-port";
import { createSqliteTaskAssetRegistry } from "../../adapters/sqlite/sqlite-task-asset-registry";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { TaskAssetError } from "../../effect/task-asset-error";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
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
    resolveDatabasePath: ({ workspaceId }) =>
      resolveSqliteTaskStoreDatabasePath({ configDir: sqlite.configDir, workspaceId }),
    resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
  });
  const store = createTaskAssetAwareTaskStore({
    inner: sqlite.store,
    filePort,
    registry,
    staging,
    resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
  });
  return { ...sqlite, innerStore: sqlite.store, filePort, registry, staging, store };
};

const injectedTaskAssetError = ({
  operation,
  code,
  failedPhase,
  taskId,
  assetIds = [],
}: {
  operation: "create" | "update" | "delete";
  code: "promotion" | "database" | "restore" | "purge";
  failedPhase: string;
  taskId?: string;
  assetIds?: string[];
}) =>
  new TaskAssetError({
    operation,
    code,
    ...(taskId ? { taskId } : {}),
    assetIds,
    failedPhase,
    durableState: "unchanged",
    retryAllowed: true,
    message: `Injected ${failedPhase} failure.`,
  });

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
  test("promotes staged assets on create and removes obsolete assets only after update", async () => {
    const { filePort, registry, repoPath, staging, store } = await createHarness();
    const staged = await Effect.runPromise(
      staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "diagram.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const description = `![Architecture](odt-asset:${staged.assetId})`;
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "With image",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(task.description).toBe(description);
    expect(
      await Effect.runPromise(
        registry.listAssets({ repoPath, taskId: task.id, scope: "description" }),
      ),
    ).toEqual([expect.objectContaining({ id: staged.assetId, taskId: task.id })]);
    expect(
      await Effect.runPromise(
        filePort.readDurable({ workspaceId: "fairnest", taskId: task.id, assetId: staged.assetId }),
      ),
    ).not.toBeNull();

    await Effect.runPromise(
      store.updateTask({
        repoPath,
        taskId: task.id,
        patch: { description: "Image removed" },
        descriptionAssets: { stagedAssetIds: [] },
      }),
    );
    expect(
      await Effect.runPromise(
        registry.listAssets({ repoPath, taskId: task.id, scope: "description" }),
      ),
    ).toEqual([]);
    expect(
      await Effect.runPromise(
        filePort.readDurable({ workspaceId: "fairnest", taskId: task.id, assetId: staged.assetId }),
      ),
    ).toBeNull();
  });

  test("rejects unbacked and foreign-task logical references", async () => {
    const { repoPath, staging, store } = await createHarness();
    const forged = "550e8400-e29b-41d4-a716-446655440000";

    await expect(
      Effect.runPromise(
        store.createTask({
          repoPath,
          task: {
            title: "Forged",
            issueType: "task",
            aiReviewEnabled: true,
            priority: 2,
            description: `![x](odt-asset:${forged})`,
          },
        }),
      ),
    ).rejects.toThrow("supplied staged asset");

    const staged = await Effect.runPromise(
      staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "owned.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const owner = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Owner",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![owned](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );
    const other = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Other",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "No image",
        },
      }),
    );

    await expect(
      Effect.runPromise(
        store.updateTask({
          repoPath,
          taskId: other.id,
          patch: { description: `![foreign](odt-asset:${staged.assetId})` },
        }),
      ),
    ).rejects.toThrow("not owned by this task");
    expect(
      (await Effect.runPromise(store.getTask({ repoPath, taskId: owner.id }))).description,
    ).toContain(staged.assetId);
  });

  test("retains assets on close and removes files and registry rows on delete", async () => {
    const { filePort, registry, repoPath, staging, store } = await createHarness();
    const staged = await Effect.runPromise(
      staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "retained.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Lifecycle",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    await Effect.runPromise(store.transitionTask({ repoPath, taskId: task.id, status: "closed" }));
    expect(
      await Effect.runPromise(
        filePort.readDurable({ workspaceId: "fairnest", taskId: task.id, assetId: staged.assetId }),
      ),
    ).not.toBeNull();

    await Effect.runPromise(store.deleteTask({ repoPath, taskId: task.id, deleteSubtasks: false }));
    expect(
      await Effect.runPromise(
        filePort.readDurable({ workspaceId: "fairnest", taskId: task.id, assetId: staged.assetId }),
      ),
    ).toBeNull();
    expect(
      await Effect.runPromise(
        registry.listAssets({ repoPath, taskId: task.id, scope: "description" }),
      ),
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
      registry: {
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

  test("reports obsolete IDs when post-commit update purge fails", async () => {
    const harness = await createHarness();
    const { staged, task } = await createTaskWithAsset(harness);
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      staging: harness.staging,
      filePort: {
        ...harness.filePort,
        purgeQuarantine: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "update",
              code: "purge",
              failedPhase: "purge_quarantine",
              taskId: task.id,
              assetIds: [staged.assetId],
            }),
          ),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.updateTask({
        repoPath: harness.repoPath,
        taskId: task.id,
        patch: { description: "Image removed" },
        descriptionAssets: { stagedAssetIds: [] },
      }),
    );

    expect(error.durableState).toBe("committed_cleanup_pending");
    expect(error.assetIds).toEqual([staged.assetId]);
    expect(
      (
        await Effect.runPromise(
          harness.innerStore.getTask({
            repoPath: harness.repoPath,
            taskId: task.id,
          }),
        )
      ).description,
    ).toBe("Image removed");
  });

  test("reports promoted and obsolete IDs when update restoration fails", async () => {
    const harness = await createHarness();
    const { staged: obsolete, task, description } = await createTaskWithAsset(harness);
    const added = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "added.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: {
        ...harness.registry,
        updateTaskWithDescriptionAssets: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "update",
              code: "database",
              failedPhase: "save_transaction",
              taskId: task.id,
            }),
          ),
      },
      staging: harness.staging,
      filePort: {
        ...harness.filePort,
        restoreQuarantine: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "update",
              code: "restore",
              failedPhase: "restore_quarantine",
              taskId: task.id,
              assetIds: [obsolete.assetId],
            }),
          ),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.updateTask({
        repoPath: harness.repoPath,
        taskId: task.id,
        patch: { description: `![added](odt-asset:${added.assetId})` },
        descriptionAssets: { stagedAssetIds: [added.assetId] },
      }),
    );

    expect(error.durableState).toBe("unknown");
    expect(new Set(error.assetIds)).toEqual(new Set([obsolete.assetId, added.assetId]));
    expect(
      (
        await Effect.runPromise(
          harness.innerStore.getTask({
            repoPath: harness.repoPath,
            taskId: task.id,
          }),
        )
      ).description,
    ).toBe(description);
  });

  test("compensates a promotion failure by removing the newly created task", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "promotion.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      staging: harness.staging,
      filePort: {
        ...harness.filePort,
        promote: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "create",
              code: "promotion",
              failedPhase: "promote_staged_file",
              assetIds: [staged.assetId],
            }),
          ),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Promotion failure",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error.failedPhase).toBe("promote_staged_file");
    expect(
      await Effect.runPromise(harness.innerStore.listTasks({ repoPath: harness.repoPath })),
    ).toEqual([]);
  });

  test("returns created_partial with the created task and asset IDs when create compensation fails", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "partial.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        deleteTask: (input) =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "delete",
              code: "database",
              failedPhase: "delete_created_task",
              taskId: input.taskId,
            }),
          ),
      },
      registry: {
        ...harness.registry,
        registerAssets: (input) =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "create",
              code: "database",
              failedPhase: "register_assets",
              taskId: input.taskId,
              assetIds: input.assets.map((asset) => asset.id),
            }),
          ),
      },
      staging: harness.staging,
      filePort: harness.filePort,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Partial create",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error.durableState).toBe("created_partial");
    expect(error.retryAllowed).toBe(false);
    expect(error.taskId).toBeTruthy();
    expect(error.assetIds).toEqual([staged.assetId]);
  });

  test("reports deleted asset IDs for purge and restoration failures", async () => {
    const purgeHarness = await createHarness();
    const purgeOwned = await createTaskWithAsset(purgeHarness);
    const purgeStore = createTaskAssetAwareTaskStore({
      inner: purgeHarness.innerStore,
      registry: purgeHarness.registry,
      staging: purgeHarness.staging,
      filePort: {
        ...purgeHarness.filePort,
        purgeQuarantine: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "delete",
              code: "purge",
              failedPhase: "purge_quarantine",
              taskId: purgeOwned.task.id,
            }),
          ),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });
    const purgeError = await captureTaskAssetError(
      purgeStore.deleteTask({
        repoPath: purgeHarness.repoPath,
        taskId: purgeOwned.task.id,
        deleteSubtasks: false,
      }),
    );
    expect(purgeError.durableState).toBe("committed_cleanup_pending");
    expect(purgeError.assetIds).toEqual([purgeOwned.staged.assetId]);

    const restoreHarness = await createHarness();
    const restoreOwned = await createTaskWithAsset(restoreHarness);
    const restoreStore = createTaskAssetAwareTaskStore({
      inner: {
        ...restoreHarness.innerStore,
        deleteTask: (input) =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "delete",
              code: "database",
              failedPhase: "delete_task",
              taskId: input.taskId,
            }),
          ),
      },
      registry: restoreHarness.registry,
      staging: restoreHarness.staging,
      filePort: {
        ...restoreHarness.filePort,
        restoreQuarantine: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "delete",
              code: "restore",
              failedPhase: "restore_quarantine",
              taskId: restoreOwned.task.id,
            }),
          ),
      },
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });
    const restoreError = await captureTaskAssetError(
      restoreStore.deleteTask({
        repoPath: restoreHarness.repoPath,
        taskId: restoreOwned.task.id,
        deleteSubtasks: false,
      }),
    );
    expect(restoreError.durableState).toBe("unknown");
    expect(restoreError.assetIds).toEqual([restoreOwned.staged.assetId]);
  });
});
