import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitWorktreeStatus,
} from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/host";

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
  upstreamAheadBehind?: CommitsAheadBehind | null;
  /** Changed files with diff content. */
  fileDiffs: FileDiff[];
  /** File status from `git status`. */
  fileStatuses: FileStatus[];
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
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  error: string | null;
};

type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
};

/** Stable empty arrays hoisted outside the component (rerender-memo-with-default-value). */
const EMPTY_DIFFS: FileDiff[] = [];
const EMPTY_STATUSES: FileStatus[] = [];

const EMPTY_SCOPE_SNAPSHOT: ScopeSnapshot = {
  branch: null,
  fileDiffs: EMPTY_DIFFS,
  fileStatuses: EMPTY_STATUSES,
  commitsAheadBehind: null,
  upstreamAheadBehind: null,
  error: null,
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

const scopeSnapshotEqual = (left: ScopeSnapshot, right: ScopeSnapshot): boolean =>
  left.branch === right.branch &&
  arraysEqual(left.fileDiffs, right.fileDiffs, fileDiffEqual) &&
  arraysEqual(left.fileStatuses, right.fileStatuses, fileStatusEqual) &&
  aheadBehindEqual(left.commitsAheadBehind, right.commitsAheadBehind) &&
  aheadBehindEqual(left.upstreamAheadBehind, right.upstreamAheadBehind) &&
  left.error === right.error;

const toUpstreamAndError = (
  upstreamAheadBehind: GitWorktreeStatus["upstreamAheadBehind"],
): {
  upstreamAheadBehind: CommitsAheadBehind | null;
  error: string | null;
} => {
  if (upstreamAheadBehind.outcome === "tracking") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: upstreamAheadBehind.behind,
      },
      error: null,
    };
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    return {
      upstreamAheadBehind: {
        ahead: upstreamAheadBehind.ahead,
        behind: 0,
      },
      error: null,
    };
  }

  return {
    upstreamAheadBehind: null,
    error: `Upstream status unavailable: ${upstreamAheadBehind.message}`,
  };
};

const toScopeSnapshot = (snapshot: GitWorktreeStatus): ScopeSnapshot => {
  const { upstreamAheadBehind, error } = toUpstreamAndError(snapshot.upstreamAheadBehind);
  return {
    branch: snapshot.currentBranch.name ?? null,
    fileDiffs: snapshot.fileDiffs,
    fileStatuses: snapshot.fileStatuses,
    commitsAheadBehind: snapshot.targetAheadBehind,
    upstreamAheadBehind,
    error,
  };
};

