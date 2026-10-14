import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createDefaultGitRunner } from "./git-command-runner";
import { isMergeIncluded, mergeBranch } from "./git-merge";
import { deleteLocalBranch, restoreDeletedBranch } from "./git-worktree";

const runner = createDefaultGitRunner(
  () => ({ ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }),
  { command: "git" },
);
const git = (repo: string, ...args: string[]) => Effect.runPromise(runner(repo, args));

test.each(["merge_commit", "squash", "rebase"] as const)(
  "verifies %s recovery and cleanup with a stale source upstream",
  async (method) => {
    const repo = await mkdtemp(path.join(os.tmpdir(), "odt-merge-recovery-"));
    try {
      await git(repo, "init", "--initial-branch=main");
      await git(repo, "config", "user.name", "Recovery test");
      await git(repo, "config", "user.email", "recovery@example.invalid");
      await writeFile(path.join(repo, "base"), "base");
      await git(repo, "add", ".");
      await git(repo, "commit", "-m", "Base");
      const before = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
      await git(repo, "switch", "-c", "task");
      await git(repo, "remote", "add", "origin", repo);
      await git(repo, "update-ref", "refs/remotes/origin/task", before);
      await git(repo, "branch", "--set-upstream-to=origin/task", "task");
      await writeFile(path.join(repo, "change"), "task change");
      await git(repo, "add", ".");
      await git(repo, "commit", "-m", "Task");
      const sourceOid = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
      await git(repo, "switch", "main");
      await expect(
        Effect.runPromise(deleteLocalBranch(runner, repo, "task", false, () => {})),
      ).rejects.toThrow("not fully merged");
      await expect(
        Effect.runPromise(deleteLocalBranch(runner, repo, "main", true, () => {})),
      ).rejects.toThrow("while a worktree uses it");
      expect(
        await Effect.runPromise(isMergeIncluded(runner, repo, "task", before, sourceOid)),
      ).toBe(false);
      let issued = 0;
      let appliedTarget: string | undefined;
      const request = {
        sourceBranch: "task",
        targetBranch: "main",
        method,
        squashCommitMessage: "Squash task",
        onWorkIssued: () => {
          issued += 1;
        },
        onApplied: (oid: string) => {
          appliedTarget = oid;
        },
      };
      await writeFile(path.join(repo, "dirty"), "unsaved");
      expect(
        (await Effect.runPromise(Effect.result(mergeBranch(runner, repo, request))))._tag,
      ).toBe("Failure");
      expect(issued).toBe(0);
      await rm(path.join(repo, "dirty"));
      expect((await Effect.runPromise(mergeBranch(runner, repo, request))).outcome).toBe("merged");
      expect(issued).toBeGreaterThan(0);
      const after = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
      expect(appliedTarget).toBe(after);
      expect(await Effect.runPromise(isMergeIncluded(runner, repo, "task", after, after))).toBe(
        true,
      );
      await git(repo, "rm", "change");
      await git(repo, "commit", "-m", "Revert task content");
      const reverted = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
      expect(await Effect.runPromise(isMergeIncluded(runner, repo, "task", reverted, after))).toBe(
        false,
      );
      for (const recreate of [false, true]) {
        if (recreate) await git(repo, "update-ref", "-d", "refs/heads/task");
        await git(repo, "update-ref", "refs/heads/task", reverted);
        expect((await git(repo, "rev-parse", "task^{tree}")).stdout).toBe(
          (await git(repo, "rev-parse", "HEAD^{tree}")).stdout,
        );
        await expect(
          Effect.runPromise(isMergeIncluded(runner, repo, "task", reverted)),
        ).rejects.toThrow("Original applied merge commit evidence is unavailable");
      }
      await git(repo, "update-ref", "refs/heads/task", sourceOid);
      await writeFile(path.join(repo, "change"), "task change");
      await git(repo, "add", ".");
      await git(repo, "commit", "-m", "Restore task content");
      const restored = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
      expect(await Effect.runPromise(isMergeIncluded(runner, repo, "task", restored, after))).toBe(
        true,
      );
      await writeFile(path.join(repo, "unrelated"), "Later target content");
      await git(repo, "add", ".");
      await git(repo, "commit", "-m", "Later target work");
      const advanced = (await git(repo, "rev-parse", "HEAD")).stdout.trim();
      expect(await Effect.runPromise(isMergeIncluded(runner, repo, "task", advanced, after))).toBe(
        false,
      );
      expect((await git(repo, "status", "--porcelain")).stdout).toBe("");
      expect((await git(repo, "rev-parse", "HEAD")).stdout.trim()).toBe(advanced);
      let deleted: { name: string; oid: string } | undefined;
      await Effect.runPromise(
        deleteLocalBranch(runner, repo, "task", method !== "merge_commit", (branch) => {
          deleted = branch;
        }),
      );
      if (!deleted) throw new Error("Missing source branch receipt");
      await Effect.runPromise(restoreDeletedBranch(runner, repo, deleted));
      expect(await Effect.runPromise(isMergeIncluded(runner, repo, "task", after, after))).toBe(
        true,
      );
      await git(repo, "update-ref", "refs/heads/task", before);
      await expect(Effect.runPromise(restoreDeletedBranch(runner, repo, deleted))).rejects.toThrow(
        "changed during cleanup",
      );
      expect((await git(repo, "rev-parse", "refs/heads/task")).stdout.trim()).toBe(before);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  },
  10000,
);
