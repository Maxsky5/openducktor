import { describe, expect, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import { toScopeSnapshot } from "./normalization";

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
  test("uses the status read's exact directory without treating its comparison branch as conflict evidence", () => {
    const result = toScopeSnapshot(
      createStatus({
        gitConflict: {
          operation: "rebase",
          currentBranch: "feature/task-10",
          targetBranch: "unrelated-comparison",
          conflictedFiles: ["src/main.ts"],
          output: "interactive rebase in progress",
        },
      }),
    );
    expect(result.gitConflict).toMatchObject({
      workingDir: "/repo/.worktrees/task-10",
      targetBranch: "",
      operation: "rebase",
      conflictedFiles: ["src/main.ts"],
    });
  });
  test("normalizes dirty worktree snapshots", () => {
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

  test.each([
    {
      // An unpublished branch keeps the count of commits that its first push sends.
      upstream: { outcome: "untracked" as const, ahead: 3 },
      expected: {
        upstreamAheadBehind: { ahead: 3, behind: 0 },
        upstreamStatus: "untracked",
        upstreamError: null,
      },
    },
    {
      upstream: { outcome: "tracking" as const, ahead: 0, behind: 4 },
      expected: {
        upstreamAheadBehind: { ahead: 0, behind: 4 },
        upstreamStatus: "tracking",
        upstreamError: null,
      },
    },
    {
      upstream: { outcome: "error" as const, message: "Upstream lookup failed." },
      expected: {
        upstreamAheadBehind: null,
        upstreamStatus: "error",
        upstreamError: "Upstream lookup failed.",
      },
    },
  ])(
    "keeps $upstream.outcome upstream counts apart from comparison counts",
    ({ upstream, expected }) => {
      const snapshot = toScopeSnapshot(createStatus({ upstreamAheadBehind: upstream }));

      expect(snapshot).toMatchObject({ ...expected, commitsAheadBehind: { ahead: 1, behind: 0 } });
    },
  );
});
