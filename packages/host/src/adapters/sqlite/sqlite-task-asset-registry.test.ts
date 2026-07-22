import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveSqliteTaskStoreDatabasePath } from "../../infrastructure/sqlite/sqlite-task-store-path";
import { createSqliteTaskAssetRegistry } from "./sqlite-task-asset-registry";
import { createSqliteTaskStoreHarness } from "./sqlite-task-store-test-support";

const cleanups = new Set<() => Promise<void>>();

afterEach(async () => {
  await Promise.all(Array.from(cleanups, (cleanup) => cleanup()));
  cleanups.clear();
});

describe("SQLite task asset registry", () => {
  test("registers exact ownership and updates description rows in one transaction", async () => {
    const harness = await createSqliteTaskStoreHarness();
    cleanups.add(harness.cleanup);
    const registry = createSqliteTaskAssetRegistry({
      resolveDatabasePath: ({ workspaceId }) =>
        resolveSqliteTaskStoreDatabasePath({ configDir: harness.configDir, workspaceId }),
      resolveWorkspaceIdForRepoPath: () => Effect.succeed("fairnest"),
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
});