const mergeSharedSnapshotFields = (base: ScopeSnapshot, source: ScopeSnapshot): ScopeSnapshot => ({
  ...base,
  branch: source.branch,
  fileStatuses: source.fileStatuses,
  commitsAheadBehind: source.commitsAheadBehind,
  upstreamAheadBehind: source.upstreamAheadBehind,
  error: source.error,
});

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAgentStudioDiffData({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  defaultTargetBranch,
  enablePolling,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const [state, setState] = useState<DiffBatchState>(createInitialState);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffScope, setDiffScope] = useState<DiffScope>("target");
  const [resolvedWorktreePath, setResolvedWorktreePath] = useState<string | null>(null);

  const versionByScopeRef = useRef<Record<DiffScope, number>>({
    target: 0,
    uncommitted: 0,
  });
  const inFlightScopesRef = useRef<Set<DiffScope>>(new Set());

  // Derive stable primitives
  const targetBranch = normalizeCanonicalTargetBranch(defaultTargetBranch);

  // If session.workingDirectory is different from repoPath, use it directly.
  // Otherwise, fall back to a resolved worktree path from the runs list.
  const directWorktreePath =
    sessionWorkingDirectory && sessionWorkingDirectory !== repoPath
      ? sessionWorkingDirectory
      : null;
  const worktreePath = directWorktreePath ?? resolvedWorktreePath;

  // Resolve worktree path from RunSummary when session.workingDirectory === repoPath.
  // The Rust backend always stores the correct worktreePath in RunSummary, even if
  // the session's workingDirectory was set to repoPath at creation time.
  const resolvedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (directWorktreePath || !repoPath || !sessionRunId) {
      return;
    }
    // Skip if we already resolved for this runId
    if (resolvedRunIdRef.current === sessionRunId) {
      return;
    }
    resolvedRunIdRef.current = sessionRunId;
    void host.runsList(repoPath).then((runs) => {
      const matchingRun = runs.find((r) => r.runId === sessionRunId);
      if (matchingRun && matchingRun.worktreePath !== repoPath) {
        setResolvedWorktreePath(matchingRun.worktreePath);
      }
    });
  }, [directWorktreePath, repoPath, sessionRunId]);

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
    if (inFlightScopesRef.current.has(scope)) {
      return;
    }

    inFlightScopesRef.current.add(scope);
    const version = ++versionByScopeRef.current[scope];

    // Only show loading indicator on initial load / manual refresh — NOT on polling
    if (showLoading) {
      setState((prev) => (prev.isLoading ? prev : { ...prev, isLoading: true }));
    }

    try {
      const target = context?.targetBranch ?? targetBranchRef.current;
      const wd = context?.workingDir ?? workingDirRef.current ?? undefined;
      const snapshot = await host.gitGetWorktreeStatus(path, target, scope, wd);

      // Stale response guard
      if (versionByScopeRef.current[scope] !== version) {
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
      if (versionByScopeRef.current[scope] === version) {
        setState((prev) => {
          const previousScopeSnapshot = prev.byScope[scope];
          const nextScopeSnapshot: ScopeSnapshot = {
            ...previousScopeSnapshot,
            error: String(err),
          };

          let nextLoadedByScope = prev.loadedByScope;
          if (!prev.loadedByScope[scope]) {
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
      inFlightScopesRef.current.delete(scope);
    }
  }, []);

  useEffect(() => {
    if (repoPath) {
      void loadData(true, {
        repoPath,
        targetBranch,
        workingDir: worktreePath,
        scope: diffScopeRef.current,
      });
    } else {
      setState(createInitialState());
      setSelectedFile(null);
    }
  }, [repoPath, worktreePath, targetBranch, loadData]);

  useEffect(() => {
    if (!repoPath) {
      return;
    }

    if (state.loadedByScope[diffScope]) {
      return;
    }

    void loadData(true, { repoPath, targetBranch, workingDir: worktreePath, scope: diffScope });
  }, [repoPath, worktreePath, targetBranch, diffScope, state.loadedByScope, loadData]);

  // Polling — stable interval since loadData doesn't change
  useEffect(() => {
    if (!enablePolling || !repoPath) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      const polledScope = diffScopeRef.current;
      void loadData(false, {
        repoPath,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: polledScope,
      });
    }, POLL_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [enablePolling, repoPath, loadData]);

  const activeScopeState = state.byScope[diffScope];

  // Memoize return value to prevent parent re-renders (rerender-memo-with-default-value)
  return useMemo<DiffDataState>(
    () => ({
      branch: activeScopeState.branch,
      worktreePath,
      targetBranch,
      diffScope,
      commitsAheadBehind: activeScopeState.commitsAheadBehind,
      upstreamAheadBehind: activeScopeState.upstreamAheadBehind,
      fileDiffs: activeScopeState.fileDiffs,
      fileStatuses: activeScopeState.fileStatuses,
      isLoading: state.isLoading,
      error: activeScopeState.error,
      refresh: () => loadData(true),
      selectedFile,
      setSelectedFile,
      setDiffScope,
    }),
    [
      worktreePath,
      targetBranch,
      diffScope,
      state.isLoading,
      activeScopeState,
      loadData,
      selectedFile,
    ],
  );
}
