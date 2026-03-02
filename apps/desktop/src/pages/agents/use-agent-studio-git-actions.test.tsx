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
