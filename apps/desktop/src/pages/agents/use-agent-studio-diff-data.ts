import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/host";
import { useAgentStudioWorktreeResolution } from "./use-agent-studio-worktree-resolution";

const POLL_INTERVAL_MS = 30_000;

// ─── Public types ──────────────────────────────────────────────────────────────

export type DiffDataState = {
  /** Current branch name (fetched via git). */
  branch: string | null;
  /** Path to the worktree directory (if separate from main repo). */
  worktreePath: string | null;
  /** Target branch for ahead/behind comparison. */
  targetBranch: string;
  diffScope: DiffScope;
  /** Commits ahead/behind the target branch. */
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  /** Changed files with diff content. */
  fileDiffs: FileDiff[];
  /** File status from `git status`. */
  fileStatuses: FileStatus[];
  /** Snapshot token for the current scope status/diff payloads. */
  statusSnapshotKey?: string | null;
  /** Total changed files from lightweight worktree polling summaries. */
  uncommittedFileCount: number;
  /** Whether data is currently loading. */
  isLoading: boolean;
  /** Last error message, if any. */
  error: string | null;
  /** Refresh all data manually. */
  refresh: () => void;
  /** Currently selected file path for single-file view. */
  selectedFile: string | null;
  /** Select a file to view its diff. */
  setSelectedFile: (path: string | null) => void;
  setDiffScope: (scope: DiffScope) => void;
};

export type DiffScope = "target" | "uncommitted";

export type UseAgentStudioDiffDataInput = {
  /** Configured repo path (must be in Tauri workspace allowlist). */
  repoPath: string | null;
  /** Session working directory — used as informational worktree path only. */
  sessionWorkingDirectory: string | null;
  /** Run ID from the session — used to look up the actual worktree path from the backend. */
  sessionRunId: string | null;
  /** Default target branch from repo settings. */
  defaultTargetBranch: string;
  branchIdentityKey?: string | null;
  /** Whether to enable polling (only when builder session is active). */
  enablePolling: boolean;
};

// ─── Batched internal state ────────────────────────────────────────────────────

type DiffBatchState = {
  byScope: Record<DiffScope, ScopeSnapshot>;
  loadedByScope: Record<DiffScope, boolean>;
  isLoading: boolean;
};

type ScopeSnapshot = {
  branch: string | null;
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  uncommittedFileCount: number;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  error: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
};

type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
  mode?: LoadDataMode;
  replayIfInFlight?: boolean;
};

type LoadDataMode = "full" | "summary";

/** Stable empty arrays hoisted outside the component (rerender-memo-with-default-value). */
const EMPTY_DIFFS: FileDiff[] = [];
const EMPTY_STATUSES: FileStatus[] = [];

const EMPTY_SCOPE_SNAPSHOT: ScopeSnapshot = {
  branch: null,
  fileDiffs: EMPTY_DIFFS,
  fileStatuses: EMPTY_STATUSES,
  uncommittedFileCount: 0,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  upstreamStatus: "tracking",
  error: null,
  hashVersion: null,
  statusHash: null,
  diffHash: null,
};

const createInitialState = (): DiffBatchState => ({
  byScope: {
    target: EMPTY_SCOPE_SNAPSHOT,
    uncommitted: EMPTY_SCOPE_SNAPSHOT,
  },
  loadedByScope: {
    target: false,
    uncommitted: false,
  },
  isLoading: false,
});

const ALL_SCOPES: DiffScope[] = ["target", "uncommitted"];
const ALL_LOAD_DATA_MODES: LoadDataMode[] = ["full", "summary"];

// ─── Structural equality helpers ───────────────────────────────────────────────

const arraysEqual = <T>(a: T[], b: T[], areItemsEqual: (left: T, right: T) => boolean): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined || right === undefined) {
      return false;
    }
    if (!areItemsEqual(left, right)) {
      return false;
    }
  }

  return true;
};

const fileDiffEqual = (left: FileDiff, right: FileDiff): boolean =>
  left.file === right.file &&
  left.type === right.type &&
  left.additions === right.additions &&
  left.deletions === right.deletions &&
  left.diff === right.diff;

const fileStatusEqual = (left: FileStatus, right: FileStatus): boolean =>
  left.path === right.path && left.status === right.status && left.staged === right.staged;

