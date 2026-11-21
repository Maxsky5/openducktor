import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { gitFixtureEnv, initGitRepository } from "../../test-support/git-repository-fixture";
import { createDefaultGitRunner } from "./git-command-runner";
import { renameCheckedOutBranch } from "./git-branch-rename";
import { createWorktree } from "./git-worktree";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: gitFixtureEnv, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();

let root: string;

const runner = createDefaultGitRunner(() => gitFixtureEnv, { command: "git" });

beforeAll(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-git-rename-")));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("renames a temporary branch and keeps its commit", async () => {
  const repo = path.join(root, "clone");
  await mkdir(repo);
  initGitRepository(repo, "main");
  const worktree = path.join(root, "worktree");
  await Effect.runPromise(createWorktree(runner, repo, worktree, "odt/1a2b3c4d", true, "main"));
  const commit = git(worktree, "rev-parse", "HEAD");

  await Effect.runPromise(
    renameCheckedOutBranch(runner, worktree, "odt/1a2b3c4d", "fix/login-redirect"),
  );

  expect(git(worktree, "branch", "--show-current")).toBe("fix/login-redirect");
  expect(git(worktree, "rev-parse", "HEAD")).toBe(commit);
  expect(git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/odt")).toBe("");
});

test("keeps an existing branch and fails when the worktree has another branch", async () => {
  const repo = path.join(root, "local");
  await mkdir(repo);
  initGitRepository(repo, "main");
  git(repo, "branch", "taken");
  const worktree = path.join(root, "local-worktree");
  await Effect.runPromise(createWorktree(runner, repo, worktree, "odt/temp", true, "main"));

  await expect(
    Effect.runPromise(renameCheckedOutBranch(runner, worktree, "odt/temp", "taken")),
  ).rejects.toThrow();
  await expect(
    Effect.runPromise(renameCheckedOutBranch(runner, worktree, "odt/other", "next")),
  ).rejects.toThrow("no longer has branch odt/other checked out");
  expect(git(worktree, "branch", "--show-current")).toBe("odt/temp");
});

test("refuses to rename a temporary branch whose ref is gone", async () => {
  const repo = path.join(root, "unborn");
  await mkdir(repo);
  initGitRepository(repo, "main");
  const worktree = path.join(root, "unborn-worktree");
  await Effect.runPromise(createWorktree(runner, repo, worktree, "odt/aa11bb22", true, "main"));
  git(repo, "update-ref", "-d", "refs/heads/odt/aa11bb22");

  await expect(
    Effect.runPromise(renameCheckedOutBranch(runner, worktree, "odt/aa11bb22", "fix/x")),
  ).rejects.toThrow("no longer has branch odt/aa11bb22 checked out");
  expect(git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/fix")).toBe("");
});
