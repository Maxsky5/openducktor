import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus, GitWorktreeStatusSummary } from "@openducktor/contracts";
import {
  createBaseArgs,
  createHookHarness,
  dispatchDiffRefresh,
  gitGetWorktreeStatusMock,
  gitGetWorktreeStatusSummaryMock,
  setupAgentStudioDiffDataTestHarness,
  toWorktreeStatusSummary,
  withSnapshotHashes,
} from "./use-agent-studio-diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

describe("useAgentStudioDiffData", () => {
  test("visibility refresh persists hash metadata changes even when derived shared fields stay equal", async () => {
    const originalDateNow = Date.now;
    let nowMs = 1_731_000_000_000;

    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 1,
                      deletions: 0,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [
            { path: "src/a.ts", status: "M", staged: false },
            { path: "src/b.ts", status: "A", staged: true },
            { path: "src/c.ts", status: "D", staged: false },
            { path: "src/d.ts", status: "M", staged: false },
          ],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
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
      ): Promise<GitWorktreeStatusSummary> => {
        const status = withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000000,
          },
        });

        return toWorktreeStatusSummary(status);
      },
    );

    Date.now = () => nowMs;

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      const firstState = harness.getLatest();
      expect(firstState.upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      const secondState = harness.getLatest();
      expect(secondState.upstreamAheadBehind).toEqual({ ahead: 1, behind: 0 });
      expect(secondState).not.toBe(firstState);

      nowMs += 6_000;
      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 2);
      const thirdState = harness.getLatest();
      expect(thirdState).toEqual(secondState);
    } finally {
      await harness.unmount();
      Date.now = originalDateNow;
    }
  });

  test("visibility refresh updates uncommitted file count from summary payloads", async () => {
    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 1,
                      deletions: 0,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [
            { path: "src/a.ts", status: "M", staged: false },
            { path: "src/b.ts", status: "A", staged: true },
            { path: "src/c.ts", status: "D", staged: false },
            { path: "src/d.ts", status: "M", staged: false },
          ],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
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
      ): Promise<GitWorktreeStatusSummary> => {
        const status = withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [
            { path: "src/a.ts", status: "M", staged: false },
            { path: "src/b.ts", status: "A", staged: true },
            { path: "src/c.ts", status: "D", staged: false },
            { path: "src/d.ts", status: "M", staged: false },
          ],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "src/main.ts",
                    type: "modified",
                    additions: 1,
                    deletions: 0,
                    diff: "@@ -1 +1 @@",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000000,
          },
        });

        return toWorktreeStatusSummary(status);
      },
    );

    const harness = createHookHarness({
      ...createBaseArgs(),
      enablePolling: true,
    });

    try {
      await harness.mount();
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 1);
      expect(harness.getLatest().uncommittedFileCount).toBe(1);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      await harness.waitFor((state) => state.uncommittedFileCount === 4);
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh triggers a full reload when summary hashes show file status changes", async () => {
    let fullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        fullRequestCount += 1;

        if (fullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/conflict", detached: false },
            fileStatuses: [{ path: "AGENTS.md", status: "unmerged", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "AGENTS.md",
                      type: "modified",
                      additions: 3,
                      deletions: 1,
                      diff: "@@ -1 +1 @@",
                    },
                  ]
                : [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/resolved", detached: false },
          fileStatuses: [{ path: "AGENTS.md", status: "M", staged: false }],
          fileDiffs:
            (diffScope ?? "target") === "target"
              ? [
                  {
                    file: "AGENTS.md",
                    type: "modified",
                    additions: 5,
                    deletions: 2,
                    diff: "@@ -1 +1 @@\n-old\n+new\n",
                  },
                ]
              : [],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
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
            currentBranch: { name: "feature/resolved", detached: false },
            fileStatuses: [{ path: "AGENTS.md", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "AGENTS.md",
                      type: "modified",
                      additions: 5,
                      deletions: 2,
                      diff: "@@ -1 +1 @@\n-old\n+new\n",
                    },
                  ]
                : [],
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
      expect(harness.getLatest().fileStatuses).toEqual([
        { path: "AGENTS.md", status: "unmerged", staged: false },
      ]);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);

      expect(harness.getLatest().fileStatuses).toEqual([
        { path: "AGENTS.md", status: "M", staged: false },
      ]);
      expect(harness.getLatest().branch).toBe("feature/resolved");
    } finally {
      await harness.unmount();
    }
  });

  test("visibility refresh triggers a full reload when non-conflict summary hashes change", async () => {
    let targetFullRequestCount = 0;
    gitGetWorktreeStatusMock.mockImplementation(
      async (
        _repoPath: string,
        targetBranch: string,
        diffScope?: "target" | "uncommitted",
        workingDir?: string,
      ): Promise<GitWorktreeStatus> => {
        if ((diffScope ?? "target") !== "target") {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs: [],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        targetFullRequestCount += 1;

        if (targetFullRequestCount === 1) {
          return withSnapshotHashes({
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs: [
              {
                file: "src/main.ts",
                type: "modified",
                additions: 1,
                deletions: 1,
                diff: "@@ -1 +1 @@\n-old\n+draft\n",
              },
            ],
            targetAheadBehind: { ahead: 1, behind: 0 },
            upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
            snapshot: {
              effectiveWorkingDir: workingDir ?? "/repo",
              targetBranch,
              diffScope: diffScope ?? "target",
              observedAtMs: 1731000000000,
            },
          });
        }

        return withSnapshotHashes({
          currentBranch: { name: "feature/task-10", detached: false },
          fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
          fileDiffs: [
            {
              file: "src/main.ts",
              type: "modified",
              additions: 3,
              deletions: 1,
              diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n",
            },
          ],
          targetAheadBehind: { ahead: 1, behind: 0 },
          upstreamAheadBehind: { outcome: "tracking", ahead: 1, behind: 0 },
          snapshot: {
            effectiveWorkingDir: workingDir ?? "/repo",
            targetBranch,
            diffScope: diffScope ?? "target",
            observedAtMs: 1731000000100,
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
            currentBranch: { name: "feature/task-10", detached: false },
            fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
            fileDiffs:
              (diffScope ?? "target") === "target"
                ? [
                    {
                      file: "src/main.ts",
                      type: "modified",
                      additions: 3,
                      deletions: 1,
                      diff: "@@ -1 +1,2 @@\n-old\n+new\n+line\n",
                    },
                  ]
                : [],
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
        state.setDiffScope("target");
      });
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 2);
      expect(harness.getLatest().fileDiffs[0]?.additions).toBe(1);

      await harness.run(() => {
        dispatchDiffRefresh();
      });
      await harness.waitFor(() => gitGetWorktreeStatusSummaryMock.mock.calls.length >= 1);
      await harness.waitFor(() => gitGetWorktreeStatusMock.mock.calls.length >= 3);

      expect(harness.getLatest().fileDiffs[0]).toMatchObject({
        file: "src/main.ts",
        additions: 3,
      });
    } finally {
      await harness.unmount();
    }
  });
});