const aheadBehindEqual = (a: CommitsAheadBehind | null, b: CommitsAheadBehind | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.ahead === b.ahead && a.behind === b.behind;
};

const hashMetadataEqual = (left: ScopeSnapshot, right: ScopeSnapshot): boolean =>
  left.hashVersion === right.hashVersion &&
  left.statusHash === right.statusHash &&
  left.diffHash === right.diffHash;

const scopeSnapshotEqual = (left: ScopeSnapshot, right: ScopeSnapshot): boolean =>
  (() => {
    const canUseHashShortCircuit =
      left.hashVersion !== null &&
      right.hashVersion !== null &&
      left.hashVersion === right.hashVersion &&
      left.statusHash !== null &&
      right.statusHash !== null &&
      left.diffHash !== null &&
      right.diffHash !== null;

    if (canUseHashShortCircuit) {
      const hashesMatch = left.statusHash === right.statusHash && left.diffHash === right.diffHash;
      const contentReferencesMatch =
        left.fileDiffs === right.fileDiffs && left.fileStatuses === right.fileStatuses;
      if (hashesMatch && left.error === right.error && contentReferencesMatch) {
        return true;
      }
    }

    return (
      left.branch === right.branch &&
      arraysEqual(left.fileDiffs, right.fileDiffs, fileDiffEqual) &&
      arraysEqual(left.fileStatuses, right.fileStatuses, fileStatusEqual) &&
      left.uncommittedFileCount === right.uncommittedFileCount &&
      aheadBehindEqual(left.commitsAheadBehind, right.commitsAheadBehind) &&
      aheadBehindEqual(left.upstreamAheadBehind, right.upstreamAheadBehind) &&
      left.upstreamStatus === right.upstreamStatus &&
      left.error === right.error &&
      hashMetadataEqual(left, right)
    );
  })();

const toUpstreamAndError = (
  upstreamAheadBehind: GitWorktreeStatus["upstreamAheadBehind"],
): {
  upstreamAheadBehind: CommitsAheadBehind | null;
  upstreamStatus: "tracking" | "untracked" | "error";
  error: string | null;
} => {
  if (upstreamAheadBehind.outcome === "tracking") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: upstreamAheadBehind.behind,
      },
      upstreamStatus: "tracking",
      error: null,
    };
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: 0,
      },
      upstreamStatus: "untracked",
      error: null,
    };
  }

  return {
    upstreamAheadBehind: null,
    upstreamStatus: "error",
    error: `Upstream status unavailable: ${upstreamAheadBehind.message}`,
  };
};

const toScopeSnapshot = (snapshot: GitWorktreeStatus): ScopeSnapshot => {
  const { upstreamAheadBehind, upstreamStatus, error } = toUpstreamAndError(
    snapshot.upstreamAheadBehind,
  );
  return {
    branch: snapshot.currentBranch.name ?? null,
    fileDiffs: snapshot.fileDiffs,
    fileStatuses: snapshot.fileStatuses,
    uncommittedFileCount: snapshot.fileStatuses.length,
    commitsAheadBehind: snapshot.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    error,
    hashVersion: snapshot.snapshot.hashVersion,
    statusHash: snapshot.snapshot.statusHash,
    diffHash: snapshot.snapshot.diffHash,
  };
};

type ScopeSummaryFields = Pick<
  ScopeSnapshot,
  | "branch"
  | "uncommittedFileCount"
  | "commitsAheadBehind"
  | "upstreamAheadBehind"
  | "upstreamStatus"
  | "error"
  | "hashVersion"
  | "statusHash"
  | "diffHash"
>;

const toScopeSummaryFields = (summary: GitWorktreeStatusSummary): ScopeSummaryFields => {
  const { upstreamAheadBehind, upstreamStatus, error } = toUpstreamAndError(
    summary.upstreamAheadBehind,
  );
  return {
    branch: summary.currentBranch.name ?? null,
    uncommittedFileCount: summary.fileStatusCounts.total,
    commitsAheadBehind: summary.targetAheadBehind,
    upstreamAheadBehind,
    upstreamStatus,
    error,
    hashVersion: summary.snapshot.hashVersion,
    statusHash: summary.snapshot.statusHash,
    diffHash: summary.snapshot.diffHash,
  };
};

