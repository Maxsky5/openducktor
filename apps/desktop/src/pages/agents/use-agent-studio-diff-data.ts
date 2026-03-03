import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitWorktreeStatus,
  GitWorktreeStatusSummary,
} from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";
import { host } from "@/state/operations/host";

const POLL_INTERVAL_MS = 30_000;
const WORKTREE_RESOLUTION_TIMEOUT_MS = 5_000;

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
  /** Total changed files from lightweight worktree polling summaries. */
  uncommittedFileCount?: number;
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
  uncommittedFileCount: number;
  commitsAheadBehind: CommitsAheadBehind | null;
  upstreamAheadBehind: CommitsAheadBehind | null;
  error: string | null;
  hashVersion: number | null;
  statusHash: string | null;
  diffHash: string | null;
};

type WorktreeResolutionState =
  | { status: "idle" }
  | {
      status: "resolving";
      repoPath: string;
      runId: string;
    }
  | {
      status: "resolved";
      repoPath: string;
      runId: string;
      path: string | null;
    }
  | {
      status: "failed";
      repoPath: string;
      runId: string;
      error: string;
    };

type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
  mode?: "full" | "summary";
};

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
const IDLE_WORKTREE_RESOLUTION_STATE: WorktreeResolutionState = { status: "idle" };

const buildWorktreeResolutionError = (runId: string, reason?: string): string => {
  const baseMessage = `Failed to resolve run worktree path for session ${runId}`;
  const retryMessage = "Use Refresh to retry.";
  const normalizedReason = reason?.trim() ?? "";
  if (normalizedReason.length === 0) {
    return `${baseMessage}. ${retryMessage}`;
  }

  const reasonTerminator = /[.!?]$/.test(normalizedReason) ? "" : ".";
  return `${baseMessage}: ${normalizedReason}${reasonTerminator} ${retryMessage}`;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  }
};

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
      if (hashesMatch && left.error === right.error) {
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
      left.error === right.error &&
      hashMetadataEqual(left, right)
    );
  })();

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
    uncommittedFileCount: snapshot.fileStatuses.length,
    commitsAheadBehind: snapshot.targetAheadBehind,
    upstreamAheadBehind,
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
  | "error"
  | "hashVersion"
  | "statusHash"
  | "diffHash"
>;

