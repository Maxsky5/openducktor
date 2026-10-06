import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
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
