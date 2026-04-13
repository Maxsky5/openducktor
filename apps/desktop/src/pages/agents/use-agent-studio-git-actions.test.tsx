import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const gitCommitAllMock = mock(async () => ({ outcome: "committed", commitHash: "abc123" }));
const gitPushBranchMock = mock(async () => ({
  remote: "origin",
  branch: "feature/task-10",
  output: "done",
}));
const gitPullBranchMock = mock(async () => ({ outcome: "pulled", output: "updated" }));
const gitRebaseBranchMock = mock(async () => ({ outcome: "rebased" }));
const gitAbortConflictMock = mock(async () => ({ output: "aborted" }));
const gitRebaseAbortMock = mock(async () => ({ outcome: "aborted" }));
const gitResetWorktreeSelectionMock = mock(async () => ({ affectedPaths: ["src/main.ts"] }));
const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});

type UseAgentStudioGitActionsHook =
  typeof import("./use-agent-studio-git-actions")["useAgentStudioGitActions"];

let useAgentStudioGitActions: UseAgentStudioGitActionsHook;

type HookArgs = Parameters<UseAgentStudioGitActionsHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioGitActions, initialProps);

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  repoPath: "/repo",
  workingDir: null,
  branch: "feature/task-10",
  targetBranch: "origin/main",
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
  refreshDiffData: async () => {},
  ...overrides,
});

beforeAll(async () => {
  mock.module("@/state/operations/shared/host", () => ({
    host: {
      gitCommitAll: gitCommitAllMock,
      gitPushBranch: gitPushBranchMock,
      gitPullBranch: gitPullBranchMock,
      gitRebaseBranch: gitRebaseBranchMock,
      gitAbortConflict: gitAbortConflictMock,
      gitRebaseAbort: gitRebaseAbortMock,
      gitResetWorktreeSelection: gitResetWorktreeSelectionMock,
    },
  }));
  mock.module("sonner", () => ({
    toast: {
      success: toastSuccessMock,
      error: toastErrorMock,
    },
  }));
  ({ useAgentStudioGitActions } = await import("./use-agent-studio-git-actions"));
});

afterAll(async () => {
  await restoreMockedModules([
    ["@/state/operations/shared/host", () => import("@/state/operations/shared/host")],
    ["sonner", () => import("sonner")],
  ]);
});

beforeEach(() => {
  gitCommitAllMock.mockClear();
  gitPushBranchMock.mockClear();
  gitPullBranchMock.mockClear();
  gitRebaseBranchMock.mockClear();
  gitAbortConflictMock.mockClear();
  gitRebaseAbortMock.mockClear();
  gitResetWorktreeSelectionMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  gitCommitAllMock.mockImplementation(async () => ({ outcome: "committed", commitHash: "abc123" }));
  gitPushBranchMock.mockImplementation(async () => ({
    remote: "origin",
    branch: "feature/task-10",
    output: "done",
  }));
  gitPullBranchMock.mockImplementation(async () => ({ outcome: "pulled", output: "updated" }));
  gitRebaseBranchMock.mockImplementation(async () => ({ outcome: "rebased" }));
  gitAbortConflictMock.mockImplementation(async () => ({ output: "aborted" }));
  gitRebaseAbortMock.mockImplementation(async () => ({ outcome: "aborted" }));
  gitResetWorktreeSelectionMock.mockImplementation(async () => ({
    affectedPaths: ["src/main.ts"],
  }));
});

