import type { GitService } from "../../application/git/git-service";
import { createHostCommandRouter } from "../router/host-command-router";
import { createGitCommandHandlers } from "./git-command-handlers";

const createRecordingGitService = () => {
  const calls: Array<{ method: keyof GitService; input: unknown }> = [];
  const service: GitService = {
    async getBranches(input) {
      calls.push({ method: "getBranches", input });
      return [{ name: "main", isCurrent: true, isRemote: false }];
    },
    async getCurrentBranch(input) {
      calls.push({ method: "getCurrentBranch", input });
      return { name: "main", detached: false, revision: "abc123" };
    },
    async getStatus(input) {
      calls.push({ method: "getStatus", input });
      return [{ path: "src/main.ts", status: "modified", staged: false }];
    },
    async getDiff(input) {
      calls.push({ method: "getDiff", input });
      return [
        {
          file: "src/main.ts",
          type: "modified",
          additions: 2,
          deletions: 1,
          diff: "@@ -1 +1 @@\n-old\n+new\n",
        },
      ];
    },
    async getWorktreeStatus(input) {
      calls.push({ method: "getWorktreeStatus", input });
      return {
        currentBranch: { name: "feature/electron", detached: false, revision: "abc123" },
        fileStatuses: [{ path: "src/main.ts", status: "modified", staged: false }],
        fileDiffs: [
          {
            file: "src/main.ts",
            type: "modified",
            additions: 2,
            deletions: 1,
            diff: "@@ -1 +1 @@\n-old\n+new\n",
          },
        ],
        targetAheadBehind: { ahead: 2, behind: 1 },
        upstreamAheadBehind: { outcome: "untracked", ahead: 2 },
        snapshot: {
          effectiveWorkingDir: "/repo",
          targetBranch: "origin/main",
          diffScope: "target",
          observedAtMs: 1,
          hashVersion: 1,
          statusHash: "0000000000000001",
          diffHash: "0000000000000002",
        },
      };
    },
    async getWorktreeStatusSummary(input) {
      calls.push({ method: "getWorktreeStatusSummary", input });
      return {
        currentBranch: { name: "feature/electron", detached: false, revision: "abc123" },
        fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
        targetAheadBehind: { ahead: 2, behind: 1 },
        upstreamAheadBehind: { outcome: "untracked", ahead: 2 },
        snapshot: {
          effectiveWorkingDir: "/repo",
          targetBranch: "origin/main",
          diffScope: "target",
          observedAtMs: 1,
          hashVersion: 1,
          statusHash: "0000000000000001",
          diffHash: "0000000000000002",
        },
      };
    },
    async switchBranch(input) {
      calls.push({ method: "switchBranch", input });
      return { name: "feature/electron", detached: false, revision: "def456" };
    },
    async createWorktree(input) {
      calls.push({ method: "createWorktree", input });
      return { branch: "feature/electron", worktreePath: "/worktrees/electron" };
    },
    async removeWorktree(input) {
      calls.push({ method: "removeWorktree", input });
      return { ok: true };
    },
    async resetWorktreeSelection(input) {
      calls.push({ method: "resetWorktreeSelection", input });
      return { affectedPaths: ["src/main.ts"] };
    },
    async commitsAheadBehind(input) {
      calls.push({ method: "commitsAheadBehind", input });
      return { ahead: 3, behind: 2 };
    },
    async fetchRemote(input) {
      calls.push({ method: "fetchRemote", input });
      return { outcome: "fetched", output: "Fetched origin" };
    },
    async pullBranch(input) {
      calls.push({ method: "pullBranch", input });
      return { outcome: "pulled", output: "Fast-forward" };
    },
    async commitAll(input) {
      calls.push({ method: "commitAll", input });
      return {
        outcome: "committed",
        commitHash: "abc123",
        output: "[feature abc123] Ship Electron host",
      };
    },
    async pushBranch(input) {
      calls.push({ method: "pushBranch", input });
      return {
        outcome: "pushed",
        remote: "origin",
        branch: "feature/electron",
        output: "Pushed",
      };
    },
    async rebaseBranch(input) {
      calls.push({ method: "rebaseBranch", input });
      return {
        outcome: "rebased",
        output: "Successfully rebased",
      };
    },
    async rebaseAbort(input) {
      calls.push({ method: "rebaseAbort", input });
      return {
        outcome: "aborted",
        output: "Successfully aborted rebase",
      };
    },
    async abortConflict(input) {
      calls.push({ method: "abortConflict", input });
      return {
        output: "Conflict operation aborted",
      };
    },
  };

  return { calls, service };
};

