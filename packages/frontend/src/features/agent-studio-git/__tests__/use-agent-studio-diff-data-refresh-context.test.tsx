import { expect, test } from "bun:test";
import type { GitWorktreeStatus } from "@openducktor/contracts";
import {
  createBaseArgs,
  createDeferred,
  createHookHarness,
  gitGetWorktreeStatusMock,
  gitGetWorktreeStatusSummaryMock,
  setupAgentStudioDiffDataTestHarness,
  toWorktreeStatusSummary,
  withSnapshotHashes,
} from "../test-support/diff-data-test-harness";

setupAgentStudioDiffDataTestHarness();

function status(branch: string, target: string, scope: "target" | "uncommitted", ahead: number) {
  return withSnapshotHashes({
    currentBranch: { name: branch, detached: false },
    fileStatuses: [],
    fileDiffs:
      scope === "target"
        ? [
            {
              file: `${branch}.txt`,
              type: "modified",
              additions: 1,
              deletions: 0,
              diff: "@@ -1 +1 @@",
            },
          ]
        : [],
    targetAheadBehind: { ahead, behind: 0 },
    upstreamAheadBehind: { outcome: "tracking", ahead: 0, behind: 0 },
    snapshot: {
      effectiveWorkingDir: "/repo",
      targetBranch: target,
      diffScope: scope,
      observedAtMs: 1,
    },
  });
}

test.each(["inactive refresh", "summary reload"] as const)(
  "does not reuse a pending %s after a branch change with the same directory and target",
  async (source) => {
    const pending = createDeferred<GitWorktreeStatus>();
    let branch = "branch-a";
    let targetCalls = 0;
    const pendingCall = source === "summary reload" ? 2 : 1;
    gitGetWorktreeStatusMock.mockImplementation(async (_repo, target, scope = "uncommitted") => {
      if (scope === "target" && ++targetCalls === pendingCall) return pending.promise;
      return status(branch, target, scope, branch === "branch-a" ? 3 : 1);
    });
    gitGetWorktreeStatusSummaryMock.mockImplementation(
      async (_repo, target, scope = "uncommitted") =>
        toWorktreeStatusSummary(status(branch, target, scope, 9)),
    );
    const args = {
      ...createBaseArgs(),
      comparisonReference: "refs/heads/main",
      branchIdentityKey: branch,
    };
    const harness = createHookHarness(args);
    let firstRefresh: Promise<void> | undefined;
    let nextRefresh: Promise<void> | undefined;
    try {
      await harness.mount();
      await harness.waitFor((state) => state.loadedScopesByScope.uncommitted);
      if (source === "summary reload") {
        await harness.run((state) => state.refreshInactiveScope());
        await harness.run((state) => state.setDiffScope("target"));
        await harness.run((state) => state.refresh("scheduled"));
      } else {
        await harness.run((state) => {
          firstRefresh = state.refreshInactiveScope();
        });
      }
      await harness.waitFor(() => targetCalls === pendingCall);
      branch = "branch-b";
      await harness.update({ ...args, branchIdentityKey: branch });
      await harness.waitFor((state) => state.branch === "branch-b");
      expect(harness.getLatest().scopeStatesByScope.target.fileDiffs).toEqual([]);
      await harness.run((state) => {
        nextRefresh = state.refreshInactiveScope();
      });
      await harness.run(async () => {
        pending.resolve(status("branch-a", "refs/heads/main", "target", 9));
        await firstRefresh;
        await nextRefresh;
      });
      await harness.waitFor((state) => state.loadedScopesByScope.target);
      const current = harness.getLatest();
      expect(current.branch).toBe("branch-b");
      expect(current.scopeStatesByScope.target.fileDiffs.map((diff) => diff.file)).toEqual([
        "branch-b.txt",
      ]);
      expect(current.scopeStatesByScope.target.commitsAheadBehind).toEqual({ ahead: 1, behind: 0 });
      expect(targetCalls).toBe(pendingCall + 1);
    } finally {
      pending.resolve(status("branch-a", "refs/heads/main", "target", 9));
      await harness.unmount();
    }
  },
);