describe("useAgentStudioGitActions", () => {
  test("tracks commit action lifecycle and rejects blank commit messages", async () => {
    const refreshDiffData = mock(async () => {});
    const commitDeferred = createDeferred<{ outcome: string; commitHash: string }>();
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
      }),
    );

    gitCommitAllMock.mockImplementationOnce(async () => commitDeferred.promise);

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.commitAll("   ");
      });
      expect(harness.getLatest().commitError).toBe("Commit message cannot be empty.");
      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);

      await harness.run((state) => {
        void state.commitAll("  refine build flow  ");
      });

      await harness.waitFor((state) => state.isCommitting === true);
      expect(harness.getLatest().isCommitting).toBe(true);
      expect(harness.getLatest().isPushing).toBe(false);
      expect(harness.getLatest().isRebasing).toBe(false);

      commitDeferred.resolve({ outcome: "committed", commitHash: "abc123" });

      await harness.waitFor((state) => state.isCommitting === false);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().commitError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("returns success when the commit completes but diff refresh fails", async () => {
    const refreshDiffData = mock(async () => {
      throw new Error("Refresh exploded");
    });
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
      }),
    );

    try {
      await harness.mount();

      let didCommit = false;
      await harness.run(async (state) => {
        didCommit = await state.commitAll("feat: preserve commit success");
      });

      expect(didCommit).toBe(true);
      expect(gitCommitAllMock).toHaveBeenCalledWith(
        "/repo",
        "feat: preserve commit success",
        undefined,
      );
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().commitError).toBe("Refresh exploded");
    } finally {
      await harness.unmount();
    }
  });

  test("clears commit loading state after commit write failure", async () => {
    gitCommitAllMock.mockImplementationOnce(async () => {
      throw new Error("Commit hook exploded");
    });
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();

      let didCommit = true;
      await harness.run(async (state) => {
        didCommit = await state.commitAll("feat: broken commit");
      });

      expect(didCommit).toBe(false);
      expect(harness.getLatest().isCommitting).toBe(false);
      expect(harness.getLatest().commitError).toBe("Commit hook exploded");
    } finally {
      await harness.unmount();
    }
  });

  test("tracks push action lifecycle and validates missing branch errors", async () => {
    const refreshDiffData = mock(async () => {});
    const pushDeferred = createDeferred<{ remote: string; branch: string; output: string }>();
    const harness = createHookHarness(
      createBaseArgs({
        branch: null,
        refreshDiffData,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => state.pushBranch());
      expect(harness.getLatest().pushError).toBe(
        "Cannot push because current branch is unavailable.",
      );
      expect(gitPushBranchMock).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }

    const pushHarness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
      }),
    );
    gitPushBranchMock.mockImplementationOnce(async () => pushDeferred.promise);

    try {
      await pushHarness.mount();

      await pushHarness.run((state) => {
        void state.pushBranch();
      });
      await pushHarness.waitFor((state) => state.isPushing === true);
      expect(pushHarness.getLatest().isPushing).toBe(true);
      expect(pushHarness.getLatest().isCommitting).toBe(false);
      expect(pushHarness.getLatest().isRebasing).toBe(false);

      pushDeferred.resolve({ remote: "origin", branch: "feature/task-10", output: "done" });
      await pushHarness.waitFor((state) => state.isPushing === false);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(pushHarness.getLatest().pushError).toBeNull();
      expect(toastSuccessMock).toHaveBeenCalledWith("Pushed feature/task-10", {
        description: "Remote: origin",
      });
      expect(toastErrorMock).toHaveBeenCalledTimes(0);
    } finally {
      await pushHarness.unmount();
    }
  });

  test("tracks rebase action transition and clears error boundaries", async () => {
    const rebaseDeferred = createDeferred<{ outcome: string }>();
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    gitRebaseBranchMock.mockImplementationOnce(() => rebaseDeferred.promise);

    try {
      await harness.mount();

      await harness.run((state) => {
        void state.rebaseOntoTarget();
      });

      await harness.waitFor((state) => state.isRebasing === true);
      expect(harness.getLatest().isRebasing).toBe(true);
      expect(harness.getLatest().isCommitting).toBe(false);
      expect(harness.getLatest().isPushing).toBe(false);

      rebaseDeferred.resolve({ outcome: "rebased" });
      await harness.waitFor((state) => state.isRebasing === false);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps commit actions in flight until the soft refresh settles", async () => {
    const refreshDeferred = createDeferred<void>();
    const refreshDiffData = mock(async (_mode?: string) => refreshDeferred.promise);
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        void state.commitAll("fix: preserve disabled state");
      });

      await harness.waitFor((state) => state.isCommitting === true);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().isCommitting).toBe(true);

      refreshDeferred.resolve();
      await harness.waitFor((state) => state.isCommitting === false);
    } finally {
      await harness.unmount();
    }
  });

  test("requests confirmation and resets a file with snapshot metadata", async () => {
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.requestFileReset("src/main.ts");
      });

      expect(harness.getLatest().pendingReset).toEqual({ kind: "file", filePath: "src/main.ts" });

      await harness.run(async (state) => {
        await state.confirmReset();
      });

      expect(gitResetWorktreeSelectionMock).toHaveBeenCalledWith({
        repoPath: "/repo",
        workingDir: "/tmp/worktree/task-10",
        targetBranch: "origin/main",
        snapshot: {
          hashVersion: 1,
          statusHash: "0123456789abcdef",
          diffHash: "fedcba9876543210",
        },
        selection: {
          kind: "file",
          filePath: "src/main.ts",
        },
      });
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingReset).toBeNull();
      expect(harness.getLatest().resetError).toBeNull();
      expect(toastSuccessMock).toHaveBeenCalledWith("File reset", {
        description: "src/main.ts",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps reset blocked while git diff data is loading", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        isDiffDataLoading: true,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isResetDisabled).toBe(true);
      expect(harness.getLatest().resetDisabledReason).toBe(
        "Cannot reset while git diff data is loading.",
      );

      await harness.run((state) => {
        state.requestFileReset("src/main.ts");
      });

      expect(harness.getLatest().pendingReset).toBeNull();
      expect(harness.getLatest().resetError).toBe("Cannot reset while git diff data is loading.");
      expect(gitResetWorktreeSelectionMock).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("clears reset errors after a newer snapshot arrives", async () => {
    gitResetWorktreeSelectionMock.mockImplementationOnce(async () => {
      throw new Error("Displayed diff is stale. Refresh and try again.");
    });
    const harness = createHookHarness(
      createBaseArgs({
        worktreeStatusSnapshotKey: "1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.requestHunkReset("src/main.ts", 2);
      });
      await harness.run(async (state) => {
        await state.confirmReset();
      });

      expect(harness.getLatest().resetError).toBe(
        "Displayed diff is stale. Refresh and try again.",
      );

      await harness.update(
        createBaseArgs({
          worktreeStatusSnapshotKey: "1:cccccccccccccccc:dddddddddddddddd",
        }),
      );

      await harness.waitFor((state) => state.resetError === null);
      expect(harness.getLatest().pendingReset).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps reset successful when only the post-reset refresh fails", async () => {
    const refreshDiffData = mock(async () => {
      throw new Error("Refresh broke after reset");
    });
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        state.requestFileReset("src/main.ts");
      });
      await harness.run(async (state) => {
        await state.confirmReset();
      });

      expect(gitResetWorktreeSelectionMock).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingReset).toBeNull();
      expect(harness.getLatest().resetError).toBe("Refresh broke after reset");
      expect(toastSuccessMock).toHaveBeenCalledWith("File reset", {
        description: "src/main.ts",
      });
      expect(toastErrorMock).toHaveBeenCalledWith("Reset applied but refresh failed", {
        description: "Refresh broke after reset",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("uses the configured rebase target branch as provided", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        targetBranch: "main",
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.rebaseOntoTarget();
      });

      expect(gitRebaseBranchMock).toHaveBeenCalledWith("/repo", "main", undefined);
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("pulls from upstream using dedicated pull endpoint", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });

      expect(gitPullBranchMock).toHaveBeenCalledWith("/repo", undefined);
      expect(gitRebaseBranchMock).toHaveBeenCalledTimes(0);
      expect(toastSuccessMock).toHaveBeenCalledWith("Pulled from upstream");
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("requires confirmation before pull rebases local commits onto upstream", async () => {
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        upstreamAheadBehind: { ahead: 2, behind: 1 },
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });

      expect(gitPullBranchMock).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().pendingPullRebase).toEqual({
        branch: "feature/task-10",
        localAhead: 2,
        upstreamBehind: 1,
      });

      await harness.run(async (state) => {
        await state.confirmPullRebase();
      });

      expect(gitPullBranchMock).toHaveBeenCalledWith("/repo", undefined);
      expect(toastSuccessMock).toHaveBeenCalledWith("Rebased local commits onto upstream", {
        description: "Reapplied 2 local commits.",
      });
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingPullRebase).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the pull confirmation state open until the confirmed pull completes", async () => {
    const refreshDiffData = mock(async () => {});
    const pullDeferred = createDeferred<{ outcome: string; output: string }>();
    gitPullBranchMock.mockImplementationOnce(async () => pullDeferred.promise);
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        upstreamAheadBehind: { ahead: 2, behind: 1 },
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });
      expect(harness.getLatest().pendingPullRebase).toEqual({
        branch: "feature/task-10",
        localAhead: 2,
        upstreamBehind: 1,
      });

      await harness.run((state) => {
        void state.confirmPullRebase();
      });

      await harness.waitFor((state) => state.isRebasing === true);
      expect(harness.getLatest().pendingPullRebase).toEqual({
        branch: "feature/task-10",
        localAhead: 2,
        upstreamBehind: 1,
      });

      pullDeferred.resolve({ outcome: "pulled", output: "updated" });

      await harness.waitFor((state) => state.isRebasing === false);
      expect(harness.getLatest().pendingPullRebase).toBeNull();
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("clears pending pull confirmation when the confirmed pull fails", async () => {
    const failure = new Error("auth failed");
    gitPullBranchMock.mockImplementationOnce(async () => {
      throw failure;
    });
    const harness = createHookHarness(
      createBaseArgs({
        upstreamAheadBehind: { ahead: 2, behind: 1 },
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });
      expect(harness.getLatest().pendingPullRebase).toEqual({
        branch: "feature/task-10",
        localAhead: 2,
        upstreamBehind: 1,
      });

      await harness.run(async (state) => {
        await state.confirmPullRebase();
      });

      expect(harness.getLatest().pendingPullRebase).toBeNull();
      expect(harness.getLatest().rebaseError).toBe("auth failed");
      expect(toastErrorMock).toHaveBeenCalledWith("Pull failed", {
        description: "auth failed",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("can cancel pending pull rebase confirmation", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        upstreamAheadBehind: { ahead: 2, behind: 1 },
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });
      expect(harness.getLatest().pendingPullRebase).not.toBeNull();

      await harness.run(async (state) => {
        state.cancelPullRebase();
      });

      expect(gitPullBranchMock).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().pendingPullRebase).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("derives persistent conflict state from unmerged files and blocks commit", async () => {
    const onResolveGitConflict = mock(async () => true);
    const harness = createHookHarness(
      createBaseArgs({
        detectedConflictedFiles: ["AGENTS.md"],
        onResolveGitConflict,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().gitConflict).toEqual({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "current rebase target",
        conflictedFiles: ["AGENTS.md"],
        output:
          "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(harness.getLatest().isGitActionsLocked).toBe(true);
      expect(harness.getLatest().gitActionsLockReason).toBe(
        "Git actions are disabled while git conflicts are unresolved.",
      );
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(0);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(0);

      await harness.run(async (state) => {
        await state.commitAll("restore lost work");
      });

      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().commitError).toBe(
        "Git actions are disabled while git conflicts are unresolved.",
      );

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(onResolveGitConflict).toHaveBeenCalledWith({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "current rebase target",
        conflictedFiles: ["AGENTS.md"],
        output:
          "Git conflict is still in progress in this worktree. Previous command output is unavailable after reload.",
        workingDir: "/tmp/worktree/task-10",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("suppresses the lock banner when git actions are locked only because Builder is working", async () => {
    const harness = createHookHarness(
      createBaseArgs({
        isBuilderSessionWorking: true,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().isGitActionsLocked).toBe(true);
      expect(harness.getLatest().gitActionsLockReason).toBe(
        "Git actions are disabled while the Builder session is working.",
      );
      expect(harness.getLatest().showLockReasonBanner).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("does not request a lock banner when git actions are unlocked", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();

      expect(harness.getLatest().isGitActionsLocked).toBe(false);
      expect(harness.getLatest().showLockReasonBanner).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("reports clear pull error when branch is unavailable", async () => {
    const harness = createHookHarness(createBaseArgs({ branch: null }));

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });

      expect(gitPullBranchMock).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().rebaseError).toBe(
        "Cannot pull because current branch is unavailable.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("shows up-to-date toast when pull reports no upstream commits", async () => {
    gitPullBranchMock.mockImplementationOnce(async () => ({
      outcome: "up_to_date",
      output: "Already up to date.",
    }));
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });

      expect(toastSuccessMock).toHaveBeenCalledWith("Already up to date");
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("reports pull conflicts with actionable file list", async () => {
    gitPullBranchMock.mockImplementationOnce(async () => ({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts", "src/lib.ts"],
      output: "Automatic merge failed; fix conflicts and then commit the result.",
    }));
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        upstreamAheadBehind: { ahead: 2, behind: 1 },
      }),
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.pullFromUpstream();
      });
      expect(harness.getLatest().pendingPullRebase).toEqual({
        branch: "feature/task-10",
        localAhead: 2,
        upstreamBehind: 1,
      });

      await harness.run(async (state) => {
        await state.confirmPullRebase();
      });

      expect(toastSuccessMock).toHaveBeenCalledTimes(0);
      expect(toastErrorMock).toHaveBeenCalledWith("Pull requires conflict resolution", {
        description: "Pull with rebase stopped due to conflicts in: src/main.ts, src/lib.ts.",
      });
      expect(harness.getLatest().gitConflict).toEqual({
        operation: "pull_rebase",
        currentBranch: "feature/task-10",
        targetBranch: "tracked upstream branch",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        output: "Automatic merge failed; fix conflicts and then commit the result.",
        workingDir: null,
      });
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(1);
      expect(harness.getLatest().rebaseError).toBeNull();
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("captures rebase conflicts and can hand them to Builder", async () => {
    gitRebaseBranchMock.mockImplementationOnce(async () => ({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts", "src/lib.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    }));
    const onResolveGitConflict = mock(async () => true);
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
        onResolveGitConflict,
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.rebaseOntoTarget();
      });

      expect(harness.getLatest().gitConflict).toEqual({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        output: "CONFLICT (content): Merge conflict in src/main.ts",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(1);
      expect(harness.getLatest().rebaseError).toBeNull();
      expect(refreshDiffData).toHaveBeenCalledTimes(1);

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(onResolveGitConflict).toHaveBeenCalledWith({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        output: "CONFLICT (content): Merge conflict in src/main.ts",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(harness.getLatest().gitConflict).toEqual({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "origin/main",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        output: "CONFLICT (content): Merge conflict in src/main.ts",
        workingDir: "/tmp/worktree/task-10",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("tracks abort rebase action lifecycle while conflict resolution is pending", async () => {
    gitRebaseBranchMock.mockImplementationOnce(async () => ({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    }));
    const abortDeferred = createDeferred<{ output: string }>();
    gitAbortConflictMock.mockImplementationOnce(async () => abortDeferred.promise);
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.rebaseOntoTarget();
      });
      await harness.update(
        createBaseArgs({
          refreshDiffData,
          workingDir: "/tmp/worktree/other",
        }),
      );

      await harness.run((state) => {
        void state.abortGitConflict();
      });

      await harness.waitFor(
        (state) => state.isHandlingGitConflict && state.gitConflictAction === "abort",
      );
      expect(harness.getLatest().isHandlingGitConflict).toBe(true);
      expect(harness.getLatest().gitConflictAction).toBe("abort");

      abortDeferred.resolve({ output: "aborted" });

      await harness.waitFor((state) => !state.isHandlingGitConflict);
      expect(harness.getLatest().gitConflictAction).toBeNull();
      expect(harness.getLatest().gitConflict).toBeNull();
      expect(harness.getLatest().gitConflictCloseNonce).toBe(1);
      expect(refreshDiffData).toHaveBeenCalledTimes(2);
      expect(gitAbortConflictMock).toHaveBeenCalledWith("/repo", "rebase", "/tmp/worktree/task-10");
      expect(toastSuccessMock).toHaveBeenCalledWith("Rebase aborted");
    } finally {
      await harness.unmount();
    }
  });

  test("keeps abort successful when only the post-abort refresh fails", async () => {
    gitRebaseBranchMock.mockImplementationOnce(async () => ({
      outcome: "conflicts",
      conflictedFiles: ["src/main.ts"],
      output: "CONFLICT (content): Merge conflict in src/main.ts",
    }));
    const refreshDiffData = mock(async () => {});
    let refreshCalls = 0;
    refreshDiffData.mockImplementation(async () => {
      refreshCalls += 1;
      if (refreshCalls === 2) {
        throw new Error("Refresh broke after abort");
      }
    });
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.rebaseOntoTarget();
      });

      await harness.run(async (state) => {
        await state.abortGitConflict();
      });

      expect(harness.getLatest().gitConflict).toBeNull();
      expect(harness.getLatest().gitConflictCloseNonce).toBe(1);
      expect(harness.getLatest().rebaseError).toBe("Refresh broke after abort");
      expect(toastSuccessMock).toHaveBeenCalledWith("Rebase aborted");
      expect(toastErrorMock).toHaveBeenCalledWith("Conflict aborted but refresh failed", {
        description: "Refresh broke after abort",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("tracks ask-builder action lifecycle while request is pending", async () => {
    const resolveDeferred = createDeferred<boolean>();
    const onResolveGitConflict = mock(async () => resolveDeferred.promise);
    const harness = createHookHarness(
      createBaseArgs({
        detectedConflictedFiles: ["AGENTS.md"],
        onResolveGitConflict,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run((state) => {
        void state.askBuilderToResolveGitConflict();
      });

      await harness.waitFor(
        (state) => state.isHandlingGitConflict && state.gitConflictAction === "ask_builder",
      );
      expect(harness.getLatest().isHandlingGitConflict).toBe(true);
      expect(harness.getLatest().gitConflictAction).toBe("ask_builder");

      resolveDeferred.resolve(true);

      await harness.waitFor((state) => !state.isHandlingGitConflict);
      expect(harness.getLatest().gitConflictAction).toBeNull();
      expect(harness.getLatest().gitConflict).not.toBeNull();
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Sent git conflict resolution request to Builder",
      );
    } finally {
      await harness.unmount();
    }
  });

  test("clears local conflict state after a newer clean worktree snapshot arrives", async () => {
    gitRebaseBranchMock.mockImplementationOnce(async () => ({
      outcome: "conflicts",
      conflictedFiles: ["AGENTS.md"],
      output: "CONFLICT (content): Merge conflict in AGENTS.md",
    }));
    const harness = createHookHarness(
      createBaseArgs({
        workingDir: "/tmp/worktree/task-10",
        worktreeStatusSnapshotKey: "1:aaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbb",
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.rebaseOntoTarget();
      });

      expect(harness.getLatest().gitConflict).toEqual({
        operation: "rebase",
        currentBranch: "feature/task-10",
        targetBranch: "origin/main",
        conflictedFiles: ["AGENTS.md"],
        output: "CONFLICT (content): Merge conflict in AGENTS.md",
        workingDir: "/tmp/worktree/task-10",
      });

      await harness.update(
        createBaseArgs({
          workingDir: "/tmp/worktree/task-10",
          detectedConflictedFiles: [],
          worktreeStatusSnapshotKey: "1:cccccccccccccccc:dddddddddddddddd",
        }),
      );

      await harness.waitFor((state) => state.gitConflict === null);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(1);
      expect(harness.getLatest().isGitActionsLocked).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("requires confirmation before retrying push with force-with-lease", async () => {
    gitPushBranchMock
      .mockImplementationOnce(async () => ({
        outcome: "rejected_non_fast_forward",
        remote: "origin",
        branch: "feature/task-10",
        output: "non-fast-forward",
      }))
      .mockImplementationOnce(async () => ({
        outcome: "pushed",
        remote: "origin",
        branch: "feature/task-10",
        output: "done",
      }));
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pushBranch();
      });

      expect(harness.getLatest().pendingForcePush).toEqual({
        remote: "origin",
        branch: "feature/task-10",
        output: "non-fast-forward",
        repoPath: "/repo",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(refreshDiffData).toHaveBeenCalledTimes(0);

      await harness.run(async (state) => {
        await state.confirmForcePush();
      });

      expect(gitPushBranchMock).toHaveBeenNthCalledWith(2, "/repo", "feature/task-10", {
        setUpstream: true,
        forceWithLease: true,
        workingDir: "/tmp/worktree/task-10",
      });
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingForcePush).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("reuses the originally rejected target when confirming force push", async () => {
    gitPushBranchMock
      .mockImplementationOnce(async () => ({
        outcome: "rejected_non_fast_forward",
        remote: "origin",
        branch: "feature/task-10",
        output: "non-fast-forward",
      }))
      .mockImplementationOnce(async () => ({
        outcome: "pushed",
        remote: "origin",
        branch: "feature/task-10",
        output: "done",
      }));
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.pushBranch();
      });

      await harness.update(
        createBaseArgs({
          repoPath: "/repo-2",
          branch: "feature/task-11",
          refreshDiffData,
          workingDir: "/tmp/worktree/task-11",
        }),
      );

      await harness.run(async (state) => {
        await state.confirmForcePush();
      });

      expect(gitPushBranchMock).toHaveBeenNthCalledWith(2, "/repo", "feature/task-10", {
        setUpstream: true,
        forceWithLease: true,
        workingDir: "/tmp/worktree/task-10",
      });
    } finally {
      await harness.unmount();
    }
  });

  test("keeps failure state isolated when rebase fails", async () => {
    const rebaseDeferred = createDeferred<{ outcome: string }>();
    gitRebaseBranchMock.mockImplementationOnce(() => rebaseDeferred.promise);
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    let rebasePromise: Promise<void> | null = null;

    try {
      await harness.mount();

      await harness.run((state) => {
        rebasePromise = state.rebaseOntoTarget();
      });
      await harness.waitFor((state) => state.isRebasing);

      expect(harness.getLatest().isCommitting).toBe(false);
      expect(harness.getLatest().isPushing).toBe(false);

      await harness.run(async () => {
        rebaseDeferred.reject(new Error("Merge conflicts"));
        if (rebasePromise) {
          await rebasePromise.catch(() => {});
        }
      });
      await harness.waitFor((state) => state.isRebasing === false);

      const state = harness.getLatest();
      expect(state.isCommitting).toBe(false);
      expect(state.isPushing).toBe(false);
      expect(state.rebaseError).toContain("Merge conflicts");
      expect(state.commitError).toBeNull();
      expect(state.pushError).toBeNull();
      expect(refreshDiffData).toHaveBeenCalledTimes(0);
    } finally {
      rebaseDeferred.resolve({ outcome: "rebased" });
      await harness.unmount();
    }
  });

  test("refreshes and clears stale action errors after successful push", async () => {
    gitRebaseBranchMock.mockImplementationOnce(async () => {
      throw new Error("Rebase failed due to conflicts");
    });
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({
        refreshDiffData,
        workingDir: "/tmp/worktree/task-10",
      }),
    );

    try {
      await harness.mount();

      await harness.run(async (state) => {
        await state.rebaseOntoTarget();
      });
      await harness.waitFor((state) => state.rebaseError !== null);
      expect(harness.getLatest().rebaseError).toContain("Rebase failed due to conflicts");

      await harness.run(async (state) => {
        await state.pushBranch();
      });
      await harness.waitFor((state) => state.isPushing === false);

      expect(gitPushBranchMock).toHaveBeenCalledWith("/repo", "feature/task-10", {
        forceWithLease: false,
        setUpstream: true,
        workingDir: "/tmp/worktree/task-10",
      });
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(toastSuccessMock).toHaveBeenCalledWith("Pushed feature/task-10", {
        description: "Remote: origin",
      });

      const state = harness.getLatest();
      expect(state.rebaseError).toBeNull();
      expect(state.pushError).toBeNull();
      expect(state.commitError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("reports push failure through state and toast", async () => {
    gitPushBranchMock.mockImplementationOnce(async () => {
      throw new Error("Remote rejected update");
    });
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

    try {
      await harness.mount();
      await harness.run(async (state) => {
        await state.pushBranch();
      });

      await harness.waitFor((state) => state.isPushing === false);
      expect(harness.getLatest().pushError).toContain("Remote rejected update");
      expect(refreshDiffData).toHaveBeenCalledTimes(0);
      expect(toastSuccessMock).toHaveBeenCalledTimes(0);
      expect(toastErrorMock).toHaveBeenCalledWith("Push failed", {
        description: "Remote rejected update",
      });
    } finally {
      await harness.unmount();
    }
  });
});
