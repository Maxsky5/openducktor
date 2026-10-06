import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WorkspaceFileTreeEntry, WorkspaceFileTreeCursor } from "@openducktor/contracts";
import { Effect, Deferred, Fiber } from "effect";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import {
  createDefaultGitRunner,
  type GitCommandRunner,
} from "../../infrastructure/git/git-command-runner";
import { HostOperationError } from "../../effect/host-errors";
import { createWorkspaceFilesService } from "./workspace-files-service";

const withRepository = async (
  run: (root: string, command: (args: string[]) => Promise<void>) => Promise<void>,
) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-tree-refresh-"));
  const runner = createDefaultGitRunner(() => process.env, { command: "git" });
  const command = async (args: string[]) => {
    await Effect.runPromise(runner(root, args));
  };
  try {
    await command(["init", "-b", "main"]);
    await command(["config", "user.email", "test@example.com"]);
    await command(["config", "user.name", "Tree test"]);
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src/entry.txt"), "original\n");
    await writeFile(path.join(root, "collision"), "file\n");
    await writeFile(path.join(root, ".gitignore"), "ignored*\n");
    await command(["add", "."]);
    await command(["commit", "-m", "initial"]);
    await command(["branch", "comparison"]);
    await run(root, command);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("workspace tree refresh", () => {
  test("full refresh includes Git badges for edits made during the inventory read", async () => {
    await withRepository(async (root) => {
      const liveRunner = createDefaultGitRunner(() => process.env, { command: "git" });
      let edited = false;
      const git = createGitCliAdapter({
        runner: (dir, args, options) =>
          Effect.gen(function* () {
            if (args[0] === "ls-files" && args.at(-1) === "." && !edited) {
              edited = true;
              yield* Effect.promise(async () => {
                await writeFile(path.join(root, "src/entry.txt"), "edited\n");
                await writeFile(path.join(root, "new.txt"), "new\n");
              });
            }
            return yield* liveRunner(dir, args, options);
          }),
      });
      const service = createWorkspaceFilesService(createFilesystemAdapter(), git);
      try {
        const before = await Effect.runPromise(git.getFileTreeContext(root, "comparison"));
        const result = await Effect.runPromise(
          service.refreshTree({
            rootPath: root,
            targetBranch: "comparison",
            mode: "full",
            refreshId: "full",
          }),
        );
        expect(await Effect.runPromise(git.getFileTreeContext(root, "comparison"))).toEqual(before);
        if (result.kind !== "snapshot") throw new Error("expected snapshot");
        const entries = new Map(result.entries.map((entry) => [entry.path, entry]));
        expect(entries.get("new.txt")?.gitStatus).toBe("untracked");
        expect(entries.get("src/entry.txt")?.gitStatus).toBe("modified");
      } finally {
        await Effect.runPromise(service.dispose());
      }
    });
  });

  // Each case starts real Git processes for the stale reads and the tree refresh.
  test.each(["full", "incremental"] as const)(
    "%s refresh reads edits made after an earlier Git capture",
    async (mode) => {
      await withRepository(async (root) => {
        const git = createGitCliAdapter({
          runner: createDefaultGitRunner(() => process.env, { command: "git" }),
        });
        const service = createWorkspaceFilesService(createFilesystemAdapter(), git);
        try {
          const initial = await Effect.runPromise(
            service.refreshTree({
              rootPath: root,
              targetBranch: "comparison",
              mode: "full",
              refreshId: "initial",
            }),
          );
          if (initial.kind !== "snapshot") throw new Error("expected snapshot");
          const readContext = { refreshId: "refresh" };
          expect(await Effect.runPromise(git.getStatus(root, readContext))).toEqual([]);
          await rm(path.join(root, "collision"));
          expect(
            await Effect.runPromise(git.listChangedFiles(root, "comparison", readContext)),
          ).toEqual([{ path: "collision", status: "deleted" }]);
          await writeFile(path.join(root, "collision"), "restored with edits\n");
          await writeFile(path.join(root, "src/entry.txt"), "edited\n");
          await writeFile(path.join(root, "new.txt"), "new\n");
          expect(
            await Effect.runPromise(git.getFileTreeContext(initial.rootPath, "comparison")),
          ).toEqual(initial.context);
          const common = { rootPath: root, targetBranch: "comparison", ...readContext };
          const result = await Effect.runPromise(
            service.refreshTree(
              mode === "full" ? { ...common, mode } : { ...common, mode, base: initial.cursor },
            ),
          );
          expect(result.kind).toBe(mode === "full" ? "snapshot" : "patch");
          if (result.kind !== "snapshot" && result.kind !== "patch")
            throw new Error("expected updated tree");
          const entries = new Map(initial.entries.map((entry) => [entry.path, entry]));
          if (result.kind === "snapshot") entries.clear();
          else for (const name of result.removals) entries.delete(name);
          for (const entry of result.kind === "snapshot" ? result.entries : result.upserts)
            entries.set(entry.path, entry);
          expect(entries.get("new.txt")?.gitStatus).toBe("untracked");
          expect(entries.get("src/entry.txt")?.gitStatus).toBe("modified");
          expect(entries.get("collision")?.gitStatus).toBe("modified");
          const full = await Effect.runPromise(
            service.listTree({ rootPath: root, targetBranch: "comparison" }),
          );
          expect([...entries.values()].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
            [...full.entries].sort((a, b) => a.path.localeCompare(b.path)),
          );
        } finally {
          await Effect.runPromise(service.dispose());
          await Effect.runPromise(git.releaseReadCaptures());
        }
      });
    },
    10_000,
  );

  // Real Git processes and multiple inventory batches need a longer timeout.
  test("refreshes a large dirty tree and keeps its cursor after a later Git batch fails", async () => {
    await withRepository(async (root) => {
      const names = Array.from(
        { length: 1_000 },
        (_, index) => `${String(index).padStart(6, "0")}-${"a".repeat(90)}.txt`,
      );
      names.push("[literal] é 空.txt", "-leading.txt");
      for (let start = 0; start < names.length; start += 100) {
        await Promise.all(
          names.slice(start, start + 100).map((name) => writeFile(path.join(root, name), "new\n")),
        );
      }
      const liveRunner = createDefaultGitRunner(() => process.env, { command: "git" });
      let batches = 0;
      let failSecondBatch = false;
      const failure = new HostOperationError({
        operation: "git.execFile",
        message: "scoped inventory read failed",
      });
      const service = createWorkspaceFilesService(
        createFilesystemAdapter(),
        createGitCliAdapter({
          runner: (dir, args, options) => {
            if (args[0] === "ls-files" && args.at(-1) !== ".") {
              batches += 1;
              if (failSecondBatch && batches === 2) return Effect.fail(failure);
            }
            return liveRunner(dir, args, options);
          },
        }),
      );
      const initial = await Effect.runPromise(
        service.refreshTree({ rootPath: root, mode: "full", refreshId: "initial" }),
      );
      if (initial.kind !== "snapshot") throw new Error("expected snapshot");
      expect(initial.entries).toHaveLength(names.length + 4);
      const entries = new Map(initial.entries.map((entry) => [entry.path, entry]));
      await writeFile(path.join(root, "src/entry.txt"), "edited\n");
      const edited = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: initial.cursor,
          refreshId: "edited",
        }),
      );
      if (edited.kind !== "patch") throw new Error("expected edit patch");
      expect(edited.upserts).toEqual([
        { path: "src/entry.txt", kind: "file", size: null, mtimeMs: null, gitStatus: "modified" },
      ]);
      expect(edited.removals).toEqual([]);
      expect(batches).toBeGreaterThan(1);
      for (const entry of edited.upserts) entries.set(entry.path, entry);

      const added = "000000-new[é 空].txt";
      const removed = names.at(-1)!;
      await writeFile(path.join(root, added), "added\n");
      await rm(path.join(root, removed));
      batches = 0;
      failSecondBatch = true;
      const failed = await Effect.runPromise(
        Effect.either(
          service.refreshTree({
            rootPath: root,
            mode: "incremental",
            base: edited.cursor,
            refreshId: "failure",
          }),
        ),
      );
      if (failed._tag !== "Left") throw new Error("expected failed refresh");
      expect(failed.left._tag).toBe("HostValidationError");
      expect(failed.left.message).toBe(
        "Unable to refresh workspace files: scoped inventory read failed",
      );
      expect(failed.left.cause).toBe(failure);
      expect(batches).toBe(2);
      failSecondBatch = false;
      const recovered = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: edited.cursor,
          refreshId: "recover",
        }),
      );
      if (recovered.kind !== "patch") throw new Error("expected recovery patch");
      expect(recovered.cursor).toEqual({
        ...edited.cursor,
        revision: edited.cursor.revision + 1,
      });
      expect(recovered.upserts).toEqual([
        { path: added, kind: "file", size: null, mtimeMs: null, gitStatus: "untracked" },
      ]);
      expect(recovered.removals).toEqual([removed]);
      for (const name of recovered.removals) entries.delete(name);
      for (const entry of recovered.upserts) entries.set(entry.path, entry);
      const full = await Effect.runPromise(service.listTree({ rootPath: root }));
      expect([...entries.values()].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
        [...full.entries].sort((a, b) => a.path.localeCompare(b.path)),
      );
    });
  }, 30_000);

  // Real Git processes compare each refresh with an independent full read.
  test("matches full reads after edits, membership changes, and ignored-file changes", async () => {
    await withRepository(async (root, command) => {
      const { calls, refresh, entries } = treeFixture(root);
      expect((await refresh()).kind).toBe("snapshot");
      calls.length = 0;
      await writeFile(path.join(root, "src/entry.txt"), "edited\n");
      expect((await refresh()).kind).toBe("patch");
      // The assertion excludes the reference full read performed by the test.
      expect(calls.filter((args) => args[0] === "ls-files" && args.at(-1) === ".")).toHaveLength(1);
      expect(
        calls.filter(
          (args) => args[0] === "ls-files" && args.some((arg) => arg === ":(literal)src/entry.txt"),
        ),
      ).toHaveLength(1);
      await writeFile(path.join(root, "src/entry.txt"), "edited again\n");
      expect((await refresh()).kind).toBe("unchanged");
      await mkdir(path.join(root, "new/deep"), { recursive: true });
      const addedPath =
        process.platform === "win32" ? "new/deep/[file] é 空.txt" : "new/deep/[file]\n.txt";
      await writeFile(path.join(root, addedPath), "new\n");
      await writeFile(path.join(root, "ignored.txt"), "hidden\n");
      await refresh();
      expect(entries.has("ignored.txt")).toBe(false);
      await command(["add", "-f", "ignored.txt"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      expect(entries.has("ignored.txt")).toBe(true);
      await rm(path.join(root, "new"), { recursive: true });
      await refresh();
      expect(entries.has("new")).toBe(false);
    });
  }, 20_000);

  // Real Git processes compare each refresh with an independent full read.
  test("matches full reads after staging, renames, and file-directory changes", async () => {
    await withRepository(async (root, command) => {
      const { refresh, entries } = treeFixture(root);
      expect((await refresh()).kind).toBe("snapshot");
      await writeFile(path.join(root, "src/entry.txt"), "edited\n");
      await command(["add", "src/entry.txt"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      await command(["reset", "HEAD", "src/entry.txt"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      await rename(path.join(root, "src/entry.txt"), path.join(root, "src/renamed.txt"));
      await command(["add", "src"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      expect(entries.get("src/entry.txt")?.gitStatus).toBe("deleted");
      await rm(path.join(root, "collision"));
      await mkdir(path.join(root, "collision"));
      await writeFile(path.join(root, "collision/child.txt"), "child\n");
      await refresh();
      expect(entries.get("collision")?.kind).toBe("directory");
      await rm(path.join(root, "collision"), { recursive: true });
      await writeFile(path.join(root, "collision"), "restored\n");
      await refresh();
      expect(entries.has("collision/child.txt")).toBe(false);
    });
  }, 20_000);

  // Real Git processes compare each refresh with an independent full read.
  test("resets after index, HEAD, branch, target, and sparse-policy changes, then stops", async () => {
    await withRepository(async (root, command) => {
      const { service, refresh, entries } = treeFixture(root);
      expect((await refresh()).kind).toBe("snapshot");
      await command(["update-index", "--skip-worktree", "src/entry.txt"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      expect(entries.has("src/entry.txt")).toBe(false);
      await command(["update-index", "--no-skip-worktree", "src/entry.txt"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      expect(entries.has("src/entry.txt")).toBe(true);
      await writeFile(path.join(root, "src/entry.txt"), "edited\n");
      await command(["add", "."]);
      await command(["commit", "-m", "changes"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      await command(["branch", "other"]);
      await command(["switch", "other"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      await command(["update-ref", "refs/heads/comparison", "HEAD"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      await command(["sparse-checkout", "set", "src"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      await Effect.runPromise(service.dispose());
      await expect(refresh()).rejects.toThrow("Workspace file service has stopped");
    });
  }, 20_000);

  test("keeps rename endpoints correct across a selected subdirectory", async () => {
    await withRepository(async (root, command) => {
      const git = createGitCliAdapter({
        runner: createDefaultGitRunner(() => process.env, { command: "git" }),
      });
      const service = createWorkspaceFilesService(createFilesystemAdapter(), git);
      const selectedRoot = path.join(root, "src");
      const first = await Effect.runPromise(
        service.refreshTree({
          rootPath: selectedRoot,
          mode: "full",
          refreshId: randomUUID(),
          targetBranch: "comparison",
        }),
      );
      if (first.kind !== "snapshot") throw new Error("expected snapshot");
      await command(["mv", "src/entry.txt", "moved.txt"]);
      const result = await Effect.runPromise(
        service.refreshTree({
          rootPath: selectedRoot,
          mode: "incremental",
          base: first.cursor,
          refreshId: randomUUID(),
          targetBranch: "comparison",
        }),
      );
      expect(result.kind).toBe("reset_required");
      const fresh = await Effect.runPromise(
        service.refreshTree({
          rootPath: selectedRoot,
          mode: "full",
          refreshId: randomUUID(),
          targetBranch: "comparison",
        }),
      );
      if (fresh.kind !== "snapshot") throw new Error("expected snapshot");
      expect(fresh.entries).toEqual([
        { path: "entry.txt", kind: "file", size: null, mtimeMs: null, gitStatus: "deleted" },
      ]);
      expect(fresh.entries.some((entry) => entry.path === "../moved.txt")).toBe(false);
    });
  }, 10_000);

  test("returns net changes for older clients, shares a projection across bases, and resets expired cursors", async () => {
    await withRepository(async (root) => {
      const git = createGitCliAdapter({
        runner: createDefaultGitRunner(() => process.env, { command: "git" }),
      });
      const context = await Effect.runPromise(git.getFileTreeContext(root));
      let modified = false,
        projections = 0;
      const inventory = [{ path: "stable.txt", kind: "file" as const }];
      const service = createWorkspaceFilesService(createFilesystemAdapter(), {
        ...git,
        getFileTreeContext: () => Effect.succeed(context),
        listFiles: () => Effect.succeed(inventory),
        listFileRegions: (_root, regions) => {
          projections += 1;
          return Effect.succeed(regions.includes("stable.txt") ? inventory : []);
        },
        getStatus: () =>
          Effect.succeed(
            modified ? [{ path: "stable.txt", status: "modified", staged: false }] : [],
          ),
      });
      const first = await Effect.runPromise(
        service.refreshTree({ rootPath: root, mode: "full", refreshId: "first" }),
      );
      if (first.kind !== "snapshot") throw new Error("expected snapshot");
      modified = true;
      const changed = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: first.cursor,
          refreshId: "changed",
        }),
      );
      if (changed.kind !== "patch") throw new Error("expected patch");
      modified = false;
      const restored = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: first.cursor,
          refreshId: "restored",
        }),
      );
      expect(restored.kind).toBe("unchanged");
      const otherBase = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: changed.cursor,
          refreshId: "restored",
        }),
      );
      expect(otherBase.kind).toBe("patch");
      if (otherBase.kind !== "patch") throw new Error("expected patch");
      expect(otherBase.upserts).toEqual([
        { path: "stable.txt", kind: "file", size: null, mtimeMs: null, gitStatus: null },
      ]);
      const replayChanged = async () => {
        const replay = await Effect.runPromise(
          service.refreshTree({
            rootPath: root,
            mode: "incremental",
            base: first.cursor,
            refreshId: "changed",
          }),
        );
        expect(replay).toEqual({
          kind: "patch",
          rootPath: root,
          context,
          base: first.cursor,
          cursor: { viewId: first.cursor.viewId, revision: 1 },
          upserts: [
            { path: "stable.txt", kind: "file", size: null, mtimeMs: null, gitStatus: "modified" },
          ],
          removals: [],
        });
      };
      await replayChanged();
      expect(projections).toBe(2);
      let cursor = otherBase.cursor;
      for (let i = 0; i < 34; i++) {
        modified = !modified;
        const result = await Effect.runPromise(
          service.refreshTree({
            rootPath: root,
            mode: "incremental",
            base: cursor,
            refreshId: `revision-${i}`,
          }),
        );
        if (result.kind === "reset_required") throw new Error("current cursor expired");
        cursor = result.cursor;
      }
      await replayChanged();
      const delayedBase = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: changed.cursor,
          refreshId: "restored",
        }),
      );
      expect(delayedBase).toEqual({
        kind: "patch",
        rootPath: root,
        context,
        base: changed.cursor,
        cursor: { viewId: first.cursor.viewId, revision: 2 },
        upserts: [{ path: "stable.txt", kind: "file", size: null, mtimeMs: null, gitStatus: null }],
        removals: [],
      });
      const expired = await Effect.runPromise(
        service.refreshTree({
          rootPath: root,
          mode: "incremental",
          base: first.cursor,
          refreshId: "expired",
        }),
      );
      expect(expired).toEqual({ kind: "reset_required", reason: "expired_revision" });
    });
  });

  // A real branch switch during status capture must invalidate the operation before publication.
  test("checks current identity again before publishing a pending projection", async () => {
    await withRepository(async (root, command) => {
      await command(["branch", "other"]);
      const git = createGitCliAdapter({
        runner: createDefaultGitRunner(() => process.env, { command: "git" }),
      });
      let switchDuringRead = false;
      const service = createWorkspaceFilesService(createFilesystemAdapter(), {
        ...git,
        getStatus: (dir, context) =>
          git
            .getStatus(dir, context)
            .pipe(
              Effect.tap(() =>
                switchDuringRead ? Effect.promise(() => command(["switch", "other"])) : Effect.void,
              ),
            ),
      });
      const initial = await Effect.runPromise(
        service.refreshTree({ rootPath: root, mode: "full", refreshId: "initial" }),
      );
      if (initial.kind !== "snapshot") throw new Error("expected snapshot");
      await writeFile(path.join(root, "src/entry.txt"), "changed\n");
      switchDuringRead = true;
      expect(
        await Effect.runPromise(
          service.refreshTree({
            rootPath: root,
            mode: "incremental",
            base: initial.cursor,
            refreshId: "switch",
          }),
        ),
      ).toEqual({ kind: "reset_required", reason: "context_changed" });
      switchDuringRead = false;
      const current = await Effect.runPromise(
        service.refreshTree({ rootPath: root, mode: "full", refreshId: "current" }),
      );
      if (current.kind !== "snapshot") throw new Error("expected current snapshot");
      expect(current.context.branch).toBe("other");
      expect(current.entries.find((entry) => entry.path === "src/entry.txt")?.gitStatus).toBe(
        "modified",
      );
    });
  }, 10_000);

  test("shares initial reads, queues a later signal, and publishes no partial data after failure", async () => {
    await withRepository(async (root) => {
      const start = Effect.runSync(Deferred.make<void>()),
        release = Effect.runSync(Deferred.make<void>());
      const liveRunner = createDefaultGitRunner(() => process.env, { command: "git" });
      let inventories = 0,
        shouldFail = false;
      const runner: GitCommandRunner = (dir, args, options) =>
        Effect.gen(function* () {
          if (args[0] === "ls-files") {
            if (shouldFail)
              return yield* new HostOperationError({
                operation: "test",
                message: "inventory read failed",
              });
            if (args.at(-1) === ".") {
              inventories += 1;
              yield* Deferred.succeed(start, undefined);
              yield* Deferred.await(release);
            }
          }
          return yield* liveRunner(dir, args, options);
        });
      const service = createWorkspaceFilesService(
        createFilesystemAdapter(),
        createGitCliAdapter({ runner }),
      );
      await Effect.runPromise(
        Effect.gen(function* () {
          const input = { rootPath: root, mode: "full" as const, refreshId: "initial" };
          const a = yield* Effect.fork(service.refreshTree(input));
          yield* Deferred.await(start);
          const b = yield* Effect.fork(service.refreshTree(input));
          const c = yield* Effect.fork(service.refreshTree({ ...input, refreshId: "later" }));
          yield* Effect.promise(() => writeFile(path.join(root, "late.txt"), "late\n"));
          yield* Deferred.succeed(release, undefined);
          const results = yield* Effect.all([Fiber.join(a), Fiber.join(b), Fiber.join(c)]);
          expect(inventories).toBe(1);
          expect(results[0]).toEqual(results[1]);
          const latest = results[2];
          if (latest?.kind !== "snapshot") throw new Error("expected later snapshot");
          expect(latest.entries.some((entry) => entry.path === "late.txt")).toBe(true);
          shouldFail = true;
          const failed = yield* Effect.either(
            service.refreshTree({
              rootPath: root,
              mode: "incremental",
              base: latest.cursor,
              refreshId: "failure",
            }),
          );
          expect(failed._tag).toBe("Left");
          shouldFail = false;
          const recovered = yield* service.refreshTree({
            rootPath: root,
            mode: "incremental",
            base: latest.cursor,
            refreshId: "recover",
          });
          expect(recovered.kind).toBe("unchanged");
        }),
      );
    });
  }, 10_000);
});

function treeFixture(root: string) {
  const calls: string[][] = [];
  const runner = createDefaultGitRunner(() => process.env, { command: "git" });
  const git = createGitCliAdapter({
    runner: (dir, args, options) => {
      calls.push(args);
      return runner(dir, args, options);
    },
  });
  const service = createWorkspaceFilesService(createFilesystemAdapter(), git);
  let cursor: WorkspaceFileTreeCursor | undefined;
  const entries = new Map<string, WorkspaceFileTreeEntry>();
  const refresh = async (mode: "incremental" | "full" = "incremental") => {
    const result = await Effect.runPromise(
      service.refreshTree(
        cursor && mode !== "full"
          ? {
              rootPath: root,
              targetBranch: "comparison",
              mode: "incremental",
              base: cursor,
              refreshId: randomUUID(),
            }
          : {
              rootPath: root,
              targetBranch: "comparison",
              mode: "full",
              refreshId: randomUUID(),
            },
      ),
    );
    if (result.kind === "reset_required") return result;
    if (result.kind === "snapshot") {
      entries.clear();
      for (const entry of result.entries) entries.set(entry.path, entry);
    }
    if (result.kind === "patch") {
      for (const path of result.removals) entries.delete(path);
      for (const entry of result.upserts) entries.set(entry.path, entry);
    }
    cursor = result.cursor;
    const fresh = await Effect.runPromise(
      service.listTree({ rootPath: root, targetBranch: "comparison" }),
    );
    expect([...entries.values()].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [...fresh.entries].sort((a, b) => a.path.localeCompare(b.path)),
    );
    return result;
  };
  return { calls, service, refresh, entries };
}
