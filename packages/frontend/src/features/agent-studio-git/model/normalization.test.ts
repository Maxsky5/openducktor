import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus, GitWorktreeStatusSummary } from "@openducktor/contracts";
import { toScopeSnapshot, toScopeSummaryFields } from "./normalization";

const createStatus = (overrides: Partial<GitWorktreeStatus> = {}): GitWorktreeStatus => ({
  currentBranch: { name: "feature/task-10", detached: false },
  fileStatuses: [
    { path: "src/main.ts", status: "M", staged: false },
    { path: "src/index.ts", status: "A", staged: true },
  ],
  fileDiffs: [
    {
      file: "src/main.ts",
      type: "modified",
      additions: 2,
      deletions: 1,
      diff: "@@ -1 +1,2 @@",
    },
  ],
  targetAheadBehind: { ahead: 1, behind: 0 },
  upstreamAheadBehind: { outcome: "tracking", ahead: 3, behind: 1 },
  snapshot: {
    effectiveWorkingDir: "/repo/.worktrees/task-10",
    targetBranch: "origin/main",
    diffScope: "uncommitted",
    observedAtMs: 1731000000000,
    hashVersion: 1,
    statusHash: "status-1",
    diffHash: "diff-1",
  },
  ...overrides,
});

describe("diff-normalization", () => {
  test("normalizes dirty worktree snapshots without querying or scheduled refresh state", () => {
    const snapshot = toScopeSnapshot(createStatus());

    expect(snapshot).toMatchObject({
      branch: "feature/task-10",
      uncommittedFileCount: 2,
      commitsAheadBehind: { ahead: 1, behind: 0 },
      upstreamAheadBehind: { ahead: 3, behind: 1 },
      upstreamStatus: "tracking",
      hashVersion: 1,
      statusHash: "status-1",
      diffHash: "diff-1",
    });
    expect(snapshot.fileStatuses.map((fileStatus) => fileStatus.path)).toEqual([
      "src/main.ts",
      "src/index.ts",
    ]);
    expect(snapshot.fileDiffs[0]?.file).toBe("src/main.ts");
  });

  test("normalizes summary payloads without file-level diff data", () => {
    const summary: GitWorktreeStatusSummary = {
      currentBranch: { name: "feature/task-10", detached: false },
      fileStatusCounts: {
        total: 4,
        staged: 1,
        unstaged: 3,
      },
      targetAheadBehind: { ahead: 2, behind: 1 },
      upstreamAheadBehind: { outcome: "untracked", ahead: 2 },
      snapshot: {
        effectiveWorkingDir: "/repo",
        targetBranch: "origin/main",
        diffScope: "target",
        observedAtMs: 1731000000100,
        hashVersion: 1,
        statusHash: "status-2",
        diffHash: "diff-2",
      },
    };

    expect(toScopeSummaryFields(summary)).toEqual({
      branch: "feature/task-10",
      gitConflict: null,
      uncommittedFileCount: 4,
      commitsAheadBehind: { ahead: 2, behind: 1 },
      upstreamAheadBehind: { ahead: 2, behind: 0 },
      upstreamStatus: "untracked",
      error: null,
      hashVersion: 1,
      statusHash: "status-2",
      diffHash: "diff-2",
    });
  });
});