const toScopeSummaryFields = (summary: GitWorktreeStatusSummary): ScopeSummaryFields => {
  const { upstreamAheadBehind, error } = toUpstreamAndError(summary.upstreamAheadBehind);
  return {
    branch: summary.currentBranch.name ?? null,
    uncommittedFileCount: summary.fileStatusCounts.total,
    commitsAheadBehind: summary.targetAheadBehind,
    upstreamAheadBehind,
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
  error: source.error,
  hashVersion: source.hashVersion,
  statusHash: source.statusHash,
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
  const [worktreeResolutionState, setWorktreeResolutionState] = useState<WorktreeResolutionState>(
    IDLE_WORKTREE_RESOLUTION_STATE,
  );
  const [worktreeResolutionRetryToken, setWorktreeResolutionRetryToken] = useState(0);

  const versionByScopeRef = useRef<Record<DiffScope, number>>({
    target: 0,
    uncommitted: 0,
  });
  const requestSequenceRef = useRef(0);
  const latestSharedSequenceRef = useRef(0);
  const inFlightScopeRequestRef = useRef<Record<DiffScope, string | null>>({
    target: null,
    uncommitted: null,
  });
  const requestContextKeyRef = useRef<string | null>(null);

  // Derive stable primitives
  const targetBranch = normalizeCanonicalTargetBranch(defaultTargetBranch);

  // If session.workingDirectory is different from repoPath, use it directly.
  // Otherwise, resolve the correct worktree path from RunSummary before polling git data.
  const directWorktreePath =
    sessionWorkingDirectory && sessionWorkingDirectory !== repoPath
      ? sessionWorkingDirectory
      : null;
  const shouldResolveWorktreeFromRunSummary =
    directWorktreePath === null && repoPath != null && sessionRunId != null;
  const worktreeResolutionRepoPath = shouldResolveWorktreeFromRunSummary ? repoPath : null;
  const worktreeResolutionRunId = shouldResolveWorktreeFromRunSummary ? sessionRunId : null;
  const hasResolvedWorktreeForCurrentContext =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionRunId != null &&
    worktreeResolutionState.status === "resolved" &&
    worktreeResolutionState.repoPath === worktreeResolutionRepoPath &&
    worktreeResolutionState.runId === worktreeResolutionRunId;
  const resolvedWorktreePath = hasResolvedWorktreeForCurrentContext
    ? worktreeResolutionState.path
    : null;
  const worktreePath = directWorktreePath ?? resolvedWorktreePath;
  const shouldBlockDiffLoading =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionRunId != null &&
    !hasResolvedWorktreeForCurrentContext;
  const isWorktreeResolutionResolving =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionRunId != null &&
    worktreeResolutionState.status === "resolving" &&
    worktreeResolutionState.repoPath === worktreeResolutionRepoPath &&
    worktreeResolutionState.runId === worktreeResolutionRunId;
  const worktreeResolutionError =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionRunId != null &&
    worktreeResolutionState.status === "failed" &&
    worktreeResolutionState.repoPath === worktreeResolutionRepoPath &&
    worktreeResolutionState.runId === worktreeResolutionRunId
      ? worktreeResolutionState.error
      : null;
  const worktreeResolutionRequestKey =
    worktreeResolutionRepoPath != null && worktreeResolutionRunId != null
      ? `${worktreeResolutionRepoPath}::${worktreeResolutionRunId}::${worktreeResolutionRetryToken}`
      : null;

  // Resolve worktree path from RunSummary when session.workingDirectory === repoPath.
  // The Rust backend always stores the correct worktreePath in RunSummary, even if
  // the session's workingDirectory was set to repoPath at creation time.
  useEffect(() => {
    if (!worktreeResolutionRequestKey || !worktreeResolutionRepoPath || !worktreeResolutionRunId) {
      setWorktreeResolutionState((previous) =>
        previous.status === "idle" ? previous : IDLE_WORKTREE_RESOLUTION_STATE,
      );
      return;
    }

    let isCurrent = true;
    setWorktreeResolutionState((previous) => {
      if (
        previous.status === "resolving" &&
        previous.repoPath === worktreeResolutionRepoPath &&
        previous.runId === worktreeResolutionRunId
      ) {
        return previous;
      }

      return {
        status: "resolving",
        repoPath: worktreeResolutionRepoPath,
        runId: worktreeResolutionRunId,
      };
    });

    void (async () => {
      try {
        const runs = await withTimeout(
          host.runsList(worktreeResolutionRepoPath),
          WORKTREE_RESOLUTION_TIMEOUT_MS,
          `Timed out after ${WORKTREE_RESOLUTION_TIMEOUT_MS}ms while loading runs list.`,
        );
        if (!isCurrent) {
          return;
        }

        const matchingRun = runs.find((run) => run.runId === worktreeResolutionRunId);
        if (!matchingRun) {
          const missingRunError = buildWorktreeResolutionError(
            worktreeResolutionRunId,
            "Run not found in runs list response.",
          );
          setWorktreeResolutionState((previous) => {
            if (
              previous.status === "failed" &&
              previous.repoPath === worktreeResolutionRepoPath &&
              previous.runId === worktreeResolutionRunId &&
              previous.error === missingRunError
            ) {
              return previous;
            }

            return {
              status: "failed",
              repoPath: worktreeResolutionRepoPath,
              runId: worktreeResolutionRunId,
              error: missingRunError,
            };
          });
          return;
        }

        const nextPath =
          matchingRun.worktreePath !== worktreeResolutionRepoPath ? matchingRun.worktreePath : null;

        setWorktreeResolutionState((previous) => {
          if (
            previous.status === "resolved" &&
            previous.repoPath === worktreeResolutionRepoPath &&
            previous.runId === worktreeResolutionRunId &&
            previous.path === nextPath
          ) {
            return previous;
          }

          return {
            status: "resolved",
            repoPath: worktreeResolutionRepoPath,
            runId: worktreeResolutionRunId,
            path: nextPath,
          };
        });
      } catch (cause) {
        if (!isCurrent) {
          return;
        }

        const resolutionError = buildWorktreeResolutionError(
          worktreeResolutionRunId,
          errorMessage(cause),
        );
        setWorktreeResolutionState({
          status: "failed",
          repoPath: worktreeResolutionRepoPath,
          runId: worktreeResolutionRunId,
          error: resolutionError,
        });
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [worktreeResolutionRepoPath, worktreeResolutionRequestKey, worktreeResolutionRunId]);

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
    const requestKey = `${path}::${target}::${workingDir ?? ""}::${mode}`;

    if (inFlightScopeRequestRef.current[scope] === requestKey) {
      return;
    }

    inFlightScopeRequestRef.current[scope] = requestKey;
    const version = ++versionByScopeRef.current[scope];
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
        if (versionByScopeRef.current[scope] !== version) {
          return;
        }

        setState((prev) => {
          const summaryFields = toScopeSummaryFields(summary);
          const previousFetchedScopeSnapshot = prev.byScope[scope];
          const nextFetchedScopeSnapshot: ScopeSnapshot = {
            ...previousFetchedScopeSnapshot,
            ...summaryFields,
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
            for (const otherScope of ALL_SCOPES) {
              if (otherScope === scope) {
                continue;
              }

              const previousOtherScopeSnapshot = nextByScope[otherScope];
              const nextOtherScopeSnapshot = mergeSharedSummaryFields(
                previousOtherScopeSnapshot,
                summaryFields,
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
            loadedByScope: prev.loadedByScope,
            isLoading: false,
          };
        });
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

      if (versionByScopeRef.current[scope] === version) {
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
      if (inFlightScopeRequestRef.current[scope] === requestKey) {
        inFlightScopeRequestRef.current[scope] = null;
      }
    }
  }, []);

  useEffect(() => {
    const contextKey = `${repoPath ?? ""}::${targetBranch}::${worktreePath ?? ""}::${
      worktreeResolutionRunId ?? ""
    }`;
    const hasContextChanged =
      requestContextKeyRef.current !== null && requestContextKeyRef.current !== contextKey;
    requestContextKeyRef.current = contextKey;

    if (repoPath && !shouldBlockDiffLoading) {
      if (hasContextChanged) {
        versionByScopeRef.current.target += 1;
        versionByScopeRef.current.uncommitted += 1;
        inFlightScopeRequestRef.current.target = null;
        inFlightScopeRequestRef.current.uncommitted = null;
        requestSequenceRef.current = 0;
        latestSharedSequenceRef.current = 0;
        setState(createInitialState());
        setSelectedFile(null);
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
        versionByScopeRef.current.target += 1;
        versionByScopeRef.current.uncommitted += 1;
        inFlightScopeRequestRef.current.target = null;
        inFlightScopeRequestRef.current.uncommitted = null;
        requestSequenceRef.current = 0;
        latestSharedSequenceRef.current = 0;
        setState(createInitialState());
        setSelectedFile(null);
      }
      return;
    }

    versionByScopeRef.current.target += 1;
    versionByScopeRef.current.uncommitted += 1;
    inFlightScopeRequestRef.current.target = null;
    inFlightScopeRequestRef.current.uncommitted = null;
    requestSequenceRef.current = 0;
    latestSharedSequenceRef.current = 0;
    requestContextKeyRef.current = null;
    setState(createInitialState());
    setSelectedFile(null);
  }, [
    repoPath,
    worktreePath,
    targetBranch,
    worktreeResolutionRunId,
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
  const displayError = worktreeResolutionError ?? activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving;
  const refresh = useCallback((): void => {
    if (worktreeResolutionError != null) {
      setWorktreeResolutionRetryToken((previous) => previous + 1);
      return;
    }

    if (shouldBlockDiffLoading) {
      return;
    }

    void loadData(true);
  }, [loadData, shouldBlockDiffLoading, worktreeResolutionError]);

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
      activeScopeState,
      refresh,
      selectedFile,
    ],
  );
}
