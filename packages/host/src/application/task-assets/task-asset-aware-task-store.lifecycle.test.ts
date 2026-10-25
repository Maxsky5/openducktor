import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber, Scheduler } from "effect";
import { createTaskAssetAwareTaskStore } from "./task-asset-aware-task-store";
import {
  createHarness,
  createTaskWithAsset,
  PNG_BASE64,
} from "./test-support/task-asset-aware-task-store";

describe("asset-aware task store lifecycle", () => {
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
        status: "open",
        task: {
          title: "With image",
          issueType: "task",
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
        status: "open",
        task: {
          title: "Referenced image",
          issueType: "task",
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
          status: "open",
          task: {
            title: "Forged",
            issueType: "task",
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
        status: "open",
        task: {
          title: "Owner",
          issueType: "task",
          priority: 2,
          description: `![owned](odt-asset:${staged.assetId})`,
        },
        descriptionAssets: { stagedAssetIds: [staged.assetId] },
      }),
    );
    const other = await Effect.runPromise(
      store.createTask({
        repoPath,
        status: "open",
        task: {
          title: "Other",
          issueType: "task",
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
        status: "open",
        task: {
          title: "Lifecycle",
          issueType: "task",
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

    await Effect.runPromise(store.deleteTask({ repoPath, taskId: task.id }));
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
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
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
      Effect.runFork(store.deleteTask({ repoPath: harness.repoPath, taskId: task.id }));

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
      store.deleteTask({ repoPath: harness.repoPath, taskId: task.id }),
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
        status: "open",
        task: { title: "Next", issueType: "task", priority: 2 },
      }),
    );
  });

  test("a delete interrupted at lock acquisition never leaves the lock held", async () => {
    // A fiber first yields after a fixed number of operations. The sweep moves that yield across
    // the lock transaction, so some runs stop after the lock commits and before the delete.
    const steps = (count: number) => {
      let effect: Effect.Effect<void> = Effect.void;
      for (let step = 0; step < count; step += 1) effect = effect.pipe(Effect.andThen(Effect.void));
      return effect;
    };
    const harness = await createHarness();
    const task = await Effect.runPromise(
      harness.store.createTask({
        repoPath: harness.repoPath,
        status: "open",
        task: { title: "Task", issueType: "task", priority: 2 },
      }),
    );
    const store = createTaskAssetAwareTaskStore({
      inner: {
        ...harness.innerStore,
        deleteTask: () => Effect.succeed(false),
        updateTask: () => Effect.succeed(task),
      },
      filePort: harness.filePort,
      registry: harness.registry,
      persistence: null,
      staging: harness.staging,
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
    });
    let interrupted = 0;
    const YIELD_BUDGET = 256;
    for (let count = 0; count < YIELD_BUDGET; count += 1) {
      const deletion = Effect.runFork(
        steps(count).pipe(
          Effect.andThen(
            store.deleteTask({
              repoPath: harness.repoPath,
              taskId: task.id,
            }),
          ),
          Effect.provideService(Scheduler.MaxOpsBeforeYield, YIELD_BUDGET),
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
