import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createNodeTaskAssetFilePort } from "./filesystem-task-asset-file-port";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createHarness = async () => {
  const configDir = await mkdtemp(path.join(tmpdir(), "odt-task-assets-"));
  roots.push(configDir);
  return { configDir, port: createNodeTaskAssetFilePort({ configDir }) };
};

const workspaceId = "fairnest";
const taskId = "task-1";
const assetId = "550e8400-e29b-41d4-a716-446655440000";

describe("node task asset file port", () => {
  test("promotes, quarantines, restores, and purges within the dedicated namespace", async () => {
    const { configDir, port } = await createHarness();
    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1, 2, 3]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId }));
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toEqual(
      new Uint8Array([1, 2, 3]),
    );

    const quarantineId = await Effect.runPromise(
      port.quarantineAssets({ workspaceId, taskId, assetIds: [assetId] }),
    );
    expect(quarantineId).not.toBeNull();
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toBeNull();
    await Effect.runPromise(port.restoreQuarantine(quarantineId as string));
    expect(
      await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId })),
    ).not.toBeNull();

    const taskQuarantineId = await Effect.runPromise(
      port.quarantineTaskDirectory({ workspaceId, taskId }),
    );
    await Effect.runPromise(port.purgeQuarantine(taskQuarantineId as string));
    expect(
      await readFile(path.join(configDir, "task-asset-staging", workspaceId, assetId)),
    ).toEqual(Buffer.from([1, 2, 3]));
    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toBeNull();
  });

  test("rejects traversal identifiers and never follows a durable symlink", async () => {
    const { configDir, port } = await createHarness();
    await expect(
      Effect.runPromise(port.readDurable({ workspaceId, taskId: "../other", assetId })),
    ).rejects.toThrow("identifiers are invalid");

    await Effect.runPromise(port.stage({ workspaceId, assetId, bytes: new Uint8Array([1]) }));
    await Effect.runPromise(port.promote({ workspaceId, taskId, assetId }));
    const durablePath = path.join(configDir, "task-assets", workspaceId, taskId, assetId);
    const outsidePath = path.join(configDir, "outside.png");
    await writeFile(outsidePath, new Uint8Array([9]));
    await unlink(durablePath);
    await symlink(outsidePath, durablePath);

    expect(await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId }))).toBeNull();
  });

  test("restores earlier files when a multi-file quarantine fails partway", async () => {
    const { configDir, port } = await createHarness();
    const missingAssetId = "750e8400-e29b-41d4-a716-446655440001";
    for (const id of [assetId, missingAssetId]) {
      await Effect.runPromise(port.stage({ workspaceId, assetId: id, bytes: new Uint8Array([1]) }));
      await Effect.runPromise(port.promote({ workspaceId, taskId, assetId: id }));
    }
    await unlink(path.join(configDir, "task-assets", workspaceId, taskId, missingAssetId));

    await expect(
      Effect.runPromise(
        port.quarantineAssets({
          workspaceId,
          taskId,
          assetIds: [assetId, missingAssetId],
        }),
      ),
    ).rejects.toThrow(`Failed to quarantine obsolete task asset ${missingAssetId}`);
    expect(
      await Effect.runPromise(port.readDurable({ workspaceId, taskId, assetId })),
    ).not.toBeNull();
  });
});
