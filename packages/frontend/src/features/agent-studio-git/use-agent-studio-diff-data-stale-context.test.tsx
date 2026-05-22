import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createBaseArgs,
  createDeferred,
  createHookHarness,
  type GitFetchRemoteMockResult,
  gitFetchRemoteMock,
  gitGetWorktreeStatusMock,
  setupAgentStudioDiffDataTestHarness,
  withSnapshotHashes,
} from "./use-agent-studio-diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

describe("useAgentStudioDiffData", () => {
  test("does not reload a new repo context when an older refresh fetch resolves", async () => {
    const pendingFetch = createDeferred<GitFetchRemoteMockResult>();

    gitFetchRemoteMock.mockImplementation(async () => pendingFetch.promise);

    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);

      await harness.update({
        ...createBaseArgs(),
        repoPath: "/repo-b",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo-b",
        "origin/main",
        "uncommitted",
        undefined,
      );

      pendingFetch.resolve({ outcome: "fetched", output: "From origin" });
      await harness.run(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("does not reload a new worktree context when an older refresh fetch resolves", async () => {
    const pendingFetch = createDeferred<GitFetchRemoteMockResult>();

    gitFetchRemoteMock.mockImplementation(async () => pendingFetch.promise);

    const harness = createHookHarness({
      ...createBaseArgs(),
      worktreePath: "/repo/.worktrees/run-1",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "uncommitted",
        "/repo/.worktrees/run-1",
      );

      await harness.run((state) => {
        state.refresh();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitFetchRemoteMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "/repo/.worktrees/run-1",
      );

      await harness.update({
        ...createBaseArgs(),
        worktreePath: "/repo/.worktrees/run-2",
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        "/repo/.worktrees/run-2",
      );

      pendingFetch.resolve({ outcome: "fetched", output: "From origin" });
      await harness.run(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
    } finally {
      await harness.unmount();
    }
  });

  test("ignores stale in-flight response after repo path is cleared", async () => {
    const pendingRequest = createDeferred<GitWorktreeStatus>();

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        return pendingRequest.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      repoPath: "/repo-a",
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.update({
        ...createBaseArgs(),
        repoPath: null,
      });
      await harness.waitFor((state) => state.branch === null && state.fileDiffs.length === 0);

      pendingRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/stale", detached: false },
          fileStatuses: [{ path: "src/stale.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/stale.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo-a",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000003000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      expect(harness.getLatest().branch).toBeNull();
      expect(harness.getLatest().fileDiffs).toEqual([]);
      expect(harness.getLatest().fileStatuses).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps newer shared fields when older response resolves from another scope", async () => {
    const targetRequest = createDeferred<GitWorktreeStatus>();
    const uncommittedRequest = createDeferred<GitWorktreeStatus>();
    const queue = [uncommittedRequest, targetRequest];

    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        const deferred = queue.shift();
        if (!deferred) {
          throw new Error("No deferred response left");
        }

        return deferred.promise.then((snapshot) => ({
          ...snapshot,
          snapshot: {
            ...snapshot.snapshot,
            targetBranch,
            diffScope: diffScope ?? snapshot.snapshot.diffScope,
            effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
          },
        }));
      },
    );

    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      targetRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/newer", detached: false },
          fileStatuses: [{ path: "src/newer.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/newer.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 2, behind: 1 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 4, behind: 1 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000004000,
          },
        }),
      );
      await harness.waitFor((state) => state.branch === "feature/newer");

      uncommittedRequest.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/older", detached: false },
          fileStatuses: [{ path: "src/older.ts", status: "M", staged: false }],
          fileDiffs: [],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "uncommitted",
            observedAtMs: 1731000003000,
          },
        }),
      );

      await harness.run(async () => {
        await Promise.resolve();
      });

      const latest = harness.getLatest();
      expect(latest.diffScope).toBe("target");
      expect(latest.branch).toBe("feature/newer");
      expect(latest.fileStatuses[0]?.path).toBe("src/newer.ts");
      expect(latest.commitsAheadBehind).toEqual({ ahead: 2, behind: 1 });
    } finally {
      await harness.unmount();
    }
  });
});
