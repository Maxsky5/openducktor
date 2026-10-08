import { describe, expect, test } from "bun:test";
import type { ScopeSnapshot, ScopeSummaryFields } from "./diff-data-model";
import {
  applyFullSnapshot,
  applyScopeError,
  applySummarySnapshot,
  createInitialDiffBatchState,
  getSummaryReloadDecision,
  toStatusSnapshotKey,
} from "./diff-data-model";

const createScopeSnapshot = (overrides: Partial<ScopeSnapshot> = {}): ScopeSnapshot => ({
  branch: "feature/task-10",
  fileDiffs: [
    {
      file: "src/main.ts",
      type: "modified",
      additions: 1,
      deletions: 0,
      diff: "@@ -1 +1 @@",
    },
  ],
  fileStatuses: [{ path: "src/main.ts", status: "M", staged: false }],
  uncommittedFileCount: 1,
  commitsAheadBehind: { ahead: 0, behind: 0 },
  upstreamAheadBehind: { ahead: 1, behind: 0 },
  upstreamStatus: "tracking",
  upstreamError: null,
  error: null,
  hashVersion: 1,
  statusHash: "status-1",
  diffHash: "diff-1",
  ...overrides,
});

const createScopeSummaryFields = (
  overrides: Partial<ScopeSummaryFields> = {},
): ScopeSummaryFields => ({
  branch: "feature/task-10",
  uncommittedFileCount: 1,
  commitsAheadBehind: { ahead: 0, behind: 0 },
  upstreamAheadBehind: { ahead: 1, behind: 0 },
  upstreamStatus: "tracking",
  upstreamError: null,
  error: null,
  hashVersion: 1,
  statusHash: "status-1",
  diffHash: "diff-1",
  ...overrides,
});

