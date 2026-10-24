import type { GitFileDiff } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitService } from "../../application/git/git-service";
import { HostOperationError } from "../../effect/host-errors";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createGitCommandHandlers } from "./git-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

const SNAPSHOT = { hashVersion: 2, statusHash: "0000000000000001", diffHash: "0000000000000002" };
const BRANCH = { name: "feature", detached: false, revision: "a".repeat(40) };

const localChangesFixture = () => ({
  currentBranch: BRANCH,
  fileStatuses: [],
  unstaged: { fileStatuses: [], fileDiffs: [], snapshot: SNAPSHOT },
  staged: { fileStatuses: [], fileDiffs: [], snapshot: SNAPSHOT },
  conflicted: { fileStatuses: [], fileDiffs: [] },
  upstreamAheadBehind: { outcome: "untracked" as const, ahead: 0 },
  snapshot: {
    effectiveWorkingDir: "/worktree",
    targetBranch: "HEAD",
    diffScope: "uncommitted" as const,
    observedAtMs: 1,
    ...SNAPSHOT,
    hashVersion: 1,
  },
});

const createRecordingGitService = () => {
  const calls: Array<{
    method: keyof GitService;
    input: unknown;
  }> = [];
  const promiseService: GitService = {
    canonicalizePath(input) {
      calls.push({ method: "canonicalizePath", input });
      return Effect.succeed(input.workingDir ?? input.repoPath);
    },
    getBranches(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "getBranches", input });
          return [{ name: "main", isCurrent: true, isRemote: false }];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getCurrentBranch(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "getCurrentBranch", input });
          return { name: "main", detached: false, revision: "abc123" };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getComparisonTarget(input) {
      calls.push({ method: "getComparisonTarget", input });
      return Effect.succeed({ kind: "available", reference: "origin/main" });
    },
    getStatus(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "getStatus", input });
          return [{ path: "src/main.ts", status: "modified", staged: false }];
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getDiff(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "getDiff", input });
          const diffs: GitFileDiff[] = [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 2,
              deletions: 1,
              diff: "@@ -1 +1 @@\n-old\n+new\n",
            },
          ];
          return diffs;
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    getWorktreeStatus(input) {
      return Effect.sync(() => {
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
      });
    },
    switchBranch(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "switchBranch", input });
          return { name: "feature/electron", detached: false, revision: "def456" };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    createWorktree(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "createWorktree", input });
          return { branch: "feature/electron", worktreePath: "/worktrees/electron" };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    removeWorktree(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "removeWorktree", input });
          return { ok: true };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    commitsAheadBehind(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "commitsAheadBehind", input });
          return { ahead: 3, behind: 2 };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
    fetchRemote(input) {
      return Effect.sync(() => {
        calls.push({ method: "fetchRemote", input });
        return { outcome: "fetched", output: "Fetched origin" };
      });
    },
    pullBranch(input) {
      return Effect.sync(() => {
        calls.push({ method: "pullBranch", input });
        return { outcome: "pulled", output: "Fast-forward" };
      });
    },
    getLocalChanges(input) {
      return Effect.sync(() => {
        calls.push({ method: "getLocalChanges", input });
        return localChangesFixture();
      });
    },
    changeSelection(input) {
      return Effect.sync(() => {
        calls.push({ method: "changeSelection", input });
        return { affectedPaths: ["src/main.ts"], localChanges: localChangesFixture() };
      });
    },
    commitStaged(input) {
      return Effect.sync(() => {
        calls.push({ method: "commitStaged", input });
        return { outcome: "no_changes", output: "No staged changes to commit" };
      });
    },
    getHistoryPage(input) {
      return Effect.sync(() => {
        calls.push({ method: "getHistoryPage", input });
        return { outcome: "no_commits" };
      });
    },
    commitAll(input) {
      return Effect.sync(() => {
        calls.push({ method: "commitAll", input });
        return {
          outcome: "committed",
          commitHash: "abc123",
          output: "[feature abc123] Ship Electron host",
        };
      });
    },
    pushBranch(input) {
      return Effect.sync(() => {
        calls.push({ method: "pushBranch", input });
        return {
          outcome: "pushed",
          remote: "origin",
          branch: "feature/electron",
          output: "Pushed",
        };
      });
    },
    rebaseBranch(input) {
      return Effect.sync(() => {
        calls.push({ method: "rebaseBranch", input });
        return {
          outcome: "rebased",
          output: "Successfully rebased",
        };
      });
    },
    rebaseAbort(input) {
      return Effect.sync(() => {
        calls.push({ method: "rebaseAbort", input });
        return {
          outcome: "aborted",
          output: "Successfully aborted rebase",
        };
      });
    },
    abortConflict(input) {
      return Effect.tryPromise({
        try: async () => {
          calls.push({ method: "abortConflict", input });
          return {
            output: "Conflict operation aborted",
          };
        },
        catch: (cause) =>
          new HostOperationError({
            operation: "test.effect",
            message: cause instanceof Error ? cause.message : String(cause),
            cause: cause,
          }),
      });
    },
  };
  const service: GitService = promiseService;
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
    await expect(
      router.invoke("git_comparison_target_get", {
        repoPath: "/repo",
        workingDir: "/worktree",
        target: { remote: "origin", branch: "main" },
      }),
    ).resolves.toEqual({ kind: "available", reference: "origin/main" });
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
      {
        method: "getComparisonTarget",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          target: { remote: "origin", branch: "main" },
        },
      },
      { method: "getStatus", input: { repoPath: "/repo" } },
      { method: "getDiff", input: { repoPath: "/repo", targetBranch: "origin/main" } },
      {
        method: "getWorktreeStatus",
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
  test("passes the refresh ID of a branch read and rejects a malformed one", async () => {
    const { calls, service } = createRecordingGitService();
    const router = createHostCommandRouter({
      handlers: createGitCommandHandlers(service),
    });
    await router.invoke("git_get_current_branch", {
      repoPath: "/repo",
      workingDir: "/worktree",
      readContext: { refreshId: "refresh" },
    });
    expect(calls).toEqual([
      {
        method: "getCurrentBranch",
        input: {
          repoPath: "/repo",
          workingDir: "/worktree",
          readContext: { refreshId: "refresh" },
        },
      },
    ]);
    await expect(
      router.invoke("git_get_current_branch", {
        repoPath: "/repo",
        readContext: { refreshId: "" },
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
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
  test("routes local change, staged commit, and history commands with contract inputs", async () => {
    const { calls, service } = createRecordingGitService();
    const router = createHostCommandRouter({
      handlers: createGitCommandHandlers(service),
    });
    await router.invoke("git_get_local_changes", { repoPath: "/repo", workingDir: "/worktree" });
    const selection = {
      repoPath: "/repo",
      workingDir: "/worktree",
      expectedBranch: BRANCH,
      snapshots: { unstaged: SNAPSHOT, staged: SNAPSHOT },
      action: "stage",
      group: "unstaged",
      selection: { kind: "hunk", filePath: "src/main.ts", hunkIndex: 1 },
    };
    await expect(router.invoke("git_change_selection", selection)).resolves.toEqual({
      affectedPaths: ["src/main.ts"],
      localChanges: localChangesFixture(),
    });
    await router.invoke("git_commit_staged", {
      repoPath: "/repo",
      workingDir: "/worktree",
      message: "Ship staged work",
      expectedBranch: BRANCH,
      stagedSnapshot: SNAPSHOT,
    });
    await router.invoke("git_get_history_page", {
      repoPath: "/repo",
      workingDir: "/worktree",
      targetReference: "refs/remotes/origin/main",
      expectedBranch: BRANCH,
    });
    await router.invoke("git_commit_all", {
      repoPath: "/repo",
      message: "Ship all",
      expectedBranch: BRANCH,
    });
    expect(calls.map((call) => call.method)).toEqual([
      "getLocalChanges",
      "changeSelection",
      "commitStaged",
      "getHistoryPage",
      "commitAll",
    ]);
    expect(calls[1]?.input).toEqual(selection);
    expect(calls[4]?.input).toEqual({
      repoPath: "/repo",
      message: "Ship all",
      expectedBranch: BRANCH,
    });
  });
  test("rejects change selections whose action does not fit the group", async () => {
    const { calls, service } = createRecordingGitService();
    const router = createHostCommandRouter({
      handlers: createGitCommandHandlers(service),
    });
    const request = {
      repoPath: "/repo",
      expectedBranch: BRANCH,
      snapshots: { unstaged: SNAPSHOT, staged: SNAPSHOT },
      selection: { kind: "file", filePath: "src/main.ts" },
    };
    await expect(
      router.invoke("git_change_selection", { ...request, action: "stage", group: "staged" }),
    ).rejects.toThrow("Stage applies only to unstaged changes.");
    await expect(
      router.invoke("git_change_selection", { ...request, action: "unstage", group: "unstaged" }),
    ).rejects.toThrow("Unstage applies only to staged changes.");
    await expect(
      router.invoke("git_change_selection", {
        ...request,
        action: "discard",
        group: "unstaged",
        selection: { kind: "all" },
      }),
    ).rejects.toThrow("Discard applies to one file or one chunk.");
    expect(calls).toEqual([]);
  });
});
