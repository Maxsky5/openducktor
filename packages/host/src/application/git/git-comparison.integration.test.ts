import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    expect(status.upstreamAheadBehind.outcome).toBe("error");
    expect(status.targetAheadBehind).toEqual({ ahead: 0, behind: 0 });
    // Git owns refspec mapping, including nonstandard tracking namespaces.
    git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/custom/*");
    git("config", "branch.feature.merge", "refs/heads/main");
    git("update-ref", "refs/remotes/custom/main", "refs/heads/main");
    expect(await comparison({ branch: "@{upstream}" })).toEqual({
      kind: "available",
      reference: "refs/remotes/custom/main",
    });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}, 5000);
