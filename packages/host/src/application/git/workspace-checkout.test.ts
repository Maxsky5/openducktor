import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import {
  addGitWorktree,
  gitFixtureEnv,
  initGitRepository,
} from "../../test-support/git-repository-fixture";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { resolveGitWorkingDirectory } from "./git-service-inputs";
import { classifyWorkspaceCheckout } from "./workspace-checkout";

const git = createGitCliAdapter({
  readEnv: () => gitFixtureEnv,
  resolveCommand: () => Effect.succeed("git"),
});

// Real Git repositories and worktrees spawn many processes on Windows.
test("classifies the repository root and registered worktrees anywhere on disk", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-workspace-checkout-"));
  try {
    const root = await realpath(temporaryDirectory);
    const repoPath = join(root, "repo");
    const externalWorktree = join(root, "elsewhere", "feature");
    const replacedWorktree = join(root, "elsewhere", "replaced");
    const worktreeSubdirectory = join(externalWorktree, "src");
    const plainDirectory = join(root, "plain");
    await Promise.all([mkdir(repoPath), mkdir(join(root, "elsewhere")), mkdir(plainDirectory)]);
    initGitRepository(repoPath);
    // Git stores the resolved path even when the worktree is added through a symlink.
    await symlink(join(root, "elsewhere"), join(root, "elsewhere-alias"), "junction");
    addGitWorktree(repoPath, join(root, "elsewhere-alias", "feature"), "feature");
    await mkdir(worktreeSubdirectory);
    addGitWorktree(repoPath, replacedWorktree, "replaced");
    await removeTestDirectory(replacedWorktree);
    await mkdir(replacedWorktree);
    initGitRepository(replacedWorktree);

    const classify = (directory: string) =>
      Effect.runPromise(
        classifyWorkspaceCheckout(git, {
          canonicalRepoPath: repoPath,
          canonicalDirectory: directory,
        }),
      );

    expect(await classify(repoPath)).toBe("local_repo_root");
    expect(await classify(externalWorktree)).toBe("local_worktree");
    expect(await classify(worktreeSubdirectory)).toBe("outside_workspace");
    expect(await classify(replacedWorktree)).toBe("outside_workspace");
    expect(await classify(plainDirectory)).toBe("not_git_directory");
  } finally {
    await removeTestDirectory(temporaryDirectory);
  }
}, 15_000);

// Windows has no POSIX folder permissions.
test.skipIf(process.platform === "win32")(
  "a worktree under a folder without read access does not break the check of another worktree",
  async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-workspace-checkout-locked-"));
    const locked = join(temporaryDirectory, "locked");
    try {
      const root = await realpath(temporaryDirectory);
      const repoPath = join(root, "repo");
      const worktree = join(root, "feature");
      await Promise.all([mkdir(repoPath), mkdir(locked)]);
      initGitRepository(repoPath);
      addGitWorktree(repoPath, worktree, "feature");
      addGitWorktree(repoPath, join(locked, "other"), "other");
      await chmod(locked, 0o000);

      expect(
        await Effect.runPromise(
          classifyWorkspaceCheckout(git, {
            canonicalRepoPath: repoPath,
            canonicalDirectory: worktree,
          }),
        ),
      ).toBe("local_worktree");
      // An unlisted path matches no entry, so the check passes every entry without reading it.
      expect(
        await Effect.runPromise(git.isRegisteredWorktree(repoPath, join(root, "unlisted"))),
      ).toBe(false);
    } finally {
      await chmod(locked, 0o755);
      await removeTestDirectory(temporaryDirectory);
    }
  },
  15_000,
);

// Only a file system that ignores letter case can reach one directory through two cases.
test.skipIf(!existsSync(tmpdir().toUpperCase()))(
  "accepts a worktree that Git lists with other letter case than the directory on disk",
  async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-workspace-checkout-case-"));
    try {
      const root = await realpath(temporaryDirectory);
      const repoPath = join(root, "repo");
      await Promise.all([mkdir(repoPath), mkdir(join(root, "Base"))]);
      initGitRepository(repoPath);
      // Git keeps the typed case, and the real path has the case on disk.
      addGitWorktree(repoPath, join(root, "BASE", "feature"), "feature");
      const worktree = await realpath(join(root, "BASE", "feature"));
      expect(worktree).toBe(join(root, "Base", "feature"));

      expect(
        await Effect.runPromise(
          classifyWorkspaceCheckout(git, {
            canonicalRepoPath: repoPath,
            canonicalDirectory: worktree,
          }),
        ),
      ).toBe("local_worktree");
      expect(await Effect.runPromise(resolveGitWorkingDirectory(git, repoPath, worktree))).toBe(
        worktree,
      );
    } finally {
      await removeTestDirectory(temporaryDirectory);
    }
  },
  15_000,
);

test("the Git requests of one refresh share their checkout reads", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "odt-workspace-checkout-shared-"));
  try {
    const root = await realpath(temporaryDirectory);
    const repoPath = join(root, "repo");
    const worktree = join(root, "worktree");
    await Promise.all([mkdir(join(repoPath, ".git"), { recursive: true }), mkdir(worktree)]);
    const commands: string[] = [];
    const counted = createGitCliAdapter({
      runner: (directory, args) =>
        Effect.sync(() => {
          commands.push(`${args[0]} ${directory}`);
          if (args[0] === "rev-parse")
            return { ok: true, stdout: `true\n${directory}\n${repoPath}/.git\n`, stderr: "" };
          return {
            ok: true,
            stdout: `worktree ${repoPath}\0branch refs/heads/main\0\0worktree ${worktree}\0branch refs/heads/feature\0\0`,
            stderr: "",
          };
        }),
    });
    const check = (refreshId: string) =>
      Effect.runPromise(resolveGitWorkingDirectory(counted, repoPath, worktree, { refreshId }));
    const sharedCheck = [`rev-parse ${repoPath}`, `rev-parse ${worktree}`, `worktree ${repoPath}`];

    await check("refresh");
    await check("refresh");
    expect(commands).toEqual(sharedCheck);

    // A new refresh checks the directory again.
    await check("next");
    expect(commands).toEqual([...sharedCheck, ...sharedCheck]);
  } finally {
    await removeTestDirectory(temporaryDirectory);
  }
});
