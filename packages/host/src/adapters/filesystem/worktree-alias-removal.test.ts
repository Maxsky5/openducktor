import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { prepareWorktreeAliasRemoval } from "./worktree-alias-removal";

describe("worktree alias removal", () => {
  let root: string;
  let worktree: string;
  let alias: string;
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-alias-removal-")));
    worktree = path.join(root, "worktree");
    alias = path.join(root, "alias");
    await mkdir(worktree);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test.each([false, true])(
    "removes only the confirmed alias after worktree removal (chained: %s)",
    async (chained) => {
      const target = chained ? path.join(root, "intermediate") : worktree;
      if (chained) await symlink(worktree, target, "junction");
      await symlink(target, alias, "junction");
      const prepared = await Effect.runPromise(prepareWorktreeAliasRemoval(alias, worktree));
      await expect(Effect.runPromise(prepared.remove)).rejects.toThrow("still exists");
      expect(await realpath(alias)).toBe(worktree);
      await rm(worktree, { recursive: true });
      await Effect.runPromise(prepared.remove);
      await expect(lstat(alias)).rejects.toThrow("ENOENT");
      if (chained) expect((await lstat(target)).isSymbolicLink()).toBe(true);
      await Effect.runPromise(prepared.remove);
    },
  );

  test("removes an alias supplied with a trailing separator", async () => {
    await symlink(worktree, alias, "junction");
    const prepared = await Effect.runPromise(
      prepareWorktreeAliasRemoval(`${alias}${path.sep}`, worktree),
    );
    await rm(worktree, { recursive: true });
    await Effect.runPromise(prepared.remove);
    await expect(lstat(alias)).rejects.toThrow("ENOENT");
  });

  test("does not remove a symlink in the worktree's parent path", async () => {
    const parentAlias = path.join(root, "parent-alias");
    await symlink(root, parentAlias, "junction");
    const prepared = await Effect.runPromise(
      prepareWorktreeAliasRemoval(path.join(parentAlias, "worktree"), worktree),
    );
    await rm(worktree, { recursive: true });
    await Effect.runPromise(prepared.remove);
    expect(await realpath(parentAlias)).toBe(root);
  });

  test("rejects an alias that no longer points to the locked worktree", async () => {
    await symlink(root, alias, "junction");
    await expect(Effect.runPromise(prepareWorktreeAliasRemoval(alias, worktree))).rejects.toThrow(
      "changed",
    );
    expect(await realpath(alias)).toBe(root);
  });

  test("preserves an alias retargeted after preparation", async () => {
    await symlink(worktree, alias, "junction");
    const prepared = await Effect.runPromise(prepareWorktreeAliasRemoval(alias, worktree));
    await rm(worktree, { recursive: true });
    await unlink(alias);
    await symlink(root, alias, "junction");
    const target = await readlink(alias);
    await expect(Effect.runPromise(prepared.remove)).rejects.toThrow("changed during removal");
    expect(await readlink(alias)).toBe(target);
  });

  test("never recursively removes a replacement directory", async () => {
    await symlink(worktree, alias, "junction");
    const prepared = await Effect.runPromise(prepareWorktreeAliasRemoval(alias, worktree));
    await rm(worktree, { recursive: true });
    await unlink(alias);
    await mkdir(alias);
    await writeFile(path.join(alias, "keep.txt"), "keep");
    await expect(Effect.runPromise(prepared.remove)).rejects.toThrow();
    expect(await readFile(path.join(alias, "keep.txt"), "utf8")).toBe("keep");
  });
});
