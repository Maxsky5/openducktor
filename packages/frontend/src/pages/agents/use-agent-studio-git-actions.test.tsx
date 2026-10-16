import { createAgentMessageSendReceipt } from "@/test-utils/agent-message-send-fixture";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { GitChangeSelectionRequest, GitLocalChanges } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import {
  type AgentStudioPendingDiscard,
  type GitChangeIntent,
  type GitConflict,
  gitChangeIntentKey,
} from "@/features/agent-studio-git";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

const actualSonnerModule = await import("sonner");

type RestorableSpy = { mockRestore(): void };
let testSpies: RestorableSpy[] = [];
type GitCommitResult = Awaited<ReturnType<HostClient["gitCommitAll"]>>;
type GitChangeResult = Awaited<ReturnType<HostClient["gitChangeSelection"]>>;
type GitPushResult = Awaited<ReturnType<HostClient["gitPushBranch"]>>;
type GitPullResult = Awaited<ReturnType<HostClient["gitPullBranch"]>>;
type GitRebaseResult = Awaited<ReturnType<HostClient["gitRebaseBranch"]>>;

enableReactActEnvironment();

const gitCommitAllMock = mock<HostClient["gitCommitAll"]>(async () => ({
  outcome: "committed",
  commitHash: "abc123",
  output: "committed",
}));
const gitCommitStagedMock = mock<HostClient["gitCommitStaged"]>(async () => ({
  outcome: "committed",
  commitHash: "def456",
  output: "committed",
}));
const gitPushBranchMock = mock<HostClient["gitPushBranch"]>(async () => ({
  outcome: "pushed",
  remote: "origin",
  branch: "feature/task-10",
  output: "done",
}));
const gitPullBranchMock = mock<HostClient["gitPullBranch"]>(async () => ({
  outcome: "pulled",
  output: "updated",
}));
const gitRebaseBranchMock = mock<HostClient["gitRebaseBranch"]>(async () => ({
  outcome: "rebased",
  output: "rebased",
}));
const gitAbortConflictMock = mock<HostClient["gitAbortConflict"]>(async () => ({
  output: "aborted",
}));
const gitRebaseAbortMock = mock<HostClient["gitRebaseAbort"]>(async () => ({
  outcome: "aborted",
  output: "aborted",
}));
/** A Git result. Each `observedAtMs` gives its own snapshots, so a test can see which one a request used. */
const createChangeResult = (observedAtMs = 2, affectedPaths = ["src/main.ts"]): GitChangeResult => {
  const localChanges = createLocalChanges();
  const hash = observedAtMs.toString(16).padStart(16, "0");
  localChanges.unstaged.snapshot = { ...localChanges.unstaged.snapshot, statusHash: hash };
  localChanges.staged.snapshot = { ...localChanges.staged.snapshot, diffHash: hash };
  localChanges.snapshot = { ...localChanges.snapshot, observedAtMs };
  return { affectedPaths, localChanges };
};
const gitChangeSelectionMock = mock<HostClient["gitChangeSelection"]>(async () =>
  createChangeResult(),
);
const toastSuccessMock = mock(() => "toast-success");
const toastErrorMock = mock(() => "toast-error");

type UseAgentStudioGitActionsHook =
  (typeof import("./use-agent-studio-git-actions"))["useAgentStudioGitActions"];

let useAgentStudioGitActions: UseAgentStudioGitActionsHook;

type HookArgs = Parameters<UseAgentStudioGitActionsHook>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioGitActions, initialProps);

const createExpectedBranch = () => ({ name: "feature/task-10", detached: false });
const createUnstagedSnapshot = () => ({
  hashVersion: 1,
  statusHash: "0123456789abcdef",
  diffHash: "fedcba9876543210",
});
const createStagedSnapshot = () => ({
  hashVersion: 1,
  statusHash: "1111111111111111",
  diffHash: "2222222222222222",
});

const createLocalChanges = (): GitLocalChanges => ({
  currentBranch: createExpectedBranch(),
  fileStatuses: [
    { path: "src/main.ts", status: "modified", staged: false },
    { path: "src/new.ts", status: "untracked", staged: false },
    { path: "src/staged.ts", status: "modified", staged: true },
  ],
  unstaged: {
    fileStatuses: [
      { path: "src/main.ts", status: "modified", staged: false },
      { path: "src/new.ts", status: "untracked", staged: false },
    ],
    fileDiffs: [],
    snapshot: createUnstagedSnapshot(),
  },
  staged: {
    fileStatuses: [{ path: "src/staged.ts", status: "modified", staged: true }],
    fileDiffs: [],
    snapshot: createStagedSnapshot(),
  },
  conflicted: { fileStatuses: [], fileDiffs: [] },
  upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
  snapshot: {
    effectiveWorkingDir: "/repo",
    targetBranch: "HEAD",
    diffScope: "uncommitted",
    observedAtMs: 1,
    hashVersion: 1,
    statusHash: "3333333333333333",
    diffHash: "4444444444444444",
  },
});

const createBaseArgs = (overrides: Partial<HookArgs> = {}): HookArgs => ({
  repoPath: "/repo",
  workingDir: null,
  branch: "feature/task-10",
  targetBranch: "origin/main",
  localChanges: createLocalChanges(),
  refreshDiffData: async () => {},
  applyLocalChanges: async () => {},
  ...overrides,
});

const createIntent = (
  action: GitChangeIntent["action"],
  group: GitChangeIntent["group"],
  selection: GitChangeIntent["selection"] = { kind: "file", filePath: "src/main.ts" },
): GitChangeIntent => ({ action, group, selection });

/** The request that `createLocalChanges` content produces for one intent. */
const createExpectedChangeRequest = (
  intent: GitChangeIntent,
  workingDir?: string,
): GitChangeSelectionRequest => {
  const request: GitChangeSelectionRequest = {
    repoPath: "/repo",
    expectedBranch: createExpectedBranch(),
    snapshots: { unstaged: createUnstagedSnapshot(), staged: createStagedSnapshot() },
    ...intent,
  };
  if (workingDir) request.workingDir = workingDir;
  return request;
};