describe("diff-data-model", () => {
  test.each(["full", "summary"] as const)(
    "shares upstream errors from a %s read without clearing a failed diff scope",
    (mode) => {
      const upstreamError = "Upstream status unavailable: failed to read upstream.";
      const args = {
        state: applyScopeError({
          state: createInitialDiffBatchState(),
          scope: "target",
          mode: "full",
          error: "Could not read target diff.",
        }),
        scope: "uncommitted" as const,
        requestSequence: 1,
        latestSharedSequence: 0,
      };
      const failedUpstream = { upstreamStatus: "error" as const, upstreamError };
      const loaded =
        mode === "full"
          ? applyFullSnapshot({ ...args, snapshot: createScopeSnapshot(failedUpstream) })
          : applySummarySnapshot({
              ...args,
              summaryFields: createScopeSummaryFields(failedUpstream),
            });
      expect(loaded.nextState.byScope.target.upstreamError).toBe(upstreamError);
      expect(loaded.nextState.byScope.uncommitted.upstreamError).toBe(upstreamError);
      expect(loaded.nextState.byScope.target.error).toBe("Could not read target diff.");
      expect(loaded.nextState.byScope.uncommitted.error).toBeNull();

      const recoveredUncommitted = applyFullSnapshot({
        ...args,
        state: loaded.nextState,
        snapshot: createScopeSnapshot(),
        requestSequence: 2,
        latestSharedSequence: loaded.nextLatestSharedSequence,
      });
      expect(recoveredUncommitted.nextState.byScope.uncommitted.error).toBeNull();
      expect(recoveredUncommitted.nextState.byScope.target.upstreamError).toBeNull();
      expect(recoveredUncommitted.nextState.byScope.target.error).toBe(
        "Could not read target diff.",
      );

      const recoveredTarget = applyFullSnapshot({
        ...args,
        state: recoveredUncommitted.nextState,
        scope: "target",
        snapshot: createScopeSnapshot(),
        requestSequence: 3,
        latestSharedSequence: recoveredUncommitted.nextLatestSharedSequence,
      });
      expect(recoveredTarget.nextState.byScope.target.error).toBeNull();
    },
  );

  test("does not request a full reload when the active scope is not loaded", () => {
    const state = createInitialDiffBatchState();
    state.byScope.target = createScopeSnapshot();

    const decision = getSummaryReloadDecision(
      state,
      "target",
      createScopeSummaryFields({ diffHash: "diff-2" }),
    );

    expect(decision.sharedHashesChanged).toBe(false);
    expect(decision.scopeHashesChanged).toBe(true);
    expect(decision.shouldReloadFullScope).toBe(false);
  });

  test("requests a full reload when the loaded active scope hash changes", () => {
    const state = createInitialDiffBatchState();
    state.byScope.target = createScopeSnapshot();
    state.loadedByScope.target = true;

    const decision = getSummaryReloadDecision(
      state,
      "target",
      createScopeSummaryFields({ statusHash: "status-2" }),
    );

    expect(decision.sharedHashesChanged).toBe(true);
    expect(decision.scopeHashesChanged).toBe(true);
    expect(decision.shouldReloadFullScope).toBe(true);
  });

  test("does not invalidate the inactive scope when only the active scope diff hash changes", () => {
    const state = createInitialDiffBatchState();
    state.byScope.target = createScopeSnapshot();
    state.byScope.uncommitted = createScopeSnapshot({
      fileDiffs: [
        {
          file: "src/worktree.ts",
          type: "modified",
          additions: 2,
          deletions: 0,
          diff: "@@ -1 +1,2 @@",
        },
      ],
      diffHash: "worktree-diff-1",
    });
    state.loadedByScope.target = true;
    state.loadedByScope.uncommitted = true;

    const { nextState, shouldReloadFullScope } = applySummarySnapshot({
      state,
      scope: "target",
      summaryFields: createScopeSummaryFields({
        diffHash: "diff-2",
      }),
      requestSequence: 2,
      latestSharedSequence: 1,
    });

    expect(shouldReloadFullScope).toBe(true);
    expect(nextState.loadedByScope.uncommitted).toBe(true);
    expect(nextState.byScope.uncommitted.fileDiffs).toEqual([
      {
        file: "src/worktree.ts",
        type: "modified",
        additions: 2,
        deletions: 0,
        diff: "@@ -1 +1,2 @@",
      },
    ]);
  });

  test("invalidates the inactive scope cache when summary hashes change", () => {
    const state = createInitialDiffBatchState();
    state.byScope.target = createScopeSnapshot();
    state.byScope.uncommitted = createScopeSnapshot({
      fileDiffs: [
        {
          file: "src/worktree.ts",
          type: "modified",
          additions: 2,
          deletions: 0,
          diff: "@@ -1 +1,2 @@",
        },
      ],
      diffHash: "worktree-diff-1",
    });
    state.loadedByScope.target = true;
    state.loadedByScope.uncommitted = true;

    const { nextState, shouldReloadFullScope } = applySummarySnapshot({
      state,
      scope: "target",
      summaryFields: createScopeSummaryFields({
        branch: "feature/task-11",
        statusHash: "status-2",
        diffHash: "diff-2",
      }),
      requestSequence: 2,
      latestSharedSequence: 1,
    });

    expect(shouldReloadFullScope).toBe(true);
    expect(nextState.loadedByScope.uncommitted).toBe(false);
    expect(nextState.byScope.uncommitted.fileDiffs).toEqual([]);
    expect(nextState.byScope.uncommitted.diffHash).toBeNull();
    expect(nextState.byScope.uncommitted.branch).toBe("feature/task-11");
  });

  test("uses status hashes for compact status snapshot keys", () => {
    expect(toStatusSnapshotKey(createScopeSnapshot({ statusHash: "status-compact" }))).toBe(
      "1:status-compact",
    );
    expect(toStatusSnapshotKey(createScopeSnapshot({ hashVersion: null, statusHash: null }))).toBe(
      "src/main.ts:M:0",
    );
    expect(toStatusSnapshotKey(createScopeSnapshot({ fileStatuses: [] }))).toBe("<empty>");
  });
});
