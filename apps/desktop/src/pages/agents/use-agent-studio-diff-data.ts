import type { CommitsAheadBehind, FileDiff, FileStatus } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { host } from "@/state/operations/host";

const POLL_INTERVAL_MS = 5_000;

// ─── Public types ──────────────────────────────────────────────────────────────

export type DiffDataState = {
  /** Current branch name (fetched via git). */
  branch: string | null;
  /** Path to the worktree directory (if separate from main repo). */
  worktreePath: string | null;
  /** Target branch for ahead/behind comparison. */
  targetBranch: string;
  /** Commits ahead/behind the target branch. */
  commitsAheadBehind: CommitsAheadBehind | null;
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
};

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
  branch: string | null;
  fileDiffs: FileDiff[];
  fileStatuses: FileStatus[];
  commitsAheadBehind: CommitsAheadBehind | null;
  isLoading: boolean;
  error: string | null;
};

/** Stable empty arrays hoisted outside the component (rerender-memo-with-default-value). */
const EMPTY_DIFFS: FileDiff[] = [];
const EMPTY_STATUSES: FileStatus[] = [];

const INITIAL_STATE: DiffBatchState = {
  branch: null,
  fileDiffs: EMPTY_DIFFS,
  fileStatuses: EMPTY_STATUSES,
  commitsAheadBehind: null,
  isLoading: false,
  error: null,
};

// ─── Structural equality helpers ───────────────────────────────────────────────

const arraysEqual = <T>(a: T[], b: T[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
};

const aheadBehindEqual = (a: CommitsAheadBehind | null, b: CommitsAheadBehind | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.ahead === b.ahead && a.behind === b.behind;
};

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAgentStudioDiffData({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  defaultTargetBranch,
  enablePolling,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const [state, setState] = useState<DiffBatchState>(INITIAL_STATE);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [resolvedWorktreePath, setResolvedWorktreePath] = useState<string | null>(null);

  const versionRef = useRef(0);

  // Derive stable primitives
  const targetBranch = defaultTargetBranch || "origin/main";

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
  // Use the resolved worktree path as the actual working directory for git commands
  const workingDirRef = useRef(worktreePath);
  workingDirRef.current = worktreePath;

  const loadData = useCallback(async (showLoading = false) => {
    const path = repoPathRef.current;
    if (!path) {
      return;
    }

    const version = ++versionRef.current;

    // Only show loading indicator on initial load / manual refresh — NOT on polling
    if (showLoading) {
      setState((prev) => (prev.isLoading ? prev : { ...prev, isLoading: true, error: null }));
    }

    try {
      const target = targetBranchRef.current;
      const wd = workingDirRef.current ?? undefined;
      const [branchResult, statusResult, diffResult, aheadBehindResult] = await Promise.allSettled([
        host.gitGetCurrentBranch(path, wd),
        host.gitGetStatus(path, wd),
        host.gitGetDiff(path, target, wd),
        host.gitCommitsAheadBehind(path, target, wd),
      ]);

      // Stale response guard
      if (versionRef.current !== version) {
        return;
      }

      // Batch all updates into a single setState with structural equality check
      setState((prev) => {
        const nextBranch =
          branchResult.status === "fulfilled" ? (branchResult.value.name ?? null) : prev.branch;
        const nextStatuses =
          statusResult.status === "fulfilled" ? statusResult.value : prev.fileStatuses;
        const nextDiffs = diffResult.status === "fulfilled" ? diffResult.value : prev.fileDiffs;
        const nextAheadBehind =
          aheadBehindResult.status === "fulfilled"
            ? aheadBehindResult.value
            : prev.commitsAheadBehind;

        const allFailed =
          statusResult.status === "rejected" &&
          diffResult.status === "rejected" &&
          aheadBehindResult.status === "rejected";

        const nextError = allFailed ? String(statusResult.reason) : null;

        // Structural equality: skip re-render if nothing changed (prevents flickering)
        if (
          prev.branch === nextBranch &&
          arraysEqual(prev.fileDiffs, nextDiffs) &&
          arraysEqual(prev.fileStatuses, nextStatuses) &&
          aheadBehindEqual(prev.commitsAheadBehind, nextAheadBehind) &&
          prev.error === nextError &&
          !prev.isLoading
        ) {
          return prev;
        }

        return {
          branch: nextBranch,
          fileDiffs: nextDiffs,
          fileStatuses: nextStatuses,
          commitsAheadBehind: nextAheadBehind,
          isLoading: false,
          error: nextError,
        };
      });
    } catch (err) {
      if (versionRef.current === version) {
        setState((prev) => ({ ...prev, isLoading: false, error: String(err) }));
      }
    }
  }, []); // No deps — uses refs

  // Initial load when repo path or session working directory changes.
  // sessionWorkingDirectory can arrive late (sessions load asynchronously after page navigation),
  // so we must re-fetch when it becomes available.
  // biome-ignore lint/correctness/useExhaustiveDependencies: worktreePath is an intentional trigger — loadData reads it via ref, but the effect must re-fire when the worktree path resolves (async from runs list or session hydration)
  useEffect(() => {
    if (repoPath) {
      void loadData(true);
    } else {
      setState(INITIAL_STATE);
      setSelectedFile(null);
    }
  }, [repoPath, worktreePath, loadData]);

  // Polling — stable interval since loadData doesn't change
  useEffect(() => {
    if (!enablePolling || !repoPath) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadData();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enablePolling, repoPath, loadData]);

  // Memoize return value to prevent parent re-renders (rerender-memo-with-default-value)
  return useMemo<DiffDataState>(
    () => ({
      branch: state.branch,
      worktreePath,
      targetBranch,
      commitsAheadBehind: state.commitsAheadBehind,
      fileDiffs: state.fileDiffs,
      fileStatuses: state.fileStatuses,
      isLoading: state.isLoading,
      error: state.error,
      refresh: () => loadData(true),
      selectedFile,
      setSelectedFile,
    }),
    [worktreePath, targetBranch, state, loadData, selectedFile],
  );
}