const mergeSharedSnapshotFields = (base: ScopeSnapshot, source: ScopeSnapshot): ScopeSnapshot => ({
  ...base,
  branch: source.branch,
  fileStatuses: source.fileStatuses,
  uncommittedFileCount: source.uncommittedFileCount,
  commitsAheadBehind: source.commitsAheadBehind,
  upstreamAheadBehind: source.upstreamAheadBehind,
  upstreamStatus: source.upstreamStatus,
  error: source.error,
  hashVersion: source.hashVersion,
  statusHash: source.statusHash,
});

const mergeSharedSummaryFields = (
  base: ScopeSnapshot,
  source: ScopeSummaryFields,
): ScopeSnapshot => ({
  ...base,
  branch: source.branch,
  uncommittedFileCount: source.uncommittedFileCount,
  commitsAheadBehind: source.commitsAheadBehind,
  upstreamAheadBehind: source.upstreamAheadBehind,
  upstreamStatus: source.upstreamStatus,
  error: source.error,
  hashVersion: source.hashVersion,
  statusHash: source.statusHash,
});

const toStatusSnapshotKey = (snapshot: ScopeSnapshot): string | null => {
  if (snapshot.fileStatuses.length === 0) {
    return "<empty>";
  }

  return snapshot.fileStatuses
    .map((fileStatus) => `${fileStatus.path}:${fileStatus.status}:${fileStatus.staged ? 1 : 0}`)
    .join("|");
};

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAgentStudioDiffData({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  defaultTargetBranch,
  branchIdentityKey = null,
  enablePolling,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const [state, setState] = useState<DiffBatchState>(createInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [diffScope, setDiffScope] = useState<DiffScope>("target");

  const versionByScopeAndModeRef = useRef<Record<DiffScope, Record<LoadDataMode, number>>>({
    target: { full: 0, summary: 0 },
    uncommitted: { full: 0, summary: 0 },
  });
  const requestSequenceRef = useRef(0);
  const latestSharedSequenceRef = useRef(0);
  const inFlightScopeRequestRef = useRef<Record<DiffScope, Record<LoadDataMode, string | null>>>({
    target: { full: null, summary: null },
    uncommitted: { full: null, summary: null },
  });
  const queuedFullReloadByScopeRef = useRef<Record<DiffScope, boolean>>({
    target: false,
    uncommitted: false,
  });
  const requestContextKeyRef = useRef<string | null>(null);

  // Derive stable primitives
  const targetBranch = normalizeCanonicalTargetBranch(defaultTargetBranch);
  const {
    worktreePath,
    worktreeResolutionRunId,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving,
    worktreeResolutionError,
    retryWorktreeResolution,
  } = useAgentStudioWorktreeResolution({
    repoPath,
    sessionWorkingDirectory,
    sessionRunId,
  });

  // Stable refs for use in callbacks (advanced-event-handler-refs)
  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const targetBranchRef = useRef(targetBranch);
  targetBranchRef.current = targetBranch;
  const diffScopeRef = useRef(diffScope);
  diffScopeRef.current = diffScope;
  // Use the resolved worktree path as the actual working directory for git commands
  const workingDirRef = useRef(worktreePath);
  workingDirRef.current = worktreePath;

  const loadData = useCallback(async (showLoading = false, context?: LoadDataContext) => {
    const path = context?.repoPath ?? repoPathRef.current;
    if (!path) {
      return;
    }

    const scope = context?.scope ?? diffScopeRef.current;
    const target = context?.targetBranch ?? targetBranchRef.current;
    const workingDir = context?.workingDir ?? workingDirRef.current;
    const mode = context?.mode ?? "full";
    const replayIfInFlight = context?.replayIfInFlight === true;
    const requestKey = `${path}::${target}::${workingDir ?? ""}`;

    if (inFlightScopeRequestRef.current[scope][mode] === requestKey) {
      if (mode === "full" && replayIfInFlight) {
        queuedFullReloadByScopeRef.current[scope] = true;
      }
      return;
    }

    if (mode === "summary" && inFlightScopeRequestRef.current[scope].full === requestKey) {
      return;
    }

    inFlightScopeRequestRef.current[scope][mode] = requestKey;
    const version = ++versionByScopeAndModeRef.current[scope][mode];
    const requestSequence = ++requestSequenceRef.current;

    // Only show loading indicator on initial load / manual refresh — NOT on polling
    if (showLoading) {
      setState((prev) => (prev.isLoading ? prev : { ...prev, isLoading: true }));
    }

    try {
      const wd = workingDir ?? undefined;

      if (mode === "summary") {
        const summary = await host.gitGetWorktreeStatusSummary(path, target, scope, wd);

        const hasContextChanged =
          repoPathRef.current !== path ||
          targetBranchRef.current !== target ||
          (workingDirRef.current ?? null) !== workingDir;
        if (hasContextChanged) {
          return;
        }

        // Stale response guard
        if (versionByScopeAndModeRef.current[scope][mode] !== version) {
          return;
        }

        const previousSummarySnapshot = stateRef.current.byScope[scope];
        const nextSummaryFields = toScopeSummaryFields(summary);
        const hashesChanged =
          previousSummarySnapshot.hashVersion !== nextSummaryFields.hashVersion ||
          previousSummarySnapshot.statusHash !== nextSummaryFields.statusHash ||
          previousSummarySnapshot.diffHash !== nextSummaryFields.diffHash;
        const shouldReloadFullScope = stateRef.current.loadedByScope[scope] && hashesChanged;

        setState((prev) => {
          const previousFetchedScopeSnapshot = prev.byScope[scope];
          const nextFetchedScopeSnapshot: ScopeSnapshot = {
            ...previousFetchedScopeSnapshot,
            ...nextSummaryFields,
          };
          let didChange = false;
          const nextByScope: Record<DiffScope, ScopeSnapshot> = {
            ...prev.byScope,
          };

          if (!scopeSnapshotEqual(previousFetchedScopeSnapshot, nextFetchedScopeSnapshot)) {
            nextByScope[scope] = nextFetchedScopeSnapshot;
            didChange = true;
          }

          if (requestSequence >= latestSharedSequenceRef.current) {
            latestSharedSequenceRef.current = requestSequence;
            let nextLoadedByScope = prev.loadedByScope;
            for (const otherScope of ALL_SCOPES) {
              if (otherScope === scope) {
                continue;
              }

              const previousOtherScopeSnapshot = nextByScope[otherScope];
              const nextOtherScopeSnapshot = mergeSharedSummaryFields(
                previousOtherScopeSnapshot,
                nextSummaryFields,
              );

              if (!scopeSnapshotEqual(previousOtherScopeSnapshot, nextOtherScopeSnapshot)) {
                nextByScope[otherScope] = nextOtherScopeSnapshot;
                didChange = true;
              }

              if (hashesChanged && prev.loadedByScope[otherScope]) {
                const invalidatedOtherScopeSnapshot: ScopeSnapshot = {
                  ...nextByScope[otherScope],
                  fileDiffs: EMPTY_DIFFS,
                };
                if (!scopeSnapshotEqual(nextByScope[otherScope], invalidatedOtherScopeSnapshot)) {
                  nextByScope[otherScope] = invalidatedOtherScopeSnapshot;
                  didChange = true;
                }
                if (nextLoadedByScope[otherScope]) {
                  nextLoadedByScope = {
                    ...nextLoadedByScope,
                    [otherScope]: false,
                  };
                  didChange = true;
                }
              }
            }

            if (!didChange && !prev.isLoading) {
              return prev;
            }

            return {
              byScope: nextByScope,
              loadedByScope: nextLoadedByScope,
              isLoading: false,
            };
          }

          if (!didChange && !prev.isLoading) {
            return prev;
          }

          return {
            byScope: nextByScope,
            loadedByScope: prev.loadedByScope,
            isLoading: false,
          };
        });

        if (shouldReloadFullScope) {
          void loadData(false, {
            repoPath: path,
            targetBranch: target,
            workingDir,
            scope,
            mode: "full",
          });
        }
        return;
      }

      const snapshot = await host.gitGetWorktreeStatus(path, target, scope, wd);

      const hasContextChanged =
        repoPathRef.current !== path ||
        targetBranchRef.current !== target ||
        (workingDirRef.current ?? null) !== workingDir;
      if (hasContextChanged) {
        return;
      }

      // Stale response guard
      if (versionByScopeAndModeRef.current[scope][mode] !== version) {
        return;
      }

      setState((prev) => {
        const nextFetchedScopeSnapshot = toScopeSnapshot(snapshot);
        const previousFetchedScopeSnapshot = prev.byScope[scope];
        let didChange = false;
        const nextByScope: Record<DiffScope, ScopeSnapshot> = {
          ...prev.byScope,
        };

        if (!scopeSnapshotEqual(previousFetchedScopeSnapshot, nextFetchedScopeSnapshot)) {
          nextByScope[scope] = nextFetchedScopeSnapshot;
          didChange = true;
        }

        let nextLoadedByScope = prev.loadedByScope;
        if (!prev.loadedByScope[scope]) {
          nextLoadedByScope = {
            ...prev.loadedByScope,
            [scope]: true,
          };
          didChange = true;
        }

        if (requestSequence >= latestSharedSequenceRef.current) {
          latestSharedSequenceRef.current = requestSequence;
          for (const otherScope of ALL_SCOPES) {
            if (otherScope === scope) {
              continue;
            }

            const previousOtherScopeSnapshot = nextByScope[otherScope];
            const nextOtherScopeSnapshot = mergeSharedSnapshotFields(
              previousOtherScopeSnapshot,
              nextFetchedScopeSnapshot,
            );

            if (!scopeSnapshotEqual(previousOtherScopeSnapshot, nextOtherScopeSnapshot)) {
              nextByScope[otherScope] = nextOtherScopeSnapshot;
              didChange = true;
            }
          }
        }

        if (!didChange && !prev.isLoading) {
          return prev;
        }

        return {
          byScope: nextByScope,
          loadedByScope: nextLoadedByScope,
          isLoading: false,
        };
      });
    } catch (err) {
      const hasContextChanged =
        repoPathRef.current !== path ||
        targetBranchRef.current !== target ||
        (workingDirRef.current ?? null) !== workingDir;
      if (hasContextChanged) {
        return;
      }

      if (versionByScopeAndModeRef.current[scope][mode] === version) {
        setState((prev) => {
          const previousScopeSnapshot = prev.byScope[scope];
          const nextScopeSnapshot: ScopeSnapshot = {
            ...previousScopeSnapshot,
            error: String(err),
            hashVersion: null,
            statusHash: null,
            diffHash: null,
          };

          let nextLoadedByScope = prev.loadedByScope;
          if (mode === "full" && !prev.loadedByScope[scope]) {
            nextLoadedByScope = {
              ...prev.loadedByScope,
              [scope]: true,
            };
          }

          const snapshotsEqual = scopeSnapshotEqual(previousScopeSnapshot, nextScopeSnapshot);
          const loadedByScopeUnchanged = nextLoadedByScope === prev.loadedByScope;
          if (snapshotsEqual && loadedByScopeUnchanged && !prev.isLoading) {
            return prev;
          }

          return {
            byScope: {
              ...prev.byScope,
              [scope]: nextScopeSnapshot,
            },
            loadedByScope: nextLoadedByScope,
            isLoading: false,
          };
        });
      }
    } finally {
      if (inFlightScopeRequestRef.current[scope][mode] === requestKey) {
        inFlightScopeRequestRef.current[scope][mode] = null;
      }

      if (mode === "full" && queuedFullReloadByScopeRef.current[scope]) {
        queuedFullReloadByScopeRef.current[scope] = false;
        globalThis.queueMicrotask(() => {
          void loadData(false, {
            repoPath: path,
            targetBranch: target,
            workingDir,
            scope,
            mode: "full",
          });
        });
      }
    }
  }, []);

  useEffect(() => {
    const contextKey = `${repoPath ?? ""}::${targetBranch}::${worktreePath ?? ""}::${
      worktreeResolutionRunId ?? ""
    }::${branchIdentityKey ?? ""}`;
    const hasContextChanged =
      requestContextKeyRef.current !== null && requestContextKeyRef.current !== contextKey;
    requestContextKeyRef.current = contextKey;

    if (repoPath && !shouldBlockDiffLoading) {
      if (hasContextChanged) {
        for (const scope of ALL_SCOPES) {
          for (const mode of ALL_LOAD_DATA_MODES) {
            versionByScopeAndModeRef.current[scope][mode] += 1;
            inFlightScopeRequestRef.current[scope][mode] = null;
          }
          queuedFullReloadByScopeRef.current[scope] = false;
        }
        requestSequenceRef.current = 0;
        latestSharedSequenceRef.current = 0;
        setState(createInitialState());
        setSelectedFileState(null);
      }

      void loadData(true, {
        repoPath,
        targetBranch,
        workingDir: worktreePath,
        scope: diffScopeRef.current,
      });
      return;
    }

    if (repoPath) {
      if (hasContextChanged) {
        for (const scope of ALL_SCOPES) {
          for (const mode of ALL_LOAD_DATA_MODES) {
            versionByScopeAndModeRef.current[scope][mode] += 1;
            inFlightScopeRequestRef.current[scope][mode] = null;
          }
          queuedFullReloadByScopeRef.current[scope] = false;
        }
        requestSequenceRef.current = 0;
        latestSharedSequenceRef.current = 0;
        setState(createInitialState());
        setSelectedFileState(null);
      }
      return;
    }

    for (const scope of ALL_SCOPES) {
      for (const mode of ALL_LOAD_DATA_MODES) {
        versionByScopeAndModeRef.current[scope][mode] += 1;
        inFlightScopeRequestRef.current[scope][mode] = null;
      }
      queuedFullReloadByScopeRef.current[scope] = false;
    }
    requestSequenceRef.current = 0;
    latestSharedSequenceRef.current = 0;
    requestContextKeyRef.current = null;
    setState(createInitialState());
    setSelectedFileState(null);
  }, [
    repoPath,
    worktreePath,
    targetBranch,
    worktreeResolutionRunId,
    branchIdentityKey,
    shouldBlockDiffLoading,
    loadData,
  ]);

  useEffect(() => {
    if (!repoPath || shouldBlockDiffLoading) {
      return;
    }

    if (state.loadedByScope[diffScope]) {
      return;
    }

    void loadData(true, { repoPath, targetBranch, workingDir: worktreePath, scope: diffScope });
  }, [
    repoPath,
    worktreePath,
    targetBranch,
    diffScope,
    state.loadedByScope,
    shouldBlockDiffLoading,
    loadData,
  ]);

  // Polling — stable interval since loadData doesn't change
  useEffect(() => {
    if (!enablePolling || !repoPath || shouldBlockDiffLoading) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      const polledScope = diffScopeRef.current;
      void loadData(false, {
        repoPath,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: polledScope,
        mode: "summary",
      });
    }, POLL_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [enablePolling, repoPath, shouldBlockDiffLoading, loadData]);

  const activeScopeState = state.byScope[diffScope];
  const statusSnapshotKey = toStatusSnapshotKey(activeScopeState);
  const displayError = worktreeResolutionError ?? activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving;
  const refresh = useCallback((): void => {
    if (worktreeResolutionError != null) {
      retryWorktreeResolution();
      return;
    }

    if (shouldBlockDiffLoading) {
      return;
    }

    void loadData(true, {
      repoPath: repoPathRef.current,
      targetBranch: targetBranchRef.current,
      workingDir: workingDirRef.current,
      scope: diffScopeRef.current,
      replayIfInFlight: true,
    });
  }, [loadData, retryWorktreeResolution, shouldBlockDiffLoading, worktreeResolutionError]);

  const setSelectedFile = useCallback(
    (path: string | null): void => {
      setSelectedFileState(path);

      if (path === null || shouldBlockDiffLoading) {
        return;
      }

      const selectedRepoPath = repoPathRef.current;
      if (!selectedRepoPath) {
        return;
      }

      void loadData(false, {
        repoPath: selectedRepoPath,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
        mode: "full",
        replayIfInFlight: true,
      });
    },
    [loadData, shouldBlockDiffLoading],
  );

  // Memoize return value to prevent parent re-renders (rerender-memo-with-default-value)
  return useMemo<DiffDataState>(
    () => ({
      branch: activeScopeState.branch,
      worktreePath,
      targetBranch,
      diffScope,
      commitsAheadBehind: activeScopeState.commitsAheadBehind,
      upstreamAheadBehind: activeScopeState.upstreamAheadBehind,
      upstreamStatus: activeScopeState.upstreamStatus,
      fileDiffs: activeScopeState.fileDiffs,
      fileStatuses: activeScopeState.fileStatuses,
      statusSnapshotKey,
      uncommittedFileCount: activeScopeState.uncommittedFileCount,
      isLoading,
      error: displayError,
      refresh,
      selectedFile,
      setSelectedFile,
      setDiffScope,
    }),
    [
      worktreePath,
      targetBranch,
      diffScope,
      isLoading,
      displayError,
      statusSnapshotKey,
      activeScopeState,
      refresh,
      selectedFile,
      setSelectedFile,
    ],
  );
}