describe("createGitCommandHandlers", () => {
  test("routes read-only git commands to the git service", async () => {
    const { calls, service } = createRecordingGitService();
    const router = createHostCommandRouter({
      handlers: createGitCommandHandlers(service),
    });

    await expect(router.invoke("git_get_branches", { repoPath: "/repo" })).resolves.toEqual([
      { name: "main", isCurrent: true, isRemote: false },
    ]);
    await expect(router.invoke("git_get_current_branch", { repoPath: "/repo" })).resolves.toEqual({
      name: "main",
      detached: false,
      revision: "abc123",
    });
    await expect(router.invoke("git_get_status", { repoPath: "/repo" })).resolves.toEqual([
      { path: "src/main.ts", status: "modified", staged: false },
    ]);
    await expect(
      router.invoke("git_get_diff", { repoPath: "/repo", targetBranch: "origin/main" }),
    ).resolves.toEqual([
      {
        file: "src/main.ts",
        type: "modified",
        additions: 2,
        deletions: 1,
        diff: "@@ -1 +1 @@\n-old\n+new\n",
      },
    ]);
    await expect(
      router.invoke("git_get_worktree_status", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toMatchObject({
      currentBranch: { name: "feature/electron" },
      fileDiffs: [{ file: "src/main.ts" }],
    });
    await expect(
      router.invoke("git_get_worktree_status_summary", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toMatchObject({
      currentBranch: { name: "feature/electron" },
      fileStatusCounts: { total: 1, staged: 0, unstaged: 1 },
    });
    await expect(
      router.invoke("git_commits_ahead_behind", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toEqual({ ahead: 3, behind: 2 });
    await expect(
      router.invoke("git_switch_branch", {
        repoPath: "/repo",
        branch: "feature/electron",
        create: true,
      }),
    ).resolves.toEqual({ name: "feature/electron", detached: false, revision: "def456" });
    await expect(
      router.invoke("git_create_worktree", {
        repoPath: "/repo",
        worktreePath: "/worktrees/electron",
        branch: "feature/electron",
        createBranch: true,
      }),
    ).resolves.toEqual({ branch: "feature/electron", worktreePath: "/worktrees/electron" });
    await expect(
      router.invoke("git_remove_worktree", {
        repoPath: "/repo",
        worktreePath: "/worktrees/electron",
        force: true,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      router.invoke("git_reset_worktree_selection", {
        repoPath: "/repo",
        workingDir: "/worktree",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 1,
          statusHash: "0000000000000001",
          diffHash: "0000000000000002",
        },
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      }),
    ).resolves.toEqual({ affectedPaths: ["src/main.ts"] });
    await expect(
      router.invoke("git_fetch_remote", {
        repoPath: "/repo",
        targetBranch: "origin/main",
      }),
    ).resolves.toEqual({ outcome: "fetched", output: "Fetched origin" });
    await expect(
      router.invoke("git_pull_branch", {
        repoPath: "/repo",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({ outcome: "pulled", output: "Fast-forward" });
    await expect(
      router.invoke("git_commit_all", {
        repoPath: "/repo",
        workingDir: "/worktree",
        message: "Ship Electron host",
      }),
    ).resolves.toEqual({
      outcome: "committed",
      commitHash: "abc123",
      output: "[feature abc123] Ship Electron host",
    });
    await expect(
      router.invoke("git_push_branch", {
        repoPath: "/repo",
        workingDir: "/worktree",
        branch: "feature/electron",
        remote: "origin",
        setUpstream: true,
      }),
    ).resolves.toEqual({
      outcome: "pushed",
      remote: "origin",
      branch: "feature/electron",
      output: "Pushed",
    });
    await expect(
      router.invoke("git_rebase_branch", {
        repoPath: "/repo",
        workingDir: "/worktree",
        targetBranch: "origin/main",
      }),
    ).resolves.toEqual({
      outcome: "rebased",
      output: "Successfully rebased",
    });
    await expect(
      router.invoke("git_rebase_abort", {
        repoPath: "/repo",
        workingDir: "/worktree",
      }),
    ).resolves.toEqual({
      outcome: "aborted",
      output: "Successfully aborted rebase",
    });
    await expect(
      router.invoke("git_abort_conflict", {
        repoPath: "/repo",
        workingDir: "/worktree",
        operation: "direct_merge_squash",
      }),
    ).resolves.toEqual({
      output: "Conflict operation aborted",
    });

    expect(calls).toEqual([
      { method: "getBranches", input: { repoPath: "/repo" } },
      { method: "getCurrentBranch", input: { repoPath: "/repo" } },
      { method: "getStatus", input: { repoPath: "/repo" } },
      { method: "getDiff", input: { repoPath: "/repo", targetBranch: "origin/main" } },
      {
        method: "getWorktreeStatus",
        input: { repoPath: "/repo", targetBranch: "origin/main", diffScope: "target" },
      },
      {
        method: "getWorktreeStatusSummary",
        input: { repoPath: "/repo", targetBranch: "origin/main", diffScope: "target" },
      },
      {
        method: "commitsAheadBehind",
        input: { repoPath: "/repo", targetBranch: "origin/main" },
      },
      {
        method: "switchBranch",
        input: {
          repoPath: "/repo",
          branch: "feature/electron",
          create: true,
        },
      },
      {
        method: "createWorktree",
        input: {
          repoPath: "/repo",
          worktreePath: "/worktrees/electron",
          branch: "feature/electron",
          createBranch: true,
        },
      },
      {
        method: "removeWorktree",
        input: {
          repoPath: "/repo",
          worktreePath: "/worktrees/electron",
          force: true,
        },
      },
      {
        method: "resetWorktreeSelection",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          targetBranch: "origin/main",
          snapshot: {
            hashVersion: 1,
            statusHash: "0000000000000001",
            diffHash: "0000000000000002",
          },
          selection: {
            kind: "file",
            filePath: "src/main.ts",
          },
        },
      },
      {
        method: "fetchRemote",
        input: { repoPath: "/repo", targetBranch: "origin/main" },
      },
      {
        method: "pullBranch",
        input: { repoPath: "/repo", workingDir: "/worktree" },
      },
      {
        method: "commitAll",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          message: "Ship Electron host",
        },
      },
      {
        method: "pushBranch",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          branch: "feature/electron",
          remote: "origin",
          setUpstream: true,
        },
      },
      {
        method: "rebaseBranch",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          targetBranch: "origin/main",
        },
      },
      {
        method: "rebaseAbort",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
        },
      },
      {
        method: "abortConflict",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          operation: "direct_merge_squash",
        },
      },
    ]);
  });

  test("rejects malformed git command inputs before calling the service", async () => {
    const { calls, service } = createRecordingGitService();
    const router = createHostCommandRouter({
      handlers: createGitCommandHandlers(service),
    });

    await expect(
      router.invoke("git_get_worktree_status", {
        repoPath: "/repo",
        targetBranch: "origin/main",
        diffScope: "all",
      }),
    ).rejects.toThrow("diffScope must be either 'target' or 'uncommitted', got: all");
    await expect(
      router.invoke("git_commits_ahead_behind", {
        repoPath: "/repo",
        targetBranch: " ",
      }),
    ).rejects.toThrow("targetBranch is required.");
    await expect(router.invoke("git_get_branches")).rejects.toThrow(
      "Git command input must be an object.",
    );
    expect(calls).toEqual([]);
  });
});