const createDetectedConflict = (overrides: Partial<GitConflict> = {}): GitConflict => ({
  operation: "rebase",
  currentBranch: "feature/task-10",
  targetBranch: "origin/main",
  conflictedFiles: ["AGENTS.md"],
  output: "interactive rebase in progress; onto origin/main",
  workingDir: "/tmp/worktree/task-10",
  ...overrides,
});

beforeEach(async () => {
  configureShellBridge(
    createShellBridgeFixture({
      client: {
        gitCommitAll: gitCommitAllMock,
        gitCommitStaged: gitCommitStagedMock,
        gitPushBranch: gitPushBranchMock,
        gitPullBranch: gitPullBranchMock,
        gitRebaseBranch: gitRebaseBranchMock,
        gitAbortConflict: gitAbortConflictMock,
        gitRebaseAbort: gitRebaseAbortMock,
        gitChangeSelection: gitChangeSelectionMock,
      },
    }),
  );
  testSpies = [
    spyOn(actualSonnerModule.toast, "success").mockImplementation(toastSuccessMock),
    spyOn(actualSonnerModule.toast, "error").mockImplementation(toastErrorMock),
  ];
  ({ useAgentStudioGitActions } = await import("./use-agent-studio-git-actions"));
});

afterEach(() => {
  for (const testSpy of testSpies) testSpy.mockRestore();
  testSpies = [];
  configureShellBridge(createUnavailableShellBridge());
});

beforeEach(() => {
  gitCommitAllMock.mockClear();
  gitCommitStagedMock.mockClear();
  gitPushBranchMock.mockClear();
  gitPullBranchMock.mockClear();
  gitRebaseBranchMock.mockClear();
  gitAbortConflictMock.mockClear();
  gitRebaseAbortMock.mockClear();
  gitChangeSelectionMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  gitCommitAllMock.mockImplementation(async () => ({
    outcome: "committed",
    commitHash: "abc123",
    output: "committed",
  }));
  gitCommitStagedMock.mockImplementation(async () => ({
    outcome: "committed",
    commitHash: "def456",
    output: "committed",
  }));
  gitPushBranchMock.mockImplementation(async () => ({
    outcome: "pushed",
    remote: "origin",
    branch: "feature/task-10",
    output: "done",
  }));
  gitPullBranchMock.mockImplementation(async () => ({ outcome: "pulled", output: "updated" }));
  gitRebaseBranchMock.mockImplementation(async () => ({ outcome: "rebased", output: "rebased" }));
  gitAbortConflictMock.mockImplementation(async () => ({ output: "aborted" }));
  gitRebaseAbortMock.mockImplementation(async () => ({ outcome: "aborted", output: "aborted" }));
  gitChangeSelectionMock.mockImplementation(async () => createChangeResult());
});

