import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeferred,
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";

enableReactActEnvironment();

const gitCommitAllMock = mock(async () => ({ outcome: "committed", commitHash: "abc123" }));
const gitPushBranchMock = mock(async () => ({ pushed: true }));
const gitRebaseBranchMock = mock(async () => ({ outcome: "rebased" }));

mock.module("@/state/operations/host", () => ({
  host: {
    gitCommitAll: gitCommitAllMock,
    gitPushBranch: gitPushBranchMock,
    gitRebaseBranch: gitRebaseBranchMock,
  },
}));

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
  refreshDiffData: async () => {},
  ...overrides,
});

beforeAll(async () => {
  ({ useAgentStudioGitActions } = await import("./use-agent-studio-git-actions"));
});

beforeEach(() => {
  gitCommitAllMock.mockClear();
  gitPushBranchMock.mockClear();
  gitRebaseBranchMock.mockClear();
  gitCommitAllMock.mockImplementation(async () => ({ outcome: "committed", commitHash: "abc123" }));
  gitPushBranchMock.mockImplementation(async () => ({ pushed: true }));
  gitRebaseBranchMock.mockImplementation(async () => ({ outcome: "rebased" }));
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

      await harness.run((state) => state.commitAll("   "));
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
      expect(harness.getLatest().commitError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("tracks push action lifecycle and validates missing branch errors", async () => {
    const refreshDiffData = mock(async () => {});
    const pushDeferred = createDeferred<{ pushed: boolean }>();
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

      pushDeferred.resolve({ pushed: true });
      await pushHarness.waitFor((state) => state.isPushing === false);
      expect(refreshDiffData).toHaveBeenCalledTimes(1);
      expect(pushHarness.getLatest().pushError).toBeNull();
    } finally {
      await pushHarness.unmount();
    }
  });

  test("tracks rebase action transition and clears error boundaries", async () => {
    const rebaseDeferred = createDeferred<{ outcome: string }>();
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

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
      expect(harness.getLatest().rebaseError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("keeps failure state isolated when rebase fails", async () => {
    const rebaseDeferred = createDeferred<{ outcome: string }>();
    gitRebaseBranchMock.mockImplementationOnce(() => rebaseDeferred.promise);
    const refreshDiffData = mock(async () => {});
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

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
    const harness = createHookHarness(createBaseArgs({ refreshDiffData }));

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

      expect(gitPushBranchMock).toHaveBeenCalledWith("/repo", "feature/task-10");
      expect(refreshDiffData).toHaveBeenCalledTimes(1);

      const state = harness.getLatest();
      expect(state.rebaseError).toBeNull();
      expect(state.pushError).toBeNull();
      expect(state.commitError).toBeNull();
    } finally {
      await harness.unmount();
    }
  });
});
