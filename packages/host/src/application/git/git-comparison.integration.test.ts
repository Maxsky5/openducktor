import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createGitCliAdapter } from "../../adapters/git/git-cli-adapter";
import { createGitService } from "./git-service";

// This test starts real Git processes to check ref resolution and status together.
test("keeps exact comparison refs and actual upstream counts independent", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "git-comparison-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const adapter = createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") });
  const service = createGitService(adapter);
  const comparison = (target: { branch: string; remote?: string }) =>
    Effect.runPromise(service.getComparisonTarget({ repoPath: repo, workingDir: repo, target }));
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "Comparison Test");
    git("config", "user.email", "comparison@example.invalid");
    git("config", "commit.gpgsign", "false");
    await writeFile(path.join(repo, "base.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("branch", "origin/main");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("update-ref", "refs/remotes/origin/feature", "HEAD");
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
    let status = await Effect.runPromise(
      service.getWorktreeStatus({
        repoPath: repo,
        targetBranch: "refs/heads/origin/main",
        diffScope: "target",
      }),
    );
    expect(status.targetAheadBehind).toEqual({ ahead: 1, behind: 0 });
    expect(status.upstreamAheadBehind).toEqual({ outcome: "untracked", ahead: 0 });
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
    status = await Effect.runPromise(
      service.getWorktreeStatus({ repoPath: repo, targetBranch: "HEAD", diffScope: "uncommitted" }),
    );
    expect(status.upstreamAheadBehind).toEqual({ outcome: "untracked", ahead: 0 });
    expect(status.targetAheadBehind).toEqual({ ahead: 0, behind: 0 });
    // Git owns refspec mapping, including nonstandard tracking namespaces.
    git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/custom/*");
    git("config", "branch.feature.merge", "refs/heads/main");
    git("update-ref", "refs/remotes/custom/main", "refs/heads/main");
    expect(await comparison({ branch: "@{upstream}" })).toEqual({
      kind: "available",
      reference: "refs/remotes/custom/main",
    });
    status = await Effect.runPromise(
      service.getWorktreeStatus({ repoPath: repo, targetBranch: "HEAD", diffScope: "uncommitted" }),
    );
    expect(status.upstreamAheadBehind).toEqual({ outcome: "tracking", ahead: 1, behind: 0 });
    git("config", "branch.feature.remote", ".");
    git("config", "branch.feature.merge", "refs/heads/missing");
    status = await Effect.runPromise(
      service.getWorktreeStatus({ repoPath: repo, targetBranch: "HEAD", diffScope: "uncommitted" }),
    );
    expect(status.upstreamAheadBehind.outcome).toBe("error");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 5000);

// Worktree setup and fetch start real Git processes, including a local bare remote.
test("keeps an unpublished task worktree usable after fetch prunes its tracking ref", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "git-task-start-"));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  const worktree = path.join(root, "task");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const adapter = createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") });
  const service = createGitService(adapter);
  try {
    await mkdir(repo);
    git("init", "--initial-branch=main");
    git("config", "user.name", "Task Startup Test");
    git("config", "user.email", "startup@example.invalid");
    git("config", "commit.gpgsign", "false");
    await writeFile(path.join(repo, "base.txt"), "base\n");
    git("add", ".");
    git("commit", "-m", "base");
    git("init", "--bare", remote);
    git("remote", "add", "origin", remote);
    git("push", "-u", "origin", "main");
    await Effect.runPromise(
      adapter.createWorktree(repo, worktree, "odt/new-task", true, "origin/main"),
    );
    await Effect.runPromise(
      adapter.configureBranchUpstream(repo, worktree, "odt/new-task", "origin"),
    );
    await Effect.runPromise(adapter.fetchRemote(worktree, "origin/main"));
    await writeFile(path.join(worktree, "base.txt"), "changed\n");
    const input = {
      repoPath: repo,
      workingDir: worktree,
      targetBranch: "refs/remotes/origin/main",
      diffScope: "uncommitted" as const,
    };
    const status = await Effect.runPromise(service.getWorktreeStatus(input));
    const summary = await Effect.runPromise(service.getWorktreeStatusSummary(input));
    expect(status.currentBranch.name).toBe("odt/new-task");
    expect(status.fileDiffs[0]?.file).toBe("base.txt");
    expect(status.upstreamAheadBehind).toEqual({ outcome: "untracked", ahead: 0 });
    expect(summary.upstreamAheadBehind).toEqual(status.upstreamAheadBehind);
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
}, 5000);

// Both Git backends start real processes and stop on a conflicting commit.
test.each(["--merge", "--apply"] as const)(
  "restores the rebase destination independently of HEAD diffs with %s",
  async (backend) => {
    const repo = await mkdtemp(path.join(tmpdir(), "git-rebase-target-"));
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const adapter = createGitCliAdapter({ resolveCommand: () => Effect.succeed("git") });
    const service = createGitService(adapter);
    try {
      git("init", "--initial-branch=main");
      git("config", "user.name", "Rebase Test");
      git("config", "user.email", "rebase@example.invalid");
      git("config", "commit.gpgsign", "false");
      await writeFile(path.join(repo, "conflict.txt"), "base\n");
      git("add", ".");
      git("commit", "-m", "base");
      git("checkout", "-b", "feature");
      await writeFile(path.join(repo, "conflict.txt"), "feature\n");
      git("add", ".");
      git("commit", "-m", "feature");
      git("checkout", "main");
      await writeFile(path.join(repo, "conflict.txt"), "main\n");
      git("add", ".");
      git("commit", "-m", "main");
      const onto = git("rev-parse", "HEAD");
      git("checkout", "feature");
      let stopped = false;
      try {
        git("rebase", backend, "main");
      } catch {
        stopped = true;
      }
      expect(stopped).toBe(true);
      const input = { repoPath: repo, targetBranch: "HEAD", diffScope: "uncommitted" as const };
      const full = await Effect.runPromise(service.getWorktreeStatus(input));
      const summary = await Effect.runPromise(service.getWorktreeStatusSummary(input));
      for (const result of [full, summary]) {
        expect(result.gitConflict?.currentBranch).toBe("feature");
        expect(result.gitConflict?.targetBranch).toBe(onto);
        expect(result.gitConflict?.conflictedFiles).toContain("conflict.txt");
      }
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  },
  5000,
);
