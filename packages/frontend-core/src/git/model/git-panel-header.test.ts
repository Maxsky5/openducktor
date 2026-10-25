import { describe, expect, test } from "bun:test";
import type { GitFileDiff } from "@openducktor/contracts";
import type { DiffDataState } from "../contracts";
import { gitHeaderNotices, gitPanelTabCounts } from "./git-panel-header";
import { createEmptyScopeState } from "./scope-state";

const diff = (file: string): GitFileDiff => ({
  file,
  type: "modified",
  additions: 1,
  deletions: 0,
  diff: "@@ -1 +1 @@\n-a\n+b\n",
});

const diffData = (overrides: Partial<DiffDataState> = {}): DiffDataState => ({
  branch: "feature",
  worktreePath: "/repo/wt",
  targetBranch: "origin/main",
  comparisonReference: "refs/remotes/origin/main",
  scopeStatesByScope: {
    uncommitted: { ...createEmptyScopeState(), uncommittedFileCount: 3 },
    target: { ...createEmptyScopeState(), fileDiffs: [diff("src/a.ts"), diff("src/b.ts")] },
  },
  loadedScopesByScope: { uncommitted: true, target: true },
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  fileStatuses: [],
  hashVersion: null,
  statusHash: null,
  diffHash: null,
  uncommittedFileCount: 3,
  isLoading: false,
  ...overrides,
});

const noNotices = {
  detectPullRequestError: null,
  lockReason: null,
  refreshError: null,
  upstreamStatus: "tracking",
  upstreamError: null,
  comparisonPending: false,
  comparisonUnavailableReason: null,
  rebaseError: null,
  pushError: null,
} as const;

describe("gitPanelTabCounts", () => {
  test("counts the files of each loaded list", () => {
    expect(gitPanelTabCounts(diffData())).toEqual({ uncommitted: 3, target: 2 });
  });

  test("shows no count before a list loads or without a comparison branch", () => {
    expect(
      gitPanelTabCounts(diffData({ loadedScopesByScope: { uncommitted: false, target: true } })),
    ).toEqual({ uncommitted: null, target: 2 });
    expect(gitPanelTabCounts(diffData({ comparisonReference: null }))).toEqual({
      uncommitted: 3,
      target: null,
    });
  });
});

describe("gitHeaderNotices", () => {
  test("lists the notices in display order", () => {
    expect(
      gitHeaderNotices({
        detectPullRequestError: "Push the branch first.",
        lockReason: "Resolve the conflict first.",
        refreshError: "Host offline.",
        upstreamStatus: "error",
        upstreamError: "No remote.",
        comparisonPending: false,
        comparisonUnavailableReason: "Fetch origin/main first.",
        rebaseError: "Rebase failed.",
        pushError: "Push failed.",
      }),
    ).toEqual([
      { key: "detect-pr", tone: "error", text: "Push the branch first." },
      { key: "lock", tone: "warning", text: "Resolve the conflict first." },
      { key: "refresh", tone: "error", text: "Refresh failed: Host offline." },
      { key: "upstream", tone: "error", text: "Upstream status is unavailable. No remote." },
      { key: "comparison", tone: "muted", text: "Fetch origin/main first." },
      { key: "rebase", tone: "error", text: "Rebase failed." },
      { key: "push", tone: "error", text: "Push failed." },
    ]);
    expect(gitHeaderNotices(noNotices)).toEqual([]);
  });

  test("shows the upstream failure only for an upstream read error", () => {
    expect(gitHeaderNotices({ ...noNotices, upstreamError: "No remote." })).toEqual([]);
    expect(gitHeaderNotices({ ...noNotices, upstreamStatus: "error" })).toEqual([
      { key: "upstream", tone: "error", text: "Upstream status is unavailable." },
    ]);
  });

  test("waits for a pending comparison read before it reports a missing comparison branch", () => {
    expect(
      gitHeaderNotices({
        ...noNotices,
        comparisonPending: true,
        comparisonUnavailableReason: "Fetch origin/main first.",
      }),
    ).toEqual([]);
  });
});
