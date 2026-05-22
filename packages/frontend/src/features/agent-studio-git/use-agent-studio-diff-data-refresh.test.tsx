import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createBaseArgs,
  createDeferred,
  createHookHarness,
  dispatchScheduledRefresh,
  gitFetchRemoteMock,
  gitGetWorktreeStatusMock,
  gitGetWorktreeStatusSummaryMock,
  setupAgentStudioDiffDataTestHarness,
  withSnapshotHashes,
} from "./use-agent-studio-diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

describe("useAgentStudioDiffData", () => {
  test("manual refresh fetches remote before reloading the active scope", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run(async (state) => {
        await state.refresh();
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitFetchRemoteMock).toHaveBeenNthCalledWith(1, "/repo", "origin/main", undefined);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(gitFetchRemoteMock.mock.invocationCallOrder[0]).toBeLessThan(
        gitGetWorktreeStatusMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("manual refresh surfaces fetch failures and does not reload status", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockRejectedValueOnce(new Error("Cannot resolve safe remote for refresh"));

      await harness.run(async (state) => {
        await state.refresh();
      });

      await harness.waitFor(
        (state) => state.error === "Error: Cannot resolve safe remote for refresh",
      );
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);
    } finally {
      await harness.unmount();
    }
  });

  test("manual refresh still reloads local status when fetch is skipped for no remote", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockResolvedValueOnce({
        outcome: "skipped_no_remote",
        output:
          "Skipped git fetch because no applicable remote is configured for this repo or branch.",
      });

      await harness.run((state) => {
        state.refresh();
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(harness.getLatest().error).toBeNull();
    } finally {
      await harness.unmount();
    }
  });

  test("soft refresh reloads local status without fetching remote", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh("soft");
      });

      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(0);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
    } finally {
      await harness.unmount();
    }
  });

  test("refresh returns a promise that settles after the queued soft reload finishes", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      const deferredRefresh = createDeferred<GitWorktreeStatus>();
      gitGetWorktreeStatusMock.mockImplementationOnce(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          deferredRefresh.promise.then((snapshot) => ({
            ...snapshot,
            snapshot: {
              ...snapshot.snapshot,
              targetBranch,
              diffScope: diffScope ?? snapshot.snapshot.diffScope,
              effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
            },
          })),
      );

      let didSettle = false;
      let refreshPromise: Promise<void> | null = null;
      await harness.run((state) => {
        refreshPromise = state.refresh("soft");
        void refreshPromise.then(() => {
          didSettle = true;
        });
      });

      expect(harness.getLatest().isLoading).toBe(true);
      expect(didSettle).toBe(false);

      if (!refreshPromise) {
        throw new Error("Expected refresh promise");
      }

      await harness.run(async () => {
        deferredRefresh.resolve(
          withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/after-refresh.ts", status: "M", staged: false }],
            fileDiffs: [],
            targetAheadBehind: { ahead: 0, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: "/repo",
              targetBranch: "origin/main",
              diffScope: "uncommitted",
              observedAtMs: 1731000001111,
            },
          }),
        );

        await refreshPromise;
      });
      await harness.waitFor((state) => !state.isLoading);
      expect(didSettle).toBe(true);
      expect(harness.getLatest().fileStatuses[0]?.path).toBe("src/after-refresh.ts");
    } finally {
      await harness.unmount();
    }
  });

  test("scheduled refresh fetches at most once within the cooldown window", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      nowMs += 5 * 60 * 1000 + 1;
      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitFetchRemoteMock.mock.calls.length >= 2);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
      await harness.unmount();
    }
  });

  test("manual refresh bypasses the scheduled refresh cooldown", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      nowMs += 60_000;
      Date.now = () => nowMs;
      await harness.run((state) => {
        state.refresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalDateNow;
      await harness.unmount();
    }
  });

  test("scheduled refresh updates the cooldown when fetch is skipped for no remote", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockResolvedValueOnce({
        outcome: "skipped_no_remote",
        output:
          "Skipped git fetch because no applicable remote is configured for this repo or branch.",
      });

      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);

      nowMs += 60_000;
      Date.now = () => nowMs;
      await harness.run(() => {
        dispatchScheduledRefresh();
      });
      Date.now = originalDateNow;
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitFetchRemoteMock).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = originalDateNow;
      await harness.unmount();
    }
  });

  test("successful non-refresh loads clear a stale refresh error", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      gitFetchRemoteMock.mockRejectedValueOnce(new Error("Cannot resolve safe remote for refresh"));

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor(
        (state) => state.error === "Error: Cannot resolve safe remote for refresh",
      );

      await harness.run((state) => {
        state.setDiffScope("target");
      });

      await harness.waitFor((state) => state.diffScope === "target");
      await harness.waitFor((state) => state.error === null);
    } finally {
      await harness.unmount();
    }
  });
});
