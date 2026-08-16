import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTaskAssetQuarantineFiles } from "./filesystem-task-asset-quarantine";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("createTaskAssetQuarantineFiles", () => {
  test("removes an interrupted unpublished quarantine before listing recovery entries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openducktor-quarantine-test-"));
    roots.push(root);
    const quarantineRoot = path.join(root, "quarantine");
    await mkdir(path.join(quarantineRoot, ".publishing-interrupted"), { recursive: true });
    const files = createTaskAssetQuarantineFiles({
      durableRoot: path.join(root, "durable"),
      quarantineRoot,
      reservedDirectoryNames: [],
    });

    await expect(files.list()).resolves.toEqual([]);
    await expect(readdir(quarantineRoot)).resolves.toEqual([]);
  });

  test("lets only one concurrent owner claim a quarantine", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openducktor-quarantine-test-"));
    roots.push(root);
    const quarantineRoot = path.join(root, "quarantine");
    const quarantineId = "550e8400-e29b-41d4-a716-446655440000";
    const createFiles = () =>
      createTaskAssetQuarantineFiles({
        durableRoot: path.join(root, "durable"),
        quarantineRoot,
        reservedDirectoryNames: [],
      });
    const source = createFiles();
    await source.write({
      version: 1,
      id: quarantineId,
      workspaceId: "fairnest",
      taskId: "task-1",
      operation: "create",
      assetIds: [],
      promotedAssetIds: [],
    });

    const results = await Promise.all([
      createFiles().claim(path.join(root, "first-owner")),
      createFiles().claim(path.join(root, "second-owner")),
    ]);

    expect(results.flat()).toEqual([quarantineId]);
  });
});
