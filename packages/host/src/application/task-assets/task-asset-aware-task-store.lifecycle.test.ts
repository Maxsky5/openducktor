import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createTaskAssetAwareTaskStore } from "./task-asset-aware-task-store";
import { createHarness, PNG_BASE64 } from "./test-support/task-asset-aware-task-store";

describe("asset-aware task store lifecycle", () => {
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
    await expect(creation).resolves.toMatchObject({ parentId: parent.id, title: "Late child" });
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
});
