import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createUsageRepositoryResolver } from "./usage-repositories";

/** Resolves folders with caches for one call. */
const resolveUsageRepositories = (folders: readonly string[], known: readonly string[]) =>
  createUsageRepositoryResolver()(folders, known);

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-usage-repositories-")));
});

afterEach(async () => {
  await removeTestDirectory(root);
});

/** A main repository and a linked worktree of it, as git writes them. */
const repositoryWithWorktree = async (repository: string, worktree: string) => {
  const gitDir = path.join(repository, ".git", "worktrees", path.basename(worktree));
  await mkdir(gitDir, { recursive: true });
  await writeFile(path.join(gitDir, "commondir"), "../..\n");
  await mkdir(worktree, { recursive: true });
  await writeFile(path.join(worktree, ".git"), `gitdir: ${gitDir}\n`);
};

describe("createUsageRepositoryResolver", () => {
  test("reads the main repository of a folder, a linked worktree, and a folder inside them", async () => {
    const app = path.join(root, "code", "app");
    const worktree = path.join(root, "tool", "worktrees", "app", "task-1");
    await repositoryWithWorktree(app, worktree);
    await mkdir(path.join(worktree, "packages", "host"), { recursive: true });

    const { fromGit, inferred } = resolveUsageRepositories(
      [app, worktree, path.join(worktree, "packages", "host"), path.join(app, "deleted")],
      [],
    );

    expect(Object.fromEntries(fromGit)).toEqual({
      [app]: app,
      [worktree]: app,
      [path.join(worktree, "packages", "host")]: app,
      [path.join(app, "deleted")]: app,
    });
    expect(inferred.size).toBe(0);
  });

  test("gives a deleted worktree the one repository of the folder that held it", async () => {
    const app = path.join(root, "code", "app");
    const container = path.join(root, "tool", "worktrees", "app");
    await repositoryWithWorktree(app, path.join(container, "task-1"));
    const deleted = path.join(container, "task-2", "packages", "host");

    expect(resolveUsageRepositories([deleted], []).inferred.get(deleted)).toBe(app);
  });

  test("gives a deleted folder the known repository whose name its path carries", async () => {
    const app = path.join(root, "code", "app");
    const appTools = path.join(root, "code", "app-tools");
    await mkdir(path.join(app, ".git"), { recursive: true });
    await mkdir(path.join(appTools, ".git"), { recursive: true });
    const branch = path.join(root, "code", "app.feat-x");
    const codex = path.join(root, "codex", "worktrees", "1f", "app");
    const tools = path.join(root, "codex", "worktrees", "2b", "app-tools-old");

    const { inferred } = resolveUsageRepositories([app, appTools, branch, codex, tools], []);

    expect(inferred.get(branch)).toBe(app);
    expect(inferred.get(codex)).toBe(app);
    // The longest name wins, so `app-tools-old` belongs to `app-tools`, not `app`.
    expect(inferred.get(tools)).toBe(appTools);
  });

  test("reads a worktree whose admin folder git pruned, and an empty folder that a tool left", async () => {
    const app = path.join(root, "code", "app");
    await mkdir(path.join(app, ".git"), { recursive: true });
    const pruned = path.join(root, "tool", "pruned");
    await mkdir(pruned, { recursive: true });
    await writeFile(path.join(pruned, ".git"), `gitdir: ${app}/.git/worktrees/pruned\n`);
    const leftover = path.join(root, "orca", "workspaces", "app", "dependabot-x");
    await mkdir(leftover, { recursive: true });

    const { fromGit, inferred } = resolveUsageRepositories([app, pruned, leftover], []);

    expect(fromGit.get(pruned)).toBe(app);
    expect(inferred.get(leftover)).toBe(app);
  });

  test("keeps a folder outside git, an unknown name, and an ambiguous name apart", async () => {
    const plain = path.join(root, "notes");
    await mkdir(plain, { recursive: true });
    await mkdir(path.join(root, "one", "app", ".git"), { recursive: true });
    await mkdir(path.join(root, "two", "app", ".git"), { recursive: true });
    const ambiguous = path.join(root, "worktrees", "9c", "app");
    const unknown = path.join(root, "tmp", "scratch-1");

    const { fromGit, inferred } = resolveUsageRepositories(
      [plain, ambiguous, unknown, path.join(root, "one", "app"), path.join(root, "two", "app")],
      [],
    );

    expect(fromGit.has(plain)).toBe(false);
    expect(inferred.has(plain)).toBe(false);
    expect(inferred.has(ambiguous)).toBe(false);
    expect(inferred.has(unknown)).toBe(false);
  });

  // Windows cannot deny reads with a file mode, and root reads any folder.
  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "keeps a folder beside one that the host cannot read as its own project",
    async () => {
      const locked = path.join(root, "worktrees", "locked");
      await mkdir(locked, { recursive: true });
      await chmod(locked, 0o000);
      const deleted = path.join(root, "worktrees", "gone");
      try {
        const { fromGit, inferred } = resolveUsageRepositories([deleted], []);
        expect([fromGit.size, inferred.size]).toEqual([0, 0]);
      } finally {
        await chmod(locked, 0o700);
      }
    },
  );

  test("uses the repositories of workspaces as known names", async () => {
    const deleted = path.join(root, "worktrees", "shop-2f", "task");
    expect(resolveUsageRepositories([deleted], ["/code/shop"]).inferred.get(deleted)).toBe(
      "/code/shop",
    );
  });
});
