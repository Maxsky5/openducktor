import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { gitFixtureCommand, gitFixtureEnv } from "../../test-support/git-repository-fixture";
import { createGitService } from "./git-service";

const gitAt = (cwd: string, ...args: string[]): string =>
  execFileSync(
    gitFixtureCommand,
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8", env: gitFixtureEnv, stdio: ["ignore", "pipe", "pipe"] },
  ).trim();

const createFixtureGit = () =>
  createGitCliAdapter({
    resolveCommand: () => Effect.succeed(gitFixtureCommand),
    readEnv: () => gitFixtureEnv,
  });

// This test starts real Git processes to check ref resolution and status together.
test("keeps exact comparison refs and actual upstream counts independent", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "git-comparison-"));
  const git = (...args: string[]) => gitAt(repo, ...args);
  const service = createGitService(createFixtureGit());
  const comparison = (target: { branch: string; remote?: string }) =>
    Effect.runPromise(service.getComparisonTarget({ repoPath: repo, workingDir: repo, target }));
  try {
    git("init", "--initial-branch=main", "--template=");
    await writeFile(path.join(repo, "base.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("branch", "origin/main");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-b", "feature");
    await writeFile(path.join(repo, "feature.txt"), "feature\n");
    git("add", ".");
    git("commit", "-m", "feature");
    expect(await comparison({ branch: "origin/main" })).toEqual({
      kind: "available",
      reference: "refs/heads/origin/main",
    });
    expect(await comparison({ branch: "main", remote: "origin" })).toEqual({
      kind: "available",
      reference: "refs/remotes/origin/main",
    });
    expect((await comparison({ branch: "@{upstream}" })).kind).toBe("unavailable");
    const untracked = await Effect.runPromise(
      service.getWorktreeStatus({
        repoPath: repo,
        targetBranch: "refs/heads/origin/main",
        diffScope: "target",
      }),
    );
    expect(untracked.targetAheadBehind).toEqual({ ahead: 1, behind: 0 });
    // The feature commit is on no remote, so the first push sends it.
    expect(untracked.upstreamAheadBehind).toEqual({ outcome: "untracked", ahead: 1 });
    git("config", "branch.feature.remote", ".");
    git("config", "branch.feature.merge", "refs/heads/main");
    expect(await comparison({ branch: "@{upstream}" })).toEqual({
      kind: "available",
      reference: "refs/heads/main",
    });
    git("remote", "add", "origin", repo);
    git("config", "branch.feature.remote", "origin");
    git("config", "branch.feature.merge", "refs/heads/missing");
    const unavailable = await comparison({ branch: "@{upstream}" });
    expect(unavailable).toMatchObject({ kind: "unavailable" });
    if (unavailable.kind === "unavailable")
      expect(unavailable.reason).toContain("refs/remotes/origin/missing");
    // Git owns refspec mapping, including nonstandard tracking namespaces.
    git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/custom/*");
    git("config", "branch.feature.merge", "refs/heads/main");
    git("update-ref", "refs/remotes/custom/main", "refs/heads/main");
    expect(await comparison({ branch: "@{upstream}" })).toEqual({
      kind: "available",
      reference: "refs/remotes/custom/main",
    });
    const tracking = await Effect.runPromise(
      service.getWorktreeStatus({ repoPath: repo, targetBranch: "HEAD", diffScope: "uncommitted" }),
    );
    expect(tracking.upstreamAheadBehind).toEqual({ outcome: "tracking", ahead: 1, behind: 0 });
    expect(tracking.targetAheadBehind).toEqual({ ahead: 0, behind: 0 });
    git("config", "branch.feature.remote", ".");
    git("config", "branch.feature.merge", "refs/heads/missing");
    const invalidLocalUpstream = await Effect.runPromise(
      service.getWorktreeStatus({ repoPath: repo, targetBranch: "HEAD", diffScope: "uncommitted" }),
    );
    expect(invalidLocalUpstream.upstreamAheadBehind.outcome).toBe("error");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 30_000);

// Worktree setup and fetch start real Git processes, including a local bare remote.
test("keeps an unpublished task worktree usable after fetch prunes its tracking ref", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-task-start-"));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const worktree = path.join(root, "task");
  const git = (...args: string[]) => gitAt(repo, ...args);
  const adapter = createFixtureGit();
  const service = createGitService(adapter);
  try {
    await mkdir(repo);
    git("init", "--initial-branch=main", "--template=");
    await writeFile(path.join(repo, "base.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("clone", "--bare", "--template=", repo, remote);
    git("remote", "add", "-f", "origin", remote);
    await Effect.runPromise(
      adapter.createWorktree(repo, worktree, "odt/new-task", true, "origin/main"),
    );
    await Effect.runPromise(
      adapter.configureBranchUpstream(repo, worktree, "odt/new-task", "origin", false),
    );
    const trackingRef = "refs/remotes/origin/odt/new-task";
    expect(git("for-each-ref", "--format=%(refname)", trackingRef)).toBe(trackingRef);
    await Effect.runPromise(adapter.fetchRemote(worktree, "origin"));
    expect(git("for-each-ref", "--format=%(refname)", trackingRef)).toBe("");
    await writeFile(path.join(worktree, "base.txt"), "changed\n");
    const input = {
      repoPath: repo,
      workingDir: worktree,
      targetBranch: "refs/remotes/origin/main",
      diffScope: "uncommitted" as const,
    };
    const localChangesInput = { repoPath: repo, workingDir: worktree };
    const status = await Effect.runPromise(service.getWorktreeStatus(input));
    expect(status.currentBranch.name).toBe("odt/new-task");
    expect(status.fileDiffs[0]?.file).toBe("base.txt");
    expect(status.upstreamAheadBehind).toEqual({ outcome: "untracked", ahead: 0 });
    // A commit of the unpublished branch is on no remote, so the Push count shows it.
    gitAt(worktree, "commit", "-am", "task change");
    expect(
      (await Effect.runPromise(service.getLocalChanges(localChangesInput))).upstreamAheadBehind,
    ).toEqual({ outcome: "untracked", ahead: 1 });
    expect(
      await Effect.runPromise(
        service.getComparisonTarget({
          repoPath: repo,
          workingDir: worktree,
          target: { remote: "origin", branch: "main" },
        }),
      ),
    ).toEqual({ kind: "available", reference: "refs/remotes/origin/main" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

// The apply backend stores different rebase files from the merge backend in the History test.
test("reads the destination and conflicted file of an apply rebase in Local Changes", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "git-rebase-target-"));
  const git = (...args: string[]) => gitAt(repo, ...args);
  const service = createGitService(createFixtureGit());
  try {
    git("init", "--initial-branch=main", "--template=");
    await writeFile(path.join(repo, "conflict.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("branch", "feature");
    await writeFile(path.join(repo, "conflict.txt"), "main\n");
    git("commit", "-am", "main");
    const onto = git("rev-parse", "HEAD");
    git("checkout", "feature");
    await writeFile(path.join(repo, "conflict.txt"), "feature\n");
    git("commit", "-am", "feature");
    expect(() => git("rebase", "--apply", "main")).toThrow();
    const changes = await Effect.runPromise(service.getLocalChanges({ repoPath: repo }));
    expect(changes.gitConflict).toMatchObject({
      currentBranch: "feature",
      targetBranch: onto,
      conflictedFiles: ["conflict.txt"],
    });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 30_000);
