import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { gitFixtureEnv, initGitRepository } from "../../test-support/git-repository-fixture";
import { readBranchRefs } from "./git-branch-refs";
import { createDefaultGitRunner } from "./git-command-runner";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, env: gitFixtureEnv, stdio: ["ignore", "pipe", "pipe"] });

describe("branch refs with real Git", () => {
  let root: string;
  let index = 0;
  const runner = createDefaultGitRunner(() => gitFixtureEnv, { command: "git" });
  const read = (repoPath: string) => Effect.runPromise(readBranchRefs(runner, repoPath));
  const repository = async (initialBranch: string, commit = true) => {
    index += 1;
    const repoPath = path.join(root, `repository-${index}`);
    await mkdir(repoPath);
    if (commit) initGitRepository(repoPath, initialBranch);
    else git(repoPath, "init", "-q", "-b", initialBranch);
    return repoPath;
  };

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "odt-git-branch-refs-")));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("reads the remotes, the branches, and the branch of each remote HEAD", async () => {
    const upstream = await repository("develop");
    const clone = path.join(root, "clone");
    git(root, "clone", "--quiet", upstream, clone);
    git(clone, "checkout", "--quiet", "-b", "feature");
    git(clone, "remote", "add", "fork", upstream);

    // Git prints worktree paths with forward slashes on Windows.
    const refs = await read(clone);
    const branches = refs.branches.map((branch) =>
      branch.worktreePath
        ? { ...branch, worktreePath: path.normalize(branch.worktreePath) }
        : branch,
    );
    expect({ ...refs, branches }).toEqual({
      remotes: ["fork", "origin"],
      branches: [
        { name: "feature", isCurrent: true, isRemote: false, worktreePath: clone },
        { name: "develop", isCurrent: false, isRemote: false },
        { name: "origin/develop", isCurrent: false, isRemote: true },
      ],
      remoteHeads: { origin: "develop" },
      head: { kind: "branch", name: "feature" },
    });
  });

  test("leaves out a remote HEAD that names no branch", async () => {
    const repoPath = await repository("trunk");
    git(repoPath, "remote", "add", "origin", "https://example.invalid/repo.git");
    git(repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/gone");

    expect((await read(repoPath)).remoteHeads).toEqual({});
  });

  test("tells a branch without commits from a detached HEAD", async () => {
    expect((await read(await repository("main", false))).head).toEqual({
      kind: "unborn",
      name: "main",
    });
    const detached = await repository("trunk");
    git(detached, "checkout", "--quiet", "--detach");
    expect((await read(detached)).head).toEqual({ kind: "detached" });
  });
});
