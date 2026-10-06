import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { createTaskAssetAwareTaskStore } from "./task-asset-aware-task-store";
import {
  createHarness,
  createTaskWithAsset,
  PNG_BASE64,
} from "./test-support/task-asset-aware-task-store";

describe("asset-aware task store lifecycle", () => {
  test("rejects child creation when another task store deletes its validated parent", async () => {
    const harness = await createHarness();
    const parent = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Parent",
          issueType: "epic",
          aiReviewEnabled: true,
          priority: 2,
          description: "",
        },
      }),
    );
    let releaseParentSnapshot: (() => void) | undefined;
    let reportParentSnapshotRead: (() => void) | undefined;
    const parentSnapshotRead = new Promise<void>((resolve) => {
      reportParentSnapshotRead = resolve;
    });
    const parentSnapshotRelease = new Promise<void>((resolve) => {
      releaseParentSnapshot = resolve;
    });
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "late-child.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const childStore = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        listTasks: (input) =>
          Effect.gen(function* () {
            const tasks = yield* harness.innerStore.listTasks(input);
            reportParentSnapshotRead?.();
            yield* Effect.promise(() => parentSnapshotRelease);
            return tasks;
          }),
      },
      filePort: harness.filePort,
      registry: harness.registry,
      persistence: harness.registry,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const creation = Effect.runPromise(
      childStore.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Late child",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![Late child](odt-asset:${staged.assetId})`,
          parentId: parent.id,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );
    await parentSnapshotRead;
    await Effect.runPromise(
      harness.store.deleteTask({
        repoPath: harness.repoPath,
        taskId: parent.id,
        deleteSubtasks: true,
      }),
    );
    releaseParentSnapshot?.();

    await expect(creation).rejects.toThrow(
      "Failed to create the task with its description assets.",
    );
    expect(
      await Effect.runPromise(harness.store.listTasks({ repoPath: harness.repoPath })),
    ).toEqual([]);
  });

  test("serializes descendant creation with recursive deletion", async () => {
    const harness = await createHarness();
    const parent = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Parent",
          issueType: "epic",
          aiReviewEnabled: true,
          priority: 2,
          description: "",
        },
      }),
    );
    let releaseQuarantine: (() => void) | undefined;
    let reportQuarantineStarted: (() => void) | undefined;
    const quarantineStarted = new Promise<void>((resolve) => {
      reportQuarantineStarted = resolve;
    });
    const quarantineRelease = new Promise<void>((resolve) => {
      releaseQuarantine = resolve;
    });
    const filePort = {
      ...harness.filePort,
      quarantineTaskDirectory: (
        input: Parameters<typeof harness.filePort.quarantineTaskDirectory>[0],
      ) =>
        Effect.gen(function* () {
          reportQuarantineStarted?.();
          yield* Effect.promise(() => quarantineRelease);
          return yield* harness.filePort.quarantineTaskDirectory(input);
        }),
    };
    const store = createTaskAssetAwareTaskStore({
      inner: harness.innerStore,
      filePort,
      registry: harness.registry,
      persistence: harness.registry,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const deletion = Effect.runPromise(
      store.deleteTask({ repoPath: harness.repoPath, taskId: parent.id, deleteSubtasks: true }),
    );
    await quarantineStarted;
    let creationSettled = false;
    const creation = Effect.runPromise(
      store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Late child",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: "",
          parentId: parent.id,
        },
      }),
    ).finally(() => {
      creationSettled = true;
    });
    await Promise.resolve();
    expect(creationSettled).toBe(false);

    releaseQuarantine?.();
    await deletion;
    await expect(creation).rejects.toThrow(`Task not found: ${parent.id}`);
    expect(await Effect.runPromise(store.listTasks({ repoPath: harness.repoPath }))).toEqual([]);
  });

  test("restores quarantined assets when another store reparents a delete target", async () => {
    const harness = await createHarness();
    const parent = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Parent",
          issueType: "epic",
          aiReviewEnabled: true,
          priority: 2,
          description: "",
        },
      }),
    );
    const staged = await Effect.runPromise(
      harness.staging.stage({
        workspaceId: "fairnest",
        scope: "description",
        originalName: "child.png",
        declaredMediaType: "image/png",
        bytesBase64: PNG_BASE64,
      }),
    );
    const child = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: {
          title: "Child",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![Child](odt-asset:${staged.assetId})`,
          parentId: parent.id,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );
    let reportDeleteStarted: (() => void) | undefined;
    let releaseDelete: (() => void) | undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      reportDeleteStarted = resolve;
    });
    const deleteRelease = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deletingStore = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        deleteTask: (input) =>
          Effect.gen(function* () {
            reportDeleteStarted?.();
            yield* Effect.promise(() => deleteRelease);
            return yield* harness.innerStore.deleteTask(input);
          }),
      },
      filePort: harness.filePort,
      registry: harness.registry,
      persistence: harness.registry,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const deletion = Effect.runPromise(
      deletingStore.deleteTask({
        repoPath: harness.repoPath,
        taskId: parent.id,
        deleteSubtasks: true,
      }),
    );
    await deleteStarted;
    await Effect.runPromise(
      harness.innerStore.updateTask({
        repoPath: harness.repoPath,
        taskId: child.id,
        patch: { parentId: "" },
      }),
    );
    releaseDelete?.();

    await expect(deletion).rejects.toThrow();
    expect(
      await Effect.runPromise(
        harness.innerStore.getTask({
          repoPath: harness.repoPath,
          taskId: parent.id,
        }),
      ),
    ).toMatchObject({ id: parent.id });
    expect(
      await Effect.runPromise(
        harness.innerStore.getTask({
          repoPath: harness.repoPath,
          taskId: child.id,
        }),
      ),
    ).toMatchObject({ id: child.id, parentId: undefined });
    expect(
      await Effect.runPromise(
        harness.filePort.readDurable({
          workspaceId: "fairnest",
          taskId: child.id,
          assetId: staged.assetId,
        }),
      ),
    ).not.toBeNull();
  });

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

  test("keeps an existing asset when its image changes to reference syntax", async () => {
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
    const task = await Effect.runPromise(
      store.createTask({
        repoPath,
        task: {
          title: "Referenced image",
          issueType: "task",
          aiReviewEnabled: true,
          priority: 2,
          description: `![Architecture](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );
    const referencedDescription = [
      "![Architecture][diagram]",
      "",
      `[diagram]: odt-asset:${staged.assetId}`,
    ].join("\n");

    const updated = await Effect.runPromise(
      store.updateTask({
        repoPath,
        taskId: task.id,
        patch: { description: referencedDescription },
        descriptionAssets: { stagedAssetIds: [] },
      }),
    );

    expect(updated.description).toBe(referencedDescription);
    expect(
      await Effect.runPromise(
        registry.listAssets({ repoPath, taskId: task.id, scope: "description" }),
      ),
    ).toEqual([expect.objectContaining({ id: staged.assetId })]);
    expect(
      await Effect.runPromise(
        filePort.readDurable({
          workspaceId: "fairnest",
          taskId: task.id,
          assetId: staged.assetId,
        }),
      ),
    ).not.toBeNull();
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

  test("shares the mutation lock between updates and lets a queued delete be canceled", async () => {
    const harness = await createHarness();
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: { title: "Task", issueType: "task", aiReviewEnabled: true, priority: 2 },
      }),
    );
    const events: string[] = [];
    const bothUpdatesEntered = Deferred.makeUnsafe<void>();
    const releaseUpdates = Deferred.makeUnsafe<void>();
    let enteredUpdates = 0;
    const store = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        updateTask: (input) =>
          Effect.gen(function* () {
            enteredUpdates += 1;
            if (enteredUpdates === 2) yield* Deferred.succeed(bothUpdatesEntered, undefined);
            yield* Deferred.await(releaseUpdates);
            events.push(`update ${input.patch.title}`);
            return yield* harness.innerStore.updateTask(input);
          }),
        deleteTask: (input) =>
          Effect.sync(() => events.push("delete")).pipe(
            Effect.andThen(harness.innerStore.deleteTask(input)),
          ),
      },
      filePort: harness.filePort,
      registry: harness.registry,
      persistence: null,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });
    const update = (title: string) =>
      Effect.runFork(
        store.updateTask({ repoPath: harness.repoPath, taskId: task.id, patch: { title } }),
      );
    const remove = () =>
      Effect.runFork(
        store.deleteTask({ repoPath: harness.repoPath, taskId: task.id, deleteSubtasks: false }),
      );

    const first = update("first");
    const second = update("second");
    await Effect.runPromise(Deferred.await(bothUpdatesEntered));
    // A delete that still waits for the lock stops at once and changes nothing.
    const canceled = remove();
    await Effect.runPromise(Fiber.interrupt(canceled));
    expect(Exit.hasInterrupts(await Effect.runPromise(Fiber.await(canceled)))).toBe(true);
    const deletion = remove();
    await Effect.runPromise(Effect.sleep("10 millis"));
    expect(events).toEqual([]);

    await Effect.runPromise(Deferred.succeed(releaseUpdates, undefined));
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(Fiber.join(second));
    expect(await Effect.runPromise(Fiber.join(deletion))).toBe(true);
    expect(events.slice(-1)).toEqual(["delete"]);
    expect(events.toSorted()).toEqual(["delete", "update first", "update second"]);
  });

  test("a delete canceled after quarantine still commits and purges before it releases the lock", async () => {
    const harness = await createHarness();
    const { task } = await createTaskWithAsset(harness);
    const events: string[] = [];
    const quarantined = Deferred.makeUnsafe<void>();
    const releaseDelete = Deferred.makeUnsafe<void>();
    const store = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        deleteTask: (input) =>
          Deferred.await(releaseDelete).pipe(
            Effect.andThen(harness.innerStore.deleteTask(input)),
            Effect.tap(() => Effect.sync(() => events.push("deleted"))),
          ),
      },
      filePort: {
        ...harness.filePort,
        quarantineTaskDirectory: (input) =>
          harness.filePort.quarantineTaskDirectory(input).pipe(
            Effect.tap(() => Effect.sync(() => events.push("quarantined"))),
            Effect.tap(() => Deferred.succeed(quarantined, undefined)),
          ),
        restoreQuarantine: (quarantineId) =>
          Effect.sync(() => events.push("restored")).pipe(
            Effect.andThen(harness.filePort.restoreQuarantine(quarantineId)),
          ),
        purgeQuarantine: (quarantineId) =>
          harness.filePort
            .purgeQuarantine(quarantineId)
            .pipe(Effect.tap(() => Effect.sync(() => events.push("purged")))),
      },
      registry: harness.registry,
      persistence: harness.registry,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });

    const deletion = Effect.runFork(
      store.deleteTask({ repoPath: harness.repoPath, taskId: task.id, deleteSubtasks: false }),
    );
    await Effect.runPromise(Deferred.await(quarantined));
    deletion.interruptUnsafe();
    await Effect.runPromise(Deferred.succeed(releaseDelete, undefined));
    await Effect.runPromise(Fiber.await(deletion));

    expect(events).toEqual(["quarantined", "deleted", "purged"]);
    const tasks = await Effect.runPromise(
      harness.innerStore.listTasks({ repoPath: harness.repoPath }),
    );
    expect(tasks.map(({ id }) => id)).not.toContain(task.id);
    // The lock is free again.
    await Effect.runPromise(
      store.createTask({
        repoPath: harness.repoPath,
        task: { title: "Next", issueType: "task", aiReviewEnabled: true, priority: 2 },
      }),
    );
  });

  test("a delete interrupted at lock acquisition never leaves the lock held", async () => {
    // A fiber yields after a fixed number of operations. The sweep moves the yield across the
    // lock transaction, so some runs are interrupted after the lock commits and before the delete.
    const steps = (count: number) => {
      let effect: Effect.Effect<void> = Effect.void;
      for (let step = 0; step < count; step += 1) effect = effect.pipe(Effect.andThen(Effect.void));
      return effect;
    };
    const harness = await createHarness();
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        task: { title: "Task", issueType: "task", aiReviewEnabled: true, priority: 2 },
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: { ...harness.innerStore, deleteTask: () => Effect.succeed(false) },
      filePort: harness.filePort,
      registry: harness.registry,
      persistence: null,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });
    let interrupted = 0;
    for (let count = 1900; count < 2100; count += 1) {
      const deletion = Effect.runFork(
        steps(count).pipe(
          Effect.andThen(
            store.deleteTask({
              repoPath: harness.repoPath,
              taskId: task.id,
              deleteSubtasks: false,
            }),
          ),
        ),
      );
      await Effect.runPromise(Effect.yieldNow);
      deletion.interruptUnsafe();
      if (Exit.hasInterrupts(await Effect.runPromise(Fiber.await(deletion)))) interrupted += 1;
      const update = await Effect.runPromise(
        store
          .updateTask({ repoPath: harness.repoPath, taskId: task.id, patch: { title: `${count}` } })
          .pipe(Effect.timeoutOption("1 second")),
      );
      expect(update._tag).toBe("Some");
    }
    expect(interrupted).toBeGreaterThan(0);
  });
});
