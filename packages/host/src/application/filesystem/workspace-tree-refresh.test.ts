import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, realpath, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  WorkspaceFileTreeEntry,
  WorkspaceFileTreeCursor,
  WorkspaceFileTreeContext,
  WorkspaceFileTreeRefreshResult,
} from "@openducktor/contracts";
import { Effect, Deferred, Fiber } from "effect";
import { createFilesystemAdapter } from "../../adapters/filesystem/filesystem-adapter";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createDefaultGitRunner } from "../../infrastructure/git/git-command-runner";
import { HostOperationError } from "../../effect/host-errors";
import { gitFixtureCommand, gitFixtureEnv } from "../../test-support/git-repository-fixture";
import { resolveGitWorkingDirectory } from "../git/git-service-inputs";
import { createWorkspaceFilesService } from "./workspace-files-service";

const liveRunner = createDefaultGitRunner(() => gitFixtureEnv, { command: gitFixtureCommand });
const repositorySeed = path.join(tmpdir(), `odt-tree-seed-${randomUUID()}`);

const runGit = async (root: string, args: string[]): Promise<void> => {
  await Effect.runPromise(
    liveRunner(root, [
      "-c",
      "user.name=Tree test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ]),
  );
};

beforeAll(async () => {
  await mkdir(repositorySeed);
  await runGit(repositorySeed, ["init", "--template=", "-b", "main"]);
  await mkdir(path.join(repositorySeed, "src"));
  await writeFile(path.join(repositorySeed, "src/entry.txt"), "original\n");
  await writeFile(path.join(repositorySeed, "collision"), "file\n");
  await writeFile(path.join(repositorySeed, ".gitignore"), "ignored*\n");
  await runGit(repositorySeed, ["add", "."]);
  await runGit(repositorySeed, ["commit", "-m", "initial"]);
  await runGit(repositorySeed, ["branch", "comparison"]);
});

afterAll(async () => {
  await rm(repositorySeed, { recursive: true, force: true });
});

const withRepository = async (
  run: (root: string, command: (args: string[]) => Promise<void>) => Promise<void>,
) => {
  const root = await mkdtemp(path.join(tmpdir(), "odt-tree-refresh-"));
  try {
    await cp(repositorySeed, root, { recursive: true });
    // The copied index must describe this checkout before a test measures its changes.
    await runGit(root, ["update-index", "--refresh"]);
    await run(root, (args) => runGit(root, args));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

describe("workspace tree refresh", () => {
  test("a full refresh reuses the Git panel checkout and reads fresh badges after inventory", async () => {
    await withRepository(async (root) => {
      const canonicalRoot = await realpath(root);
      const checkoutReads: string[] = [];
      let edited = false;
      const git = createGitCliAdapter({
        runner: (dir, args, options) =>
          Effect.gen(function* () {
            if (args.includes("--is-inside-work-tree") || args.includes("--show-toplevel")) {
              checkoutReads.push(dir);
            }
            if (args[0] === "ls-files" && args.at(-1) === "." && !edited) {
              edited = true;
              yield* Effect.promise(async () => {
                await writeFile(path.join(root, "collision"), "restored with edits\n");
                await writeFile(path.join(root, "src/entry.txt"), "edited\n");
                await writeFile(path.join(root, "new.txt"), "new\n");
              });
            }
            return yield* liveRunner(dir, args, options);
          }),
      });
      const service = createWorkspaceFilesService(createFilesystemAdapter(), git);
      try {
        const readContext = { refreshId: "refresh" };
        await Effect.runPromise(
          resolveGitWorkingDirectory(git, canonicalRoot, canonicalRoot, readContext),
        );
        expect(await Effect.runPromise(git.getStatus(canonicalRoot, readContext))).toEqual([]);
        await rm(path.join(root, "collision"));
        expect(
          await Effect.runPromise(git.listChangedFiles(canonicalRoot, "comparison", readContext)),
        ).toEqual([{ path: "collision", status: "deleted" }]);
        const result = await Effect.runPromise(
          service.refreshTree({
            rootPath: canonicalRoot,
            targetBranch: "comparison",
            mode: "full",
            ...readContext,
          }),
        );
        expect(checkoutReads).toEqual([canonicalRoot]);
        if (result.kind !== "snapshot") throw new Error("expected snapshot");
        const entries = new Map(result.entries.map((entry) => [entry.path, entry]));
        expect(entries.get("collision")?.gitStatus).toBe("modified");
        expect(entries.get("new.txt")?.gitStatus).toBe("untracked");
        expect(entries.get("src/entry.txt")?.gitStatus).toBe("modified");
      } finally {
        await Effect.runPromise(service.dispose());
        await Effect.runPromise(git.releaseReadCaptures());
      }
    });
  }, 10_000);

  // An incremental refresh reads real Git state after it creates a starting cursor.
  test("an incremental refresh reads edits made after an earlier Git capture", async () => {
    await withRepository(async (root) => {
      const git = createGitCliAdapter({ runner: liveRunner });
      const service = createWorkspaceFilesService(createFilesystemAdapter(), git);
      try {
        const common = { rootPath: root, targetBranch: "comparison" };
        const initial = await Effect.runPromise(
          service.refreshTree({ ...common, mode: "full", refreshId: "initial" }),
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
        const result = await Effect.runPromise(
          service.refreshTree({
            ...common,
            ...readContext,
            mode: "incremental",
            base: initial.cursor,
          }),
        );
        if (result.kind !== "patch") throw new Error("expected patch");
        expect(result.context).toEqual(initial.context);
        expect(result.removals).toEqual([]);
        expect(
          Object.fromEntries(result.upserts.map((entry) => [entry.path, entry.gitStatus])),
        ).toEqual({
          collision: "modified",
          "new.txt": "untracked",
          "src/entry.txt": "modified",
        });
      } finally {
        await Effect.runPromise(service.dispose());
        await Effect.runPromise(git.releaseReadCaptures());
      }
    });
  }, 20_000);

  // Real Git processes and multiple inventory batches need a longer timeout.
  test("refreshes a large dirty tree and keeps its cursor after a later Git batch fails", async () => {
    await withRepository(async (root) => {
      // Windows needs shorter names to fit its path limit and has a smaller argument budget.
      // Both fixtures need more than one Git batch.
      const windows = process.platform === "win32";
      const suffix = "a".repeat(windows ? 90 : 214);
      const names = Array.from(
        { length: windows ? 50 : 280 },
        (_, index) => `${String(index).padStart(6, "0")}-${suffix}.txt`,
      );
      names.push("[literal] é 空.txt", "-leading.txt");
      for (let start = 0; start < names.length; start += 100) {
        await Promise.all(
          names.slice(start, start + 100).map((name) => writeFile(path.join(root, name), "new\n")),
        );
      }
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
        Effect.result(
          service.refreshTree({
            rootPath: root,
            mode: "incremental",
            base: edited.cursor,
            refreshId: "failure",
          }),
        ),
      );
      if (failed._tag !== "Failure") throw new Error("expected failed refresh");
      expect(failed.failure._tag).toBe("HostValidationError");
      expect(failed.failure.message).toBe(
        "Unable to refresh workspace files: scoped inventory read failed",
      );
      expect(failed.failure.cause).toBe(failure);
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

  // Real Git processes read the final tree to check that no earlier entry is stale.
  test("matches a full tree read after edits, a staged rename, and file membership changes", async () => {
    await withRepository(async (root, command) => {
      const { calls, refresh, entries, expectMatchesFullRead } = treeFixture(root);
      expect((await refresh()).kind).toBe("snapshot");
      calls.length = 0;
      await writeFile(path.join(root, "src/entry.txt"), "edited\n");
      expect((await refresh()).kind).toBe("patch");
      expect(calls.filter((args) => args[0] === "ls-files" && args.at(-1) === ".")).toBeEmpty();
      expect(
        calls.filter(
          (args) => args[0] === "ls-files" && args.some((arg) => arg === ":(literal)src/entry.txt"),
        ),
      ).toHaveLength(1);
      expect(entries.get("src/entry.txt")?.gitStatus).toBe("modified");
      await writeFile(path.join(root, "src/entry.txt"), "edited again\n");
      expect((await refresh()).kind).toBe("unchanged");
      await mkdir(path.join(root, "new/deep"), { recursive: true });
      const addedPath =
        process.platform === "win32" ? "new/deep/[file] é 空.txt" : "new/deep/[file]\n.txt";
      await writeFile(path.join(root, addedPath), "new\n");
      await writeFile(path.join(root, "ignored.txt"), "hidden\n");
      await refresh();
      expect(entries.get(addedPath)).toMatchObject({ kind: "file", gitStatus: "untracked" });
      expect(entries.has("ignored.txt")).toBe(false);

      await rename(path.join(root, "src/entry.txt"), path.join(root, "src/renamed.txt"));
      await command(["add", "-f", "ignored.txt", "src"]);
      expect((await refresh()).kind).toBe("reset_required");
      await refresh("full");
      expect(entries.get("ignored.txt")).toMatchObject({ kind: "file", gitStatus: "added" });
      expect(entries.get("src/entry.txt")?.gitStatus).toBe("deleted");
      expect(entries.get("src/renamed.txt")?.gitStatus).toBe("added");
      await rm(path.join(root, "collision"));
      await mkdir(path.join(root, "collision"));
      await writeFile(path.join(root, "collision/child.txt"), "child\n");
      await refresh();
      expect(entries.get("collision")?.kind).toBe("directory");
      expect(entries.get("collision/child.txt")).toMatchObject({
        kind: "file",
        gitStatus: "untracked",
      });
      await rm(path.join(root, "collision"), { recursive: true });
      await writeFile(path.join(root, "collision"), "restored\n");
      await rm(path.join(root, "new"), { recursive: true });
      await refresh();
      expect(entries.get("collision")?.kind).toBe("file");
      expect(entries.has("collision/child.txt")).toBe(false);
      expect(entries.has("new")).toBe(false);
      expect(entries.has(addedPath)).toBe(false);
      await expectMatchesFullRead();
    });
  }, 20_000);

  // Each Git context change needs its own reset and fresh snapshot.
  test("resets after index, HEAD, branch, target, and sparse-policy changes, then stops", async () => {
    await withRepository(async (root, command) => {
      const { service, refresh, entries } = treeFixture(root);
      expect((await refresh()).kind).toBe("snapshot");
      const contextChanged = { kind: "reset_required", reason: "context_changed" } as const;
      await command(["update-index", "--skip-worktree", "src/entry.txt"]);
      expect(await refresh()).toEqual(contextChanged);
      await refresh("full");
      expect(entries.has("src/entry.txt")).toBe(false);
      await command(["update-index", "--no-skip-worktree", "src/entry.txt"]);
      expect(await refresh()).toEqual(contextChanged);
      await refresh("full");
      expect(entries.has("src/entry.txt")).toBe(true);
      await writeFile(path.join(root, "src/entry.txt"), "edited\n");
      await command(["commit", "-am", "changes"]);
      expect(await refresh()).toEqual(contextChanged);
      await refresh("full");
      expect(entries.get("src/entry.txt")?.gitStatus).toBe("modified");
      await command(["switch", "-c", "other"]);
      expect(await refresh()).toEqual(contextChanged);
      await refresh("full");
      await command(["update-ref", "refs/heads/comparison", "HEAD"]);
      expect(await refresh()).toEqual(contextChanged);
      await refresh("full");
      expect(entries.get("src/entry.txt")?.gitStatus).toBeNull();
      await command(["sparse-checkout", "set", "src"]);
      expect(await refresh()).toEqual(contextChanged);
      expect((await refresh("full")).kind).toBe("snapshot");
      await Effect.runPromise(service.dispose());
      await expect(refresh()).rejects.toThrow("Workspace file service has stopped");
    });
  }, 30_000);

  test("keeps rename endpoints correct across a selected subdirectory", async () => {
    await withRepository(async (root, command) => {
      const git = createGitCliAdapter({ runner: liveRunner });
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
    });
  }, 10_000);

  test("returns net changes for older clients, shares a projection across bases, and resets expired cursors", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "odt-tree-history-"));
    const filesystem = createFilesystemAdapter();
    const root = await Effect.runPromise(filesystem.canonicalize(directory));
    const context = {
      rootPath: root,
      gitDirectory: path.join(root, ".git"),
      branch: "main",
      head: "initial",
      targetBranch: null,
      targetRevision: null,
      indexVersion: "unchanged",
      sparsePolicy: "",
    } satisfies WorkspaceFileTreeContext;
    let modified = false,
      projections = 0;
    const inventory = [{ path: "stable.txt", kind: "file" as const }];
    const service = createWorkspaceFilesService(filesystem, {
      getCurrentBranch: () => Effect.succeed({ name: "main", detached: false }),
      readCheckout: () => Effect.succeed({ root, commonDirectory: `${root}/.git` }),
      listChangedFiles: () => Effect.succeed([]),
      getFileTreeContext: () => Effect.succeed(context),
      getRepositoryRoot: () => Effect.succeed(root),
      listFiles: () => Effect.succeed(inventory),
      listFileRegions: (_root, regions) => {
        projections += 1;
        return Effect.succeed(regions.includes("stable.txt") ? inventory : []);
      },
      getStatus: () =>
        Effect.succeed(modified ? [{ path: "stable.txt", status: "modified", staged: false }] : []),
    });
    try {
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
    } finally {
      await Effect.runPromise(service.dispose());
      await rm(directory, { recursive: true, force: true });
    }
  });

  // A real branch switch during status capture must invalidate the operation before publication.
  test("checks current identity again before publishing a pending projection", async () => {
    await withRepository(async (root, command) => {
      await command(["branch", "other"]);
      const git = createGitCliAdapter({ runner: liveRunner });
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

  test("shares an initial refresh and includes a later edit only in the queued refresh", async () => {
    await withRepository(async (root) => {
      const captured = Effect.runSync(Deferred.make<void>());
      const release = Effect.runSync(Deferred.make<void>());
      let inventories = 0;
      let readingFirstStatus = true;
      const git = createGitCliAdapter({ runner: liveRunner });
      const service = createWorkspaceFilesService(createFilesystemAdapter(), {
        ...git,
        listFiles: (...args) => {
          inventories += 1;
          return git.listFiles(...args);
        },
        getStatus: (...args) =>
          git.getStatus(...args).pipe(
            Effect.tap(() => {
              if (!readingFirstStatus) return Effect.void;
              readingFirstStatus = false;
              return Deferred.succeed(captured, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
              );
            }),
          ),
      });
      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const input = { rootPath: root, mode: "full" as const, refreshId: "initial" };
            const first = yield* Effect.forkChild(service.refreshTree(input));
            yield* Deferred.await(captured);
            const repeat = yield* Effect.forkChild(service.refreshTree(input));
            const later = yield* Effect.forkChild(
              service.refreshTree({ ...input, refreshId: "later" }),
            );
            yield* Effect.promise(() => writeFile(path.join(root, "late.txt"), "late\n"));
            yield* Deferred.succeed(release, undefined);
            const initial = yield* Fiber.join(first);
            const repeated = yield* Fiber.join(repeat);
            const latest = yield* Fiber.join(later);
            if (initial.kind !== "snapshot" || latest.kind !== "snapshot")
              throw new Error("expected both snapshots");
            expect(inventories).toBe(1);
            expect(repeated).toEqual(initial);
            expect(initial.entries.some((entry) => entry.path === "late.txt")).toBe(false);
            expect(latest.entries.find((entry) => entry.path === "late.txt")?.gitStatus).toBe(
              "untracked",
            );
          }),
        );
      } finally {
        await Effect.runPromise(service.dispose());
      }
    });
  }, 10_000);
});

function treeFixture(root: string) {
  const calls: string[][] = [];
  const git = createGitCliAdapter({
    runner: (dir, args, options) => {
      calls.push(args);
      return liveRunner(dir, args, options);
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
    if (result.kind !== "unchanged") applyTreeRefresh(entries, result);
    cursor = result.cursor;
    return result;
  };
  const expectMatchesFullRead = async () => {
    const fresh = await Effect.runPromise(
      service.listTree({ rootPath: root, targetBranch: "comparison" }),
    );
    expect([...entries.values()].sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [...fresh.entries].sort((a, b) => a.path.localeCompare(b.path)),
    );
  };
  return { calls, service, refresh, entries, expectMatchesFullRead };
}

function applyTreeRefresh(
  entries: Map<string, WorkspaceFileTreeEntry>,
  result: Extract<WorkspaceFileTreeRefreshResult, { kind: "snapshot" | "patch" }>,
) {
  if (result.kind === "snapshot") entries.clear();
  else for (const path of result.removals) entries.delete(path);
  for (const entry of result.kind === "snapshot" ? result.entries : result.upserts)
    entries.set(entry.path, entry);
}
