import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { gitFixtureEnv } from "../../test-support/git-repository-fixture";
import { createDefaultGitRunner, readGitCheckout } from "./git-command-runner";
import { listWorktrees } from "./git-worktree";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: gitFixtureEnv, stdio: ["ignore", "pipe", "pipe"] });

describe("checkout and worktree reads with real Git", () => {
  let root: string;
  let repository: string;
  let worktree: string;
  const runner = createDefaultGitRunner(() => gitFixtureEnv, { command: "git" });
  const read = (directory: string) => Effect.runPromise(readGitCheckout(runner, directory));

  // One repository and one linked worktree need several Git processes on Windows.
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-git-checkout-")));
    repository = path.join(root, "repository");
    worktree = path.join(root, "worktree");
    await mkdir(path.join(repository, "src"), { recursive: true });
    git(repository, "init", "-b", "main");
    git(
      repository,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    );
    git(repository, "worktree", "add", "-b", "feature", worktree);
    git(repository, "worktree", "add", "-b", "detached", path.join(root, "named-detached"));
    git(repository, "worktree", "add", "--detach", path.join(root, "headless"));
  }, 10_000);
  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("reads the checkout root and shared Git directory of each work tree directory", async () => {
    const common = path.join(repository, ".git");
    expect(await read(repository)).toEqual({ root: repository, commonDirectory: common });
    expect(await read(path.join(repository, "src"))).toEqual({
      root: repository,
      commonDirectory: common,
    });
    expect(await read(worktree)).toEqual({ root: worktree, commonDirectory: common });
  });

  test("returns null outside a work tree", async () => {
    expect(await read(root)).toBeNull();
    expect(await read(path.join(repository, ".git"))).toBeNull();
  });

  test("lists a detached HEAD with a null branch, apart from a branch named detached", async () => {
    // Git prints paths with forward slashes on Windows.
    const worktrees = (await Effect.runPromise(listWorktrees(runner, repository))).map((entry) => ({
      ...entry,
      worktreePath: path.normalize(entry.worktreePath),
    }));
    expect(worktrees).toHaveLength(4);
    expect(worktrees).toEqual(
      expect.arrayContaining([
        { worktreePath: repository, branch: "main" },
        { worktreePath: worktree, branch: "feature" },
        { worktreePath: path.join(root, "named-detached"), branch: "detached" },
        { worktreePath: path.join(root, "headless"), branch: null },
      ]),
    );
  });
});
