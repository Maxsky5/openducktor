import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostDependencyError } from "../../effect/host-errors";
import { TaskAssetError } from "../../effect/task-asset-error";
import { createTaskAssetAwareTaskStore } from "./task-asset-aware-task-store";
import {
  captureTaskAssetError,
  createHarness,
  createTaskWithAsset,
  injectedTaskAssetError,
  PNG_BASE64,
} from "./test-support/task-asset-aware-task-store";

describe("asset-aware task store compensation", () => {
  test("reports obsolete IDs when post-commit update purge fails", async () => {
    const harness = await createHarness();
    const { staged, task } = await createTaskWithAsset(harness);
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: harness.registry,
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
    let restoreAttempts = 0;
    let removeAttempts = 0;
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: {
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
        restoreQuarantine: () => {
          restoreAttempts += 1;
          return Effect.fail(
            injectedTaskAssetError({
              operation: "update",
              code: "restore",
              failedPhase: "restore_quarantine",
              taskId: task.id,
              assetIds: [obsolete.assetId],
            }),
          );
        },
        removeDurable: () => {
          removeAttempts += 1;
          return Effect.fail(
            injectedTaskAssetError({
              operation: "update",
              code: "restore",
              failedPhase: "remove_promoted_files",
              taskId: task.id,
              assetIds: [added.assetId],
            }),
          );
        },
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
    expect(restoreAttempts).toBe(1);
    expect(removeAttempts).toBe(1);
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
      persistence: harness.registry,
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

  test("reuses the resolved workspace while compensating a failed create", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "resolver-create.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    let resolverCalls = 0;
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: {
        ...harness.registry,
        createTaskWithDescriptionAssets: (input) =>
          harness.registry.createTaskWithDescriptionAssets({
            ...input,
            prepareFiles: (taskId) =>
              Effect.gen(function* () {
                yield* input.prepareFiles(taskId);
                return yield* injectedTaskAssetError({
                  operation: "create",
                  code: "database",
                  failedPhase: "register_assets",
                  taskId,
                  assetIds: input.assets.map((asset) => asset.id),
                });
              }),
          }),
      },
      staging: harness.staging,
      filePort: harness.filePort,
      resolveWorkspaceIdForRepoPath: () => {
        resolverCalls += 1;
        return resolverCalls === 1
          ? Effect.succeed("fairnest")
          : Effect.fail(
              new HostDependencyError({
                dependency: "workspace-settings",
                operation: "resolve",
                message: "Injected resolver failure.",
              }),
            );
      },
    });

    const error = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Resolver create failure",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error.failedPhase).toBe("register_assets");
    expect(resolverCalls).toBe(1);
    expect(
      await Effect.runPromise(harness.innerStore.listTasks({ repoPath: harness.repoPath })),
    ).toEqual([]);
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: error.taskId as string,
          assetId: staged.assetId,
        }),
      ),
    ).toBeNull();
  });

  test("reports unchanged state after a destination collision rolls back the task", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "collision.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: {
        ...harness.registry,
        createTaskWithDescriptionAssets: (input) =>
          harness.registry.createTaskWithDescriptionAssets({
            ...input,
            prepareFiles: (taskId) =>
              Effect.gen(function* () {
                yield* harness.filePort.promote({
                  workspaceId: "fairnest",
                  taskId,
                  assetId: staged.assetId,
                  operation: "create",
                });
                return yield* input.prepareFiles(taskId);
              }),
          }),
      },
      staging: harness.staging,
      filePort: harness.filePort,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Destination collision",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error.failedPhase).toBe("check_destination");
    expect(error.durableState).toBe("unchanged");
    expect(error.retryAllowed).toBe(false);
    if (!error.taskId) {
      throw new Error("Expected the rolled-back task ID.");
    }
    expect(
      await Effect.runPromise(harness.innerStore.listTasks({ repoPath: harness.repoPath })),
    ).toEqual([]);
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: error.taskId,
          assetId: staged.assetId,
        }),
      ),
    ).not.toBeNull();
  });

  test("reports quarantine purge as the failed create cleanup phase", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "purge.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: harness.registry,
      staging: harness.staging,
      filePort: {
        ...harness.filePort,
        purgeQuarantine: () =>
          Effect.fail(
            injectedTaskAssetError({
              operation: "create",
              code: "purge",
              failedPhase: "purge_quarantine",
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
          title: "Purge failure",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error.failedPhase).toBe("purge_create_quarantine");
    expect(error.durableState).toBe("committed_cleanup_pending");
  });

  test("reports staging discard as the failed create cleanup phase", async () => {
    const harness = await createHarness();
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "discard.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: harness.registry,
      staging: {
        ...harness.staging,
        discard: () =>
          Effect.fail(
            new TaskAssetError({
              operation: "stage",
              code: "purge",
              assetIds: [staged.assetId],
              failedPhase: "discard_staging",
              durableState: "unchanged",
              retryAllowed: true,
              message: "Injected staging discard failure.",
            }),
          ),
      },
      filePort: harness.filePort,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const error = await captureTaskAssetError(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Discard failure",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![image](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );

    expect(error.failedPhase).toBe("discard_committed_staging");
    expect(error.durableState).toBe("committed_cleanup_pending");
  });

  test("reuses the resolved workspace while compensating a failed update", async () => {
    const harness = await createHarness();
    const { staged: obsolete, task, description } = await createTaskWithAsset(harness);
    const added = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "resolver-update.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    let resolverCalls = 0;
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: {
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
      filePort: harness.filePort,
      resolveWorkspaceIdForRepoPath: () => {
        resolverCalls += 1;
        return resolverCalls === 1
          ? Effect.succeed("fairnest")
          : Effect.fail(
              new HostDependencyError({
                dependency: "workspace-settings",
                operation: "resolve",
                message: "Injected resolver failure.",
              }),
            );
      },
    });

    const error = await captureTaskAssetError(
      store.updateTask({
        repoPath: harness.repoPath,
        taskId: task.id,
        patch: { description: `![added](odt-asset:${added.assetId})` },
        descriptionAssets: { stagedAssetIds: [added.assetId] },
      }),
    );

    expect(error.failedPhase).toBe("save_transaction");
    expect(resolverCalls).toBe(1);
    expect(
      (
        await Effect.runPromise(
          harness.innerStore.getTask({ repoPath: harness.repoPath, taskId: task.id }),
        )
      ).description,
    ).toBe(description);
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: obsolete.assetId,
        }),
      ),
    ).not.toBeNull();
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: added.assetId,
        }),
      ),
    ).toBeNull();
  });

  test("returns created_partial with task and asset IDs when rollback file cleanup fails", async () => {
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
    let removeAttempts = 0;
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      registry: harness.registry,
      persistence: {
        ...harness.registry,
        createTaskWithDescriptionAssets: (input) =>
          harness.registry.createTaskWithDescriptionAssets({
            ...input,
            prepareFiles: (taskId) =>
              Effect.gen(function* () {
                yield* input.prepareFiles(taskId);
                return yield* injectedTaskAssetError({
                  operation: "create",
                  code: "database",
                  failedPhase: "register_assets",
                  taskId,
                  assetIds: input.assets.map((asset) => asset.id),
                });
              }),
          }),
      },
      staging: harness.staging,
      filePort: {
        ...harness.filePort,
        removeDurable: (input) => {
          removeAttempts += 1;
          return Effect.fail(
            injectedTaskAssetError({
              operation: "create",
              code: "restore",
              failedPhase: "remove_promoted_files",
              taskId: input.taskId,
              assetIds: input.assetIds,
            }),
          );
        },
      },
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
    expect(removeAttempts).toBe(1);
  });

  test("reports deleted asset IDs for purge and restoration failures", async () => {
    const purgeHarness = await createHarness();
    const purgeOwned = await createTaskWithAsset(purgeHarness);
    const purgeStore = createTaskAssetAwareTaskStore({
      inner: purgeHarness.innerStore,
      registry: purgeHarness.registry,
      persistence: purgeHarness.registry,
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
      persistence: restoreHarness.registry,
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
