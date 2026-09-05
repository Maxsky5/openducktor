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
});