describe("useAgentStudioGitActions", () => {
  test("retains the original rebase request and operation lock after target selection changes", async () => {
    const deferred = createDeferred<GitRebaseResult>();
    gitRebaseBranchMock.mockImplementationOnce(() => deferred.promise);
    const harness = createHookHarness(
      createBaseArgs({
        contextKey: "first",
        workingDir: "/repo/task",
        targetBranch: "refs/heads/release",
      }),
    );
    let running: Promise<void> | undefined;
    try {
      await harness.mount();
      await harness.run((state) => {
        running = state.rebaseOntoTarget();
      });
      await harness.update(
        createBaseArgs({
          contextKey: "second",
          workingDir: "/repo/task",
          targetBranch: "refs/remotes/origin/main",
        }),
      );
      expect(harness.getLatest().isRebasing).toBe(true);
      await harness.run(async (state) => {
        await state.pushBranch();
        await state.rebaseOntoTarget();
      });
      expect(gitRebaseBranchMock).toHaveBeenCalledTimes(1);
      expect(gitRebaseBranchMock).toHaveBeenCalledWith("/repo", "refs/heads/release", "/repo/task");
      expect(gitPushBranchMock).not.toHaveBeenCalled();
      await harness.run(async () => {
        deferred.resolve({ outcome: "rebased", output: "done" });
        await running;
      });
      expect(harness.getLatest().isRebasing).toBe(false);
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      deferred.resolve({ outcome: "rebased", output: "done" });
      await running;
      await harness.unmount();
    }
  });

  test("tracks the staged commit lifecycle and rejects blank commit messages", async () => {
    const refreshDiffData = mock(async () => {});
    const commitDeferred = createDeferred<GitCommitResult>();
    gitCommitStagedMock.mockImplementationOnce(() => commitDeferred.promise);
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));
    let running: Promise<boolean> | undefined;

    try {
      await harness.mount();

      let blankResult = true;
      await harness.run(async (state) => {
        blankResult = await state.commit("staged", "   ");
      });
      expect(blankResult).toBe(false);
      expect(harness.getLatest().commitError).toBe("Commit message cannot be empty.");
      expect(gitCommitStagedMock).toHaveBeenCalledTimes(0);
      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);

      await harness.run((state) => {
        running = state.commit("staged", "  refine build flow  ");
      });

      await harness.waitFor((state) => state.isCommitting);
      expect(harness.getLatest().committingMode).toBe("staged");
      expect(harness.getLatest().commitError).toBeNull();
      expect(harness.getLatest().isPushing).toBe(false);
      expect(harness.getLatest().isRebasing).toBe(false);
      expect(gitCommitStagedMock).toHaveBeenCalledWith({
        repoPath: "/repo",
        message: "refine build flow",
        expectedBranch: createExpectedBranch(),
        stagedSnapshot: createStagedSnapshot(),
      });
      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);

      let didCommit = false;
      await harness.run(async () => {
        commitDeferred.resolve({ outcome: "committed", commitHash: "abc123", output: "committed" });
        didCommit = (await running) ?? false;
      });

      expect(didCommit).toBe(true);
      expect(harness.getLatest().isCommitting).toBe(false);
      expect(harness.getLatest().committingMode).toBeNull();
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().commitError).toBeNull();
    } finally {
      commitDeferred.resolve({ outcome: "committed", commitHash: "abc123", output: "committed" });
      await running;
      await harness.unmount();
    }
  });

  test("sends staged and Commit all requests with the expected branch", async () => {
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(
      createBaseArgs({ refreshDiffData, workingDir: "/tmp/worktree/task-10" }),
    );

    try {
      await harness.mount();

      let stagedResult = false;
      await harness.run(async (state) => {
        stagedResult = await state.commit("staged", "feat: staged work");
      });
      expect(stagedResult).toBe(true);
      expect(gitCommitStagedMock).toHaveBeenCalledWith({
        repoPath: "/repo",
        workingDir: "/tmp/worktree/task-10",
        message: "feat: staged work",
        expectedBranch: createExpectedBranch(),
        stagedSnapshot: createStagedSnapshot(),
      });
      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);

      let allResult = false;
      await harness.run(async (state) => {
        allResult = await state.commit("all", "  feat: all work  ");
      });
      expect(allResult).toBe(true);
      expect(gitCommitAllMock).toHaveBeenCalledWith(
        "/repo",
        "feat: all work",
        "/tmp/worktree/task-10",
        createExpectedBranch(),
      );
      expect(gitCommitStagedMock).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().commitError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("refuses to commit while the local changes are unavailable", async () => {
    const harness = createHookHarness(createBaseArgs({ localChanges: null }));

    try {
      await harness.mount();

      let didCommit = true;
      await harness.run(async (state) => {
        didCommit = await state.commit("staged", "feat: no snapshot");
      });

      expect(didCommit).toBe(false);
      expect(harness.getLatest().commitError).toBe(
        "Cannot commit because the changes are unavailable. Refresh and try again.",
      );
      expect(gitCommitStagedMock).toHaveBeenCalledTimes(0);
      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("returns success and names the commit when only the panel refresh fails", async () => {
    gitCommitStagedMock.mockImplementationOnce(async () => ({
      outcome: "committed",
      commitHash: "abc1234def5678abc1234def5678abc1234def56",
      output: "committed",
    }));
    const refreshDiffData = mock(async () => {
      throw new Error("Refresh exploded.");
    });
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

    try {
      await harness.mount();

      let didCommit = false;
      await harness.run(async (state) => {
        didCommit = await state.commit("staged", "feat: preserve commit success");
      });

      expect(didCommit).toBe(true);
      expect(gitCommitStagedMock).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().isCommitting).toBe(false);
      expect(harness.getLatest().commitError).toBe(
        "Commit abc1234 succeeded, but the panel could not update: Refresh exploded. Refresh to try again.",
      );
    } finally {
      await harness.unmount();
    }
  });

  test.each([
    ["staged", "Git found no staged changes to commit. Stage files or chunks first."],
    ["all", "Git found no changes to commit."],
  ] as const)("reports a %s commit that finds no changes", async (mode, expectedError) => {
    const noChanges = async (): Promise<GitCommitResult> => ({
      outcome: "no_changes",
      output: "nothing to commit",
    });
    if (mode === "staged") gitCommitStagedMock.mockImplementationOnce(noChanges);
    else gitCommitAllMock.mockImplementationOnce(noChanges);
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

    try {
      await harness.mount();

      let didCommit = true;
      await harness.run(async (state) => {
        didCommit = await state.commit(mode, "feat: nothing here");
      });

      expect(didCommit).toBe(false);
      expect(harness.getLatest().isCommitting).toBe(false);
      expect(harness.getLatest().commitError).toBe(expectedError);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
    } finally {
      await harness.unmount();
    }
  });

  // Commit all can stage content, and a commit hook can change files, before a commit fails.
  test.each(["staged", "all"] as const)(
    "clears the %s commit state and reads the changes again after a commit write failure",
    async (mode) => {
      const failure = async (): Promise<GitCommitResult> => {
        throw new Error("Commit hook exploded");
      };
      if (mode === "staged") gitCommitStagedMock.mockImplementationOnce(failure);
      else gitCommitAllMock.mockImplementationOnce(failure);
      const refreshDiffData = mock(async () => {});
      const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

      try {
        await harness.mount();

        let didCommit = true;
        await harness.run(async (state) => {
          didCommit = await state.commit(mode, "feat: broken commit");
        });

        expect(didCommit).toBe(false);
        expect(harness.getLatest().isCommitting).toBe(false);
        expect(harness.getLatest().committingMode).toBeNull();
        expect(harness.getLatest().commitError).toBe("Commit hook exploded");
        expect(refreshDiffData).toHaveBeenCalledTimes(1);
        expect(refreshDiffData).toHaveBeenCalledWith("soft");
      } finally {
        await harness.unmount();
      }
    },
  );

  test("tracks push action lifecycle and validates missing branch errors", async () => {
    const refreshDiffData = mock(async () => {});
    const pushDeferred = createDeferred<GitPushResult>();
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

      pushDeferred.resolve({
        outcome: "pushed",
        remote: "origin",
        branch: "feature/task-10",
        output: "done",
      });
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
    const rebaseDeferred = createDeferred<GitRebaseResult>();
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

      rebaseDeferred.resolve({ outcome: "rebased", output: "rebased" });
      await harness.waitFor((state) => state.isRebasing === false);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("holds the commit operation lock until the soft refresh settles", async () => {
    const refreshDeferred = createDeferred<void>();
    const refreshDiffData = mock(async (_mode?: string) => refreshDeferred.promise);
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));
    let running: Promise<boolean> | undefined;

    try {
      await harness.mount();

      await harness.run((state) => {
        running = state.commit("staged", "fix: preserve disabled state");
      });
      await harness.waitFor(() => refreshDiffData.mock.calls.length === 1);
      expect(refreshDiffData).toHaveBeenCalledWith("soft");

      // The composer stays busy until the panel shows the new commit.
      expect(harness.getLatest()).toMatchObject({ isCommitting: true, committingMode: "staged" });
      let duplicateResult = true;
      await harness.run(async (state) => {
        duplicateResult = await state.commit("staged", "fix: duplicate");
      });
      expect(duplicateResult).toBe(false);
      expect(gitCommitStagedMock).toHaveBeenCalledTimes(1);

      let didCommit = false;
      await harness.run(async () => {
        refreshDeferred.resolve();
        didCommit = (await running) ?? false;
      });
      expect(didCommit).toBe(true);
    } finally {
      refreshDeferred.resolve();
      await running;
      await harness.unmount();
    }
  });

  test("shows the Git result of a change without a panel refresh", async () => {
    const applyLocalChanges = mock(async (_changes: GitLocalChanges) => {});
    const refreshDiffData = mock(async (_mode?: string) => {});
    const harness = createHookHarness(createBaseArgs({ applyLocalChanges, refreshDiffData }));
    const intent = createIntent("stage", "unstaged");

    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(intent));
      await harness.waitFor((state) => !state.isChanging);

      expect(gitChangeSelectionMock).toHaveBeenCalledWith(createExpectedChangeRequest(intent));
      expect(applyLocalChanges.mock.calls).toEqual([[createChangeResult().localChanges]]);
      expect(refreshDiffData).not.toHaveBeenCalled();
      expect(harness.getLatest().changeError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("queues a change that starts during another and sends it with the returned snapshots", async () => {
    const first = createDeferred<GitChangeResult>();
    gitChangeSelectionMock.mockImplementationOnce(() => first.promise);
    const harness = createHookHarness(createBaseArgs({ workingDir: "/tmp/worktree/task-10" }));
    const chunk = createIntent("stage", "unstaged", {
      kind: "hunk",
      filePath: "src/main.ts",
      hunkIndex: 1,
    });
    const file = createIntent("stage", "unstaged", { kind: "file", filePath: "src/new.ts" });

    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(chunk));
      await harness.waitFor((state) => state.changingKey === gitChangeIntentKey(chunk));
      expect(gitChangeSelectionMock).toHaveBeenCalledWith(
        createExpectedChangeRequest(chunk, "/tmp/worktree/task-10"),
      );

      // A click during a change waits in the queue. Nothing blocks it.
      expect(harness.getLatest().changeDisabledReason).toBeNull();
      await harness.run((state) => state.changeSelection(file));
      expect(harness.getLatest().changeError).toBeNull();
      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingChanges).toEqual([chunk, file]);

      await harness.run(() => first.resolve(createChangeResult(7)));
      await harness.waitFor(() => gitChangeSelectionMock.mock.calls.length === 2);
      // The second change uses the snapshots of the first result, with no read between them.
      expect(gitChangeSelectionMock.mock.calls[1]?.[0].snapshots).toEqual({
        unstaged: createChangeResult(7).localChanges.unstaged.snapshot,
        staged: createChangeResult(7).localChanges.staged.snapshot,
      });
      await harness.waitFor((state) => !state.isChanging);
    } finally {
      first.resolve(createChangeResult());
      await harness.unmount();
    }
  });

  describe("chunk changes", () => {
    const MOVED_CHUNK = "This file changed after you chose the chunk. Review the chunk again.";
    const fileDiff = (file: string, diff: string) => ({
      file,
      type: "modified" as const,
      additions: 1,
      deletions: 0,
      diff,
    });
    /** Local changes whose unstaged group shows `diffs`, read at `observedAtMs`. */
    const withUnstagedDiffs = (
      diffs: ReturnType<typeof fileDiff>[],
      observedAtMs = 1,
    ): GitLocalChanges => {
      const changes =
        observedAtMs === 1 ? createLocalChanges() : createChangeResult(observedAtMs).localChanges;
      changes.unstaged.fileDiffs = diffs;
      return changes;
    };
    const chunkIntent = (action: "stage" | "discard", filePath: string, hunkIndex: number) =>
      createIntent(action, "unstaged", { kind: "hunk", filePath, hunkIndex });

    test("stops a queued chunk change after an earlier change moved the chunks of its file", async () => {
      const first = createDeferred<GitChangeResult>();
      gitChangeSelectionMock.mockImplementationOnce(() => first.promise);
      const harness = createHookHarness(
        createBaseArgs({ localChanges: withUnstagedDiffs([fileDiff("src/main.ts", "@@ shown")]) }),
      );

      try {
        await harness.mount();
        await harness.run((state) => {
          state.changeSelection(chunkIntent("stage", "src/main.ts", 0));
          state.changeSelection(chunkIntent("stage", "src/main.ts", 1));
        });
        const moved = withUnstagedDiffs([fileDiff("src/main.ts", "@@ moved")], 5);
        await harness.run(() =>
          first.resolve({ affectedPaths: ["src/main.ts"], localChanges: moved }),
        );
        await harness.waitFor((state) => !state.isChanging && state.changeError !== null);

        // Chunk 1 of the new diff is another chunk, so the second change does not run.
        expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
        expect(harness.getLatest().changeError).toBe(MOVED_CHUNK);
        expect(harness.getLatest().pendingChanges).toEqual([
          chunkIntent("stage", "src/main.ts", 0),
        ]);
      } finally {
        first.resolve(createChangeResult());
        await harness.unmount();
      }
    });

    test("runs a queued chunk change of a file that the earlier change did not move", async () => {
      const first = createDeferred<GitChangeResult>();
      gitChangeSelectionMock.mockImplementationOnce(() => first.promise);
      const other = fileDiff("src/other.ts", "@@ other");
      const harness = createHookHarness(
        createBaseArgs({
          localChanges: withUnstagedDiffs([fileDiff("src/main.ts", "@@ shown"), other]),
        }),
      );

      try {
        await harness.mount();
        await harness.run((state) => {
          state.changeSelection(chunkIntent("stage", "src/main.ts", 0));
          state.changeSelection(chunkIntent("stage", "src/other.ts", 0));
        });
        const result = withUnstagedDiffs([fileDiff("src/main.ts", "@@ moved"), other], 5);
        await harness.run(() =>
          first.resolve({ affectedPaths: ["src/main.ts"], localChanges: result }),
        );
        await harness.waitFor(() => gitChangeSelectionMock.mock.calls.length === 2);
        await harness.waitFor((state) => !state.isChanging);

        expect(gitChangeSelectionMock.mock.calls[1]?.[0].selection).toEqual({
          kind: "hunk",
          filePath: "src/other.ts",
          hunkIndex: 0,
        });
        expect(harness.getLatest().changeError).toBeNull();
      } finally {
        first.resolve(createChangeResult());
        await harness.unmount();
      }
    });

    test("does not open a chunk Discard after an earlier change moved the chunks", async () => {
      const first = createDeferred<GitChangeResult>();
      gitChangeSelectionMock.mockImplementationOnce(() => first.promise);
      const harness = createHookHarness(
        createBaseArgs({ localChanges: withUnstagedDiffs([fileDiff("src/main.ts", "@@ shown")]) }),
      );
      let discard: Promise<void> | undefined;

      try {
        await harness.mount();
        await harness.run((state) => {
          state.changeSelection(chunkIntent("stage", "src/main.ts", 0));
          discard = Promise.resolve(
            state.changeSelection(chunkIntent("discard", "src/main.ts", 1)),
          );
        });
        const moved = withUnstagedDiffs([fileDiff("src/main.ts", "@@ moved")], 5);
        await harness.run(async () => {
          first.resolve({ affectedPaths: ["src/main.ts"], localChanges: moved });
          await discard;
        });

        expect(harness.getLatest().pendingDiscard).toBeNull();
        expect(harness.getLatest().changeError).toBe(MOVED_CHUNK);
        expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
      } finally {
        first.resolve(createChangeResult());
        await harness.unmount();
      }
    });
  });

  test("keeps a change pending until the panel shows its Git result", async () => {
    const args = createBaseArgs();
    const harness = createHookHarness(args);
    const intent = createIntent("unstage", "staged", { kind: "all" });

    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(intent));
      await harness.waitFor((state) => !state.isChanging);
      // Git answered, but the shown changes are older, so the panel still shows the request.
      expect(harness.getLatest().pendingChanges).toEqual([intent]);

      await harness.update({ ...args, localChanges: createChangeResult().localChanges });
      expect(harness.getLatest().pendingChanges).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("ends the queued changes after a failed change and reads the actual state", async () => {
    const failure = "The unstaged changes moved. Refresh and try again.";
    const first = createDeferred<GitChangeResult>();
    gitChangeSelectionMock.mockImplementationOnce(() => first.promise);
    const refreshDiffData = mock(async (_mode?: string) => {});
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

    try {
      await harness.mount();
      await harness.run((state) => {
        state.changeSelection(createIntent("stage", "unstaged"));
        state.changeSelection(
          createIntent("stage", "unstaged", { kind: "file", filePath: "src/new.ts" }),
        );
      });
      await harness.run(() => first.reject(new Error(failure)));
      await harness.waitFor((state) => !state.isChanging && state.changeError !== null);

      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingChanges).toEqual([]);
      expect(harness.getLatest().changeError).toBe(failure);
      expect(toastErrorMock).toHaveBeenCalledWith("Git change failed", { description: failure });
      expect(refreshDiffData).toHaveBeenCalledWith("soft");

      // A later change runs again and clears the error.
      await harness.run((state) => state.changeSelection(createIntent("stage", "unstaged")));
      await harness.waitFor((state) => !state.isChanging);
      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(2);
      expect(harness.getLatest().changeError).toBeNull();
    } finally {
      first.resolve(createChangeResult());
      await harness.unmount();
    }
  });

  test("unstages all staged changes in the repository root at once", async () => {
    const harness = createHookHarness(createBaseArgs());
    const intent = createIntent("unstage", "staged", { kind: "all" });

    try {
      await harness.mount();

      await harness.run((state) => state.changeSelection(intent));
      await harness.waitFor((state) => !state.isChanging);

      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
      const request = gitChangeSelectionMock.mock.calls[0]?.[0];
      expect(request).toEqual(createExpectedChangeRequest(intent));
      expect(request).not.toHaveProperty("workingDir");
      expect(harness.getLatest().pendingDiscard).toBeNull();
      expect(harness.getLatest().changeError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test.each(["file", "hunk"] as const)(
    "waits for confirmation before it discards a %s and sends the reviewed snapshot",
    async (kind) => {
      const applyLocalChanges = mock(async (_changes: GitLocalChanges) => {});
      const original = createBaseArgs({ applyLocalChanges, workingDir: "/tmp/worktree/task-10" });
      const harness = createHookHarness(original);
      const selection: AgentStudioPendingDiscard["selection"] =
        kind === "file"
          ? { kind, filePath: "src/main.ts" }
          : { kind, filePath: "src/main.ts", hunkIndex: 2 };
      const intent = createIntent("discard", "unstaged", selection);

      try {
        await harness.mount();

        await harness.run((state) => state.changeSelection(intent));
        expect(harness.getLatest().pendingDiscard).toMatchObject({
          group: "unstaged",
          selection,
          isUntrackedFile: false,
        });
        expect(harness.getLatest().isChanging).toBe(false);
        expect(harness.getLatest().pendingChanges).toEqual([]);
        expect(gitChangeSelectionMock).toHaveBeenCalledTimes(0);

        // A live refresh brings new content while the confirmation is open.
        const movedChanges = createLocalChanges();
        movedChanges.unstaged.snapshot = {
          hashVersion: 1,
          statusHash: "aaaaaaaaaaaaaaaa",
          diffHash: "bbbbbbbbbbbbbbbb",
        };
        movedChanges.snapshot = { ...movedChanges.snapshot, observedAtMs: 5 };
        await harness.update({ ...original, localChanges: movedChanges });
        expect(harness.getLatest().pendingDiscard).toMatchObject({ group: "unstaged", selection });

        await harness.run((state) => state.confirmDiscard());

        expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
        expect(gitChangeSelectionMock).toHaveBeenCalledWith(
          createExpectedChangeRequest(intent, "/tmp/worktree/task-10"),
        );
        expect(applyLocalChanges).toHaveBeenCalledTimes(1);
        expect(harness.getLatest().pendingDiscard).toBeNull();
        expect(harness.getLatest().isChanging).toBe(false);
        expect(harness.getLatest().changeError).toBeNull();
        expect(toastSuccessMock).toHaveBeenCalledWith("Changes discarded", {
          description: "src/main.ts",
        });
      } finally {
        await harness.unmount();
      }
    },
  );

  test("opens a Discard confirmation after the changes before it", async () => {
    const first = createDeferred<GitChangeResult>();
    gitChangeSelectionMock.mockImplementationOnce(() => first.promise);
    const harness = createHookHarness(createBaseArgs());
    let discard: Promise<void> | undefined;

    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(createIntent("stage", "unstaged")));
      await harness.run((state) => {
        discard = Promise.resolve(
          state.changeSelection(
            createIntent("discard", "unstaged", { kind: "file", filePath: "src/new.ts" }),
          ),
        );
      });
      expect(harness.getLatest().pendingDiscard).toBeNull();

      await harness.run(async () => {
        first.resolve(createChangeResult(9));
        await discard;
      });
      await harness.waitFor((state) => state.pendingDiscard !== null);
      // The confirmation keeps the content that Git showed after the earlier change.
      await harness.run((state) => state.confirmDiscard());
      expect(gitChangeSelectionMock.mock.calls[1]?.[0].snapshots.unstaged).toEqual(
        createChangeResult(9).localChanges.unstaged.snapshot,
      );
    } finally {
      first.resolve(createChangeResult());
      await harness.unmount();
    }
  });

  test("cancels a pending discard of an untracked file without a Git call", async () => {
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

    try {
      await harness.mount();

      await harness.run((state) =>
        state.changeSelection(
          createIntent("discard", "unstaged", { kind: "file", filePath: "src/new.ts" }),
        ),
      );
      expect(harness.getLatest().pendingDiscard).toMatchObject({
        group: "unstaged",
        selection: { kind: "file", filePath: "src/new.ts" },
        isUntrackedFile: true,
      });

      await harness.run((state) => state.cancelDiscard());
      expect(harness.getLatest().pendingDiscard).toBeNull();

      await harness.run((state) => state.confirmDiscard());
      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(0);
      expect(refreshDiffData).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().changeError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test.each<[string, Partial<HookArgs>, string]>([
    [
      "no repository is selected",
      { repoPath: null },
      "Cannot change files because no repository is selected.",
    ],
    [
      "a Git conflict is unresolved",
      { detectedConflictedFiles: ["AGENTS.md"] },
      "Git actions are disabled while git conflicts are unresolved.",
    ],
    [
      "the local changes are unavailable",
      { localChanges: null },
      "The changes are unavailable. Refresh and try again.",
    ],
  ])("blocks changes while %s", async (_case, overrides, reason) => {
    const harness = createHookHarness(createBaseArgs(overrides));

    try {
      await harness.mount();
      expect(harness.getLatest().changeDisabledReason).toBe(reason);

      await harness.run((state) => state.changeSelection(createIntent("stage", "unstaged")));
      expect(harness.getLatest().changeError).toBe(reason);
      expect(harness.getLatest().isChanging).toBe(false);

      await harness.run((state) => state.changeSelection(createIntent("discard", "unstaged")));
      expect(harness.getLatest().pendingDiscard).toBeNull();
      expect(harness.getLatest().changeError).toBe(reason);
      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(0);
    } finally {
      await harness.unmount();
    }
  });

  test("reports a failed change and the failure of the read after it", async () => {
    gitChangeSelectionMock.mockImplementationOnce(async () => {
      throw new Error("Discard failed.");
    });
    const refreshDiffData = mock(async () => {
      throw new Error("Refresh broke.");
    });
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(createIntent("discard", "unstaged")));
      await harness.run((state) => state.confirmDiscard());

      expect(harness.getLatest().changeError).toBe(
        "Discard failed. The panel could not update: Refresh broke.",
      );
      expect(toastSuccessMock).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("does not show a late change failure after the session changes", async () => {
    const change = createDeferred<GitChangeResult>();
    gitChangeSelectionMock.mockImplementationOnce(() => change.promise);
    const refreshDiffData = mock(async () => {});
    const args = createBaseArgs({
      contextKey: "session-a",
      workingDir: "/repo/a",
      refreshDiffData,
    });
    const harness = createHookHarness(args);

    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(createIntent("stage", "unstaged")));
      await harness.waitFor((state) => state.isChanging);

      await harness.update({ ...args, contextKey: "session-b", workingDir: "/repo/b" });
      // Changes of the first directory leave the new view.
      expect(harness.getLatest().pendingChanges).toEqual([]);

      await harness.run(() => {
        change.reject(new Error("Session A change failed."));
      });
      await harness.waitFor((state) => !state.isChanging);

      expect(harness.getLatest().changeError).toBeNull();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(refreshDiffData).not.toHaveBeenCalled();
      expect(gitChangeSelectionMock.mock.calls[0]?.[0].workingDir).toBe("/repo/a");

      await harness.update(args);
      expect(harness.getLatest().changeError).toBeNull();
    } finally {
      change.resolve(createChangeResult());
      await harness.unmount();
    }
  });

  test("does not show a late refresh failure after the session changes", async () => {
    gitChangeSelectionMock.mockImplementationOnce(async () => {
      throw new Error("Session A discard failed.");
    });
    const refresh = createDeferred<void>();
    const refreshDiffData = mock(() => refresh.promise);
    const args = createBaseArgs({
      contextKey: "session-a",
      workingDir: "/repo/a",
      refreshDiffData,
    });
    const harness = createHookHarness(args);
    let running: Promise<void> | undefined;
    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(createIntent("discard", "unstaged")));
      await harness.run((state) => {
        running = state.confirmDiscard();
      });
      await harness.waitFor(() => refreshDiffData.mock.calls.length === 1);
      toastErrorMock.mockClear();
      await harness.update({ ...args, contextKey: "session-b", workingDir: "/repo/b" });
      await harness.run(async () => {
        refresh.reject(new Error("Session A refresh failed."));
        await running;
      });
      expect(harness.getLatest().changeError).toBeNull();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(gitChangeSelectionMock.mock.calls[0]?.[0].workingDir).toBe("/repo/a");
      expect(harness.getLatest().isChanging).toBe(false);
    } finally {
      refresh.resolve();
      await running;
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
    const pullDeferred = createDeferred<GitPullResult>();
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
    const onResolveGitConflict = mock(async () => createAgentMessageSendReceipt());
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
        operation: null,
        currentBranch: "feature/task-10",
        targetBranch: "",
        conflictedFiles: ["AGENTS.md"],
        output:
          "Git did not report the conflict operation. Restore the operation information before asking for assistance or aborting.",
        workingDir: "/tmp/worktree/task-10",
      });
      expect(harness.getLatest().isGitActionsLocked).toBe(true);
      expect(harness.getLatest().gitActionsLockReason).toBe(
        "Git actions are disabled while git conflicts are unresolved.",
      );
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(0);
      expect(harness.getLatest().gitConflictCloseNonce).toBe(0);

      let didCommit = true;
      await harness.run(async (state) => {
        didCommit = await state.commit("all", "restore lost work");
      });

      expect(didCommit).toBe(false);
      expect(gitCommitAllMock).toHaveBeenCalledTimes(0);
      expect(gitCommitStagedMock).toHaveBeenCalledTimes(0);
      expect(harness.getLatest().commitError).toBe(
        "Git actions are disabled while git conflicts are unresolved.",
      );

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(onResolveGitConflict).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  test("uses rehydrated conflict context after reload when branch is unavailable", async () => {
    const onResolveGitConflict = mock(async () => createAgentMessageSendReceipt());
    const detectedConflict = createDetectedConflict();
    const harness = createHookHarness(
      createBaseArgs({
        branch: null,
        workingDir: "/tmp/worktree/task-10",
        detectedConflict,
        detectedConflictedFiles: ["AGENTS.md"],
        onResolveGitConflict,
      }),
    );

    try {
      await harness.mount();

      expect(harness.getLatest().gitConflict).toEqual(detectedConflict);

      await harness.run(async (state) => {
        await state.askBuilderToResolveGitConflict();
      });

      expect(onResolveGitConflict).toHaveBeenCalledWith(detectedConflict, expect.any(Function));
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
        workingDir: "/repo",
      });
      expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(1);
      expect(harness.getLatest().rebaseError).toBeNull();
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      await harness.run((state) => state.abortGitConflict());
      expect(gitAbortConflictMock).toHaveBeenCalledWith("/repo", "pull_rebase", "/repo");
    } finally {
      await harness.unmount();
    }
  });

  test.each([
    [null, "/repo"],
    ["/tmp/worktree/task-10", "/tmp/worktree/task-10"],
  ] as const)(
    "captures rebase conflicts in %s and can hand them to Builder",
    async (workingDir, conflictDirectory) => {
      gitRebaseBranchMock.mockImplementationOnce(async () => ({
        outcome: "conflicts",
        conflictedFiles: ["src/main.ts", "src/lib.ts"],
        output: "CONFLICT (content): Merge conflict in src/main.ts",
      }));
      const onResolveGitConflict = mock(async () => createAgentMessageSendReceipt());
      const refreshDiffData = mock(async () => {});
      const harness = createHookHarness(
        createBaseArgs({
          refreshDiffData,
          workingDir,
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
          workingDir: conflictDirectory,
        });
        expect(harness.getLatest().gitConflictAutoOpenNonce).toBe(1);
        expect(harness.getLatest().rebaseError).toBeNull();
        expect(refreshDiffData).toHaveBeenCalledTimes(1);

        await harness.run(async (state) => {
          await state.askBuilderToResolveGitConflict();
        });

        expect(onResolveGitConflict).toHaveBeenCalledWith(
          {
            operation: "rebase",
            currentBranch: "feature/task-10",
            targetBranch: "origin/main",
            conflictedFiles: ["src/main.ts", "src/lib.ts"],
            output: "CONFLICT (content): Merge conflict in src/main.ts",
            workingDir: conflictDirectory,
          },
          expect.any(Function),
        );
        expect(harness.getLatest().gitConflict).toEqual({
          operation: "rebase",
          currentBranch: "feature/task-10",
          targetBranch: "origin/main",
          conflictedFiles: ["src/main.ts", "src/lib.ts"],
          output: "CONFLICT (content): Merge conflict in src/main.ts",
          workingDir: conflictDirectory,
        });
        if (workingDir === null) {
          await harness.run((state) => state.abortGitConflict());
          expect(gitAbortConflictMock).toHaveBeenCalledWith("/repo", "rebase", "/repo");
        }
      } finally {
        await harness.unmount();
      }
    },
  );

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
    const resolveDeferred = createDeferred<ReturnType<typeof createAgentMessageSendReceipt>>();
    const onResolveGitConflict = mock(async () => resolveDeferred.promise);
    const harness = createHookHarness(
      createBaseArgs({
        detectedConflict: {
          operation: "rebase",
          currentBranch: "feature/task-10",
          targetBranch: "origin/main",
          conflictedFiles: ["AGENTS.md"],
          output: "Conflict",
          workingDir: "/tmp/worktree/task-10",
        },
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

      resolveDeferred.resolve(createAgentMessageSendReceipt());

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

  test("discards a force push confirmation after the branch changes", async () => {
    gitPushBranchMock.mockImplementationOnce(async () => ({
      outcome: "rejected_non_fast_forward",
      remote: "origin",
      branch: "feature/task-10",
      output: "non-fast-forward",
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

      // The worktree now reports another branch.
      await harness.update(
        createBaseArgs({
          branch: "feature/task-11",
          refreshDiffData,
          workingDir: "/tmp/worktree/task-10",
        }),
      );

      await harness.run(async (state) => {
        await state.confirmForcePush();
      });

      expect(gitPushBranchMock).toHaveBeenCalledTimes(1);
      expect(harness.getLatest().pendingForcePush).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("shows a force push confirmation only in the worktree that pushed", async () => {
    const pushDeferred = createDeferred<GitPushResult>();
    gitPushBranchMock.mockImplementationOnce(async () => pushDeferred.promise);
    const firstTaskArgs = createBaseArgs({ workingDir: "/tmp/worktree/task-10" });
    const harness = createHookHarness(firstTaskArgs);

    try {
      await harness.mount();
      await harness.run((state) => {
        void state.pushBranch();
      });
      await harness.waitFor((state) => state.isPushing);

      // The user selects another task before the push finishes.
      await harness.update(
        createBaseArgs({ branch: "feature/task-11", workingDir: "/tmp/worktree/task-11" }),
      );
      pushDeferred.resolve({
        outcome: "rejected_non_fast_forward",
        remote: "origin",
        branch: "feature/task-10",
        output: "non-fast-forward",
      });
      await harness.waitFor((state) => !state.isPushing);
      expect(harness.getLatest().pendingForcePush).toBeNull();

      await harness.run(async (state) => {
        await state.confirmForcePush();
      });
      expect(gitPushBranchMock).toHaveBeenCalledTimes(1);

      await harness.update(firstTaskArgs);
      expect(harness.getLatest().pendingForcePush).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("shows a rebase conflict only in the worktree that rebased", async () => {
    const rebaseDeferred = createDeferred<GitRebaseResult>();
    gitRebaseBranchMock.mockImplementationOnce(() => rebaseDeferred.promise);
    const firstTaskArgs = createBaseArgs({ workingDir: "/tmp/worktree/task-10" });
    const harness = createHookHarness(firstTaskArgs);

    try {
      await harness.mount();
      await harness.run((state) => {
        void state.rebaseOntoTarget();
      });
      await harness.waitFor((state) => state.isRebasing);

      // The user selects another task before the rebase finishes.
      await harness.update(
        createBaseArgs({ branch: "feature/task-11", workingDir: "/tmp/worktree/task-11" }),
      );
      rebaseDeferred.resolve({
        outcome: "conflicts",
        conflictedFiles: ["src/main.ts"],
        output: "CONFLICT (content): Merge conflict in src/main.ts",
      });
      await harness.waitFor((state) => !state.isRebasing);
      expect(harness.getLatest().gitConflict).toBeNull();
      expect(harness.getLatest().isGitActionsLocked).toBe(false);

      await harness.update(firstTaskArgs);
      expect(harness.getLatest().gitConflict).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps failure state isolated when rebase fails", async () => {
    const rebaseDeferred = createDeferred<GitRebaseResult>();
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
      rebaseDeferred.resolve({ outcome: "rebased", output: "rebased" });
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

  test.each([
    ["push", "Pushed feature/task-10", "pushError"],
    ["pull", "The pull succeeded", "rebaseError"],
    ["rebase", "The rebase succeeded", "rebaseError"],
  ] as const)(
    "keeps a confirmed %s when only the panel update fails",
    async (action, confirmedResult, errorField) => {
      const refreshDiffData = mock(async () => {
        throw new Error("Local read denied");
      });
      const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

      try {
        await harness.mount();
        await harness.run(async (state) => {
          if (action === "push") await state.pushBranch();
          else if (action === "pull") await state.pullFromUpstream();
          else await state.rebaseOntoTarget();
        });

        expect(harness.getLatest()[errorField]).toBe(
          `${confirmedResult}, but the panel could not update: Local read denied Refresh to try again.`,
        );
        expect(toastErrorMock).not.toHaveBeenCalled();
      } finally {
        await harness.unmount();
      }
    },
  );

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

test.each(["repository", "directory", "branch", "target"] as const)(
  "keeps a discard confirmation from applying to a different %s",
  async (change) => {
    const original = createBaseArgs({ workingDir: "/repo/a" });
    const harness = createHookHarness(original);
    const intent = createIntent("discard", "unstaged");
    try {
      await harness.mount();
      await harness.run((state) => state.changeSelection(intent));
      expect(harness.getLatest().pendingDiscard).not.toBeNull();

      await harness.update({
        ...original,
        repoPath: change === "repository" ? "/other" : original.repoPath,
        workingDir: change === "directory" ? "/repo/b" : original.workingDir,
        branch: change === "branch" ? "other" : original.branch,
        targetBranch: change === "target" ? "origin/develop" : original.targetBranch,
      });
      expect(harness.getLatest().pendingDiscard).toBeNull();
      await harness.run((state) => state.confirmDiscard());
      expect(gitChangeSelectionMock).not.toHaveBeenCalled();

      await harness.update(original);
      expect(harness.getLatest().pendingDiscard).toBeNull();
      await harness.run((state) => state.confirmDiscard());
      expect(gitChangeSelectionMock).not.toHaveBeenCalled();

      await harness.run((state) => state.changeSelection(intent));
      await harness.run((state) => state.confirmDiscard());
      expect(gitChangeSelectionMock).toHaveBeenCalledTimes(1);
      expect(gitChangeSelectionMock).toHaveBeenCalledWith(
        createExpectedChangeRequest(intent, "/repo/a"),
      );
    } finally {
      await harness.unmount();
    }
  },
);

test.each(["repository", "directory", "branch"] as const)(
  "keeps a pull confirmation from applying to a different %s",
  async (change) => {
    const original = createBaseArgs({
      workingDir: "/repo/a",
      upstreamAheadBehind: { ahead: 2, behind: 3 },
    });
    const harness = createHookHarness(original);
    try {
      await harness.mount();
      await harness.run((state) => state.pullFromUpstream());
      await harness.update({
        ...original,
        repoPath: change === "repository" ? "/other" : original.repoPath,
        workingDir: change === "directory" ? "/repo/b" : original.workingDir,
        branch: change === "branch" ? "other" : original.branch,
      });
      expect(harness.getLatest().pendingPullRebase).toBeNull();
      await harness.run((state) => state.confirmPullRebase());
      expect(gitPullBranchMock).not.toHaveBeenCalled();
      await harness.update(original);
      expect(harness.getLatest().pendingPullRebase).toBeNull();
      await harness.run((state) => state.pullFromUpstream());
      await harness.run((state) => state.confirmPullRebase());
      expect(gitPullBranchMock).toHaveBeenCalledWith("/repo", "/repo/a");
      expect(gitPullBranchMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  },
);

test("drops a late commit error after the directory changes", async () => {
  const completed = createDeferred<GitCommitResult>();
  gitCommitAllMock.mockImplementationOnce(() => completed.promise);
  const refreshDiffData = mock(async () => {});
  const original = createBaseArgs({ workingDir: "/repo/a", refreshDiffData });
  const harness = createHookHarness(original);
  let running: Promise<boolean> | undefined;
  try {
    await harness.mount();
    await harness.run((state) => {
      running = state.commit("all", "fix: retain error");
    });
    await harness.update({ ...original, workingDir: "/repo/b" });
    expect(harness.getLatest().isCommitting).toBe(true);
    expect(harness.getLatest().committingMode).toBe("all");
    let duplicateResult = true;
    await harness.run(async (state) => {
      duplicateResult = await state.commit("all", "duplicate");
    });
    expect(duplicateResult).toBe(false);
    expect(gitCommitAllMock).toHaveBeenCalledTimes(1);
    let didCommit = true;
    await harness.run(async () => {
      completed.reject(new Error("commit hook failed"));
      didCommit = (await running) ?? true;
    });
    expect(didCommit).toBe(false);
    expect(harness.getLatest().isCommitting).toBe(false);
    expect(harness.getLatest().commitError).toBeNull();
    expect(refreshDiffData).not.toHaveBeenCalled();
    await harness.update(original);
    expect(harness.getLatest().commitError).toBeNull();
  } finally {
    completed.resolve({ outcome: "committed", commitHash: "abc123", output: "committed" });
    await running;
    await harness.unmount();
  }
});
