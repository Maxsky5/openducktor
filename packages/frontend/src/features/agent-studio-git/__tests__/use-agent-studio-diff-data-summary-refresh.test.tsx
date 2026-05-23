import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus, GitWorktreeStatusSummary } from "@openducktor/contracts";
import {
  createBaseArgs,
  createDeferred,
  createHookHarness,
  dispatchDiffRefresh,
  gitGetWorktreeStatusMock,
  gitGetWorktreeStatusSummaryMock,
  setupAgentStudioDiffDataTestHarness,
  toWorktreeStatusSummary,
  withSnapshotHashes,
} from "../test-support/diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

describe("useAgentStudioDiffData", () => {
  test("refresh syncs shared branch/upstream fields for cached inactive scope", async () => {
    const harness = createHookHarness(createBaseArgs());

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/task-11", detached: false },
            fileStatuses: [{ path: "src/updated.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/updated.ts",
                      type: "modified",
                      additions: 4,
                      deletions: 1,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 2, behind: 1 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 5, behind: 2 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000001,
            },
          }),
      );

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor((state) => state.branch === "feature/task-11");
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor((state) => state.diffScope === "uncommitted");

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);
      expect(harness.getLatest().branch).toBe("feature/task-11");
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 5, behind: 2 });
      expect(harness.getLatest().fileDiffs).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  test("refresh syncs upstream status changes across cached inactive scope", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      defaultTargetBranch: { branch: "@{upstream}" },
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().upstreamStatus).toBe("tracking");

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(harness.getLatest().upstreamStatus).toBe("tracking");
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? []
                : [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 1,
                      deletions: 0,
                      diff: "@@ -1 +1 @@",
                    },
                  ],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000001,
            },
          }),
      );

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor((state) => state.upstreamStatus === "untracked");
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor((state) => state.diffScope === "uncommitted");

      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(3);
      expect(harness.getLatest().upstreamStatus).toBe("untracked");
      expect(harness.getLatest().upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh invalidates the inactive scope so switching scopes triggers a fresh full reload", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.diffScope === "target");

      gitGetWorktreeStatusMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatus> =>
          withSnapshotHashes({
            currentBranch: { name: "feature/task-11", detached: false },
            fileStatuses: [{ path: "src/updated.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/updated.ts",
                      type: "modified",
                      additions: 4,
                      deletions: 1,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [
                    {
                      file: "src/worktree.ts",
                      type: "modified",
                      additions: 2,
                      deletions: 0,
                      diff: "@@ -1 +1,2 @@",
                    },
                  ],
            targetAheadBehind: { ahead: 2, behind: 1 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 5, behind: 2 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000001,
            },
          }),
      );
      gitGetWorktreeStatusSummaryMock.mockImplementation(
        async (
          _repoPath: string,
          targetBranch: string,
          diffScope?: "target" | "uncommitted",
          workingDir?: string,
        ): Promise<GitWorktreeStatusSummary> =>
          toWorktreeStatusSummary(
            withSnapshotHashes({
              currentBranch: { name: "feature/task-11", detached: false },
              fileStatuses: [{ path: "src/updated.ts", status: "M", staged: false }],
              fileDiffs:
                (diffScope ?? "target") === "target"
                  ? [
                      {
                        file: "src/updated.ts",
                        type: "modified",
                        additions: 4,
                        deletions: 1,
                        diff: "@@ -1 +1 @@",
                      },
                    ]
                  : [
                      {
                        file: "src/worktree.ts",
                        type: "modified",
                        additions: 2,
                        deletions: 0,
                        diff: "@@ -1 +1,2 @@",
                      },
                    ],
              targetAheadBehind: { ahead: 2, behind: 1 },
              upstreamAheadBehind: { outcome: "tracking", ahead: 5, behind: 2 },
              snapshot: {
                effectiveWorkingDir: workingDir ?? "/repo",
                targetBranch,
                diffScope: diffScope ?? "target",
                observedAtMs: 1731000000001,
              },
            }),
          ),
      );

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(harness.getLatest().branch).toBe("feature/task-11");

      await harness.run((state) => {
        state.setDiffScope("uncommitted");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 4);
      await harness.waitFor((state) => state.diffScope === "uncommitted");

      expect(harness.getLatest().fileDiffs).toEqual([
        {
          file: "src/worktree.ts",
          type: "modified",
          additions: 2,
          deletions: 0,
          diff: "@@ -1 +1,2 @@",
        },
      ]);
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh requests a summary for the active scope", async () => {
    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      expect(gitGetWorktreeStatusSummaryMock).toHaveBeenNthCalledWith(
        1,
        "/repo",
        "origin/main",
        "uncommitted",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(1);

      await harness.run((state) => {
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      expect(gitGetWorktreeStatusSummaryMock).toHaveBeenNthCalledWith(
        2,
        "/repo",
        "origin/main",
        "target",
        undefined,
      );
      expect(gitGetWorktreeStatusMock.mock.calls.length).toBe(2);
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh summary requests do not invalidate an in-flight full reload", async () => {
    const pendingFullReload = createDeferred<GitWorktreeStatus>();
    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 2) {
          return pendingFullReload.promise.then((snapshot) => ({
            ...snapshot,
            snapshot: {
              ...snapshot.snapshot,
              targetBranch,
              diffScope: diffScope ?? snapshot.snapshot.diffScope,
              effectiveWorkingDir: workingDir ?? snapshot.snapshot.effectiveWorkingDir,
            },
          }));
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/base", detached: false },
          fileStatuses: [{ path: "src/base.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/base.ts",
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ],
          targetAheadBehind: { ahead: 0, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000000,
          },
        });
      },
    );
    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatusSummary> =>
        toWorktreeStatusSummary(
          withSnapshotHashes({
            currentBranch: { name: "feature/summary", detached: false },
            fileStatuses: [{ path: "src/summary.ts", status: "M", staged: false }],
            fileDiffs: [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000100,
            },
          }),
        ),
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);

      await harness.run((state) => {
        state.refresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.run(async () => {
        await Promise.resolve();
      });
      expect(gitGetWorktreeStatusSummaryMock.mock.calls.length).toBe(0);
      expect(harness.getLatest().branch).toBe("feature/base");

      pendingFullReload.resolve(
        withSnapshotHashes({
          currentBranch: { name: "feature/full", detached: false },
          fileStatuses: [{ path: "src/full.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/full.ts",
              type: "modified",
              additions: 5,
              deletions: 1,
              diff: "@@ -1 +1 @@\n-old\n+new\n",
            },
          ],
          targetAheadBehind: { ahead: 2, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 2, behind: 0 },
          snapshot: {
            effectiveWorkingDir: "/repo",
            targetBranch: "origin/main",
            diffScope: "target",
            observedAtMs: 1731000000200,
          },
        }),
      );

      await harness.waitFor((state) => state.branch === "feature/full");
      expect(harness.getLatest().fileDiffs[0]?.file).toBe("src/full.ts");

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);
      expect(harness.getLatest().branch).toBe("feature/base");
    } finally {
      await harness.unmount();
    }
  });
});
