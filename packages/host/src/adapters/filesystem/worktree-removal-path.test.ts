import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { resolveWorktreeRemovalPath } from "./worktree-removal-path";

describe("worktree removal path resolution", () => {
  let root: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-removal-path-")));
  });
  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  test("rejects dangling relative and chained links without following a new identity", async () => {
    const worktree = path.join(root, "worktree");
    const alias = path.join(root, "alias");
    const second = path.join(root, "second");
    await mkdir(worktree);
    await symlink("worktree", alias);
    await symlink(alias, second, "junction");
    expect(await Effect.runPromise(resolveWorktreeRemovalPath(second))).toBe(worktree);
    await rm(worktree, { recursive: true });
    await expect(Effect.runPromise(resolveWorktreeRemovalPath(second))).rejects.toThrow(
      "Cannot verify dangling worktree alias",
    );
    await expect(
      Effect.runPromise(resolveWorktreeRemovalPath(path.join(second, "missing"))),
    ).rejects.toThrow("Cannot verify dangling worktree alias");
    expect(await readlink(alias)).toBe("worktree");
    expect(await readlink(second)).toBe(alias);
  });

  test("resolves an absent path under a symlinked parent", async () => {
    const parentAlias = path.join(root, "parent");
    await symlink(root, parentAlias, "junction");
    expect(
      await Effect.runPromise(
        resolveWorktreeRemovalPath(path.join(parentAlias, "missing", "tree")),
      ),
    ).toBe(path.join(root, "missing", "tree"));
  });

  test("propagates a non-directory path error", async () => {
    const file = path.join(root, "file");
    await writeFile(file, "keep");
    await expect(
      Effect.runPromise(resolveWorktreeRemovalPath(path.join(file, "tree"))),
    ).rejects.toThrow("ENOTDIR");
  });

  test("propagates a symlink cycle instead of treating it as a removed path", async () => {
    const alias = path.join(root, "loop");
    await symlink(alias, alias);
    await expect(Effect.runPromise(resolveWorktreeRemovalPath(alias))).rejects.toThrow("ELOOP");
  });
});
