import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoRunsFromQuery, taskQueryKeys } from "@/state/queries/tasks";

const WORKTREE_RESOLUTION_TIMEOUT_MS = 5_000;

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

type UseAgentStudioWorktreeResolutionInput = {
  repoPath: string | null;
  sessionWorkingDirectory: string | null;
  sessionRunId: string | null;
  runCompletionRecoverySignal?: number;
};

type WorktreeResolutionResult = {
  worktreePath: string | null;
  worktreeResolutionRunId: string | null;
  shouldBlockDiffLoading: boolean;
  isWorktreeResolutionResolving: boolean;
  worktreeResolutionError: string | null;
  retryWorktreeResolution: () => void;
};

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

export function useAgentStudioWorktreeResolution({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  runCompletionRecoverySignal,
}: UseAgentStudioWorktreeResolutionInput): WorktreeResolutionResult {
  const [worktreeResolutionState, setWorktreeResolutionState] = useState<WorktreeResolutionState>(
    IDLE_WORKTREE_RESOLUTION_STATE,
  );
  const [worktreeResolutionRetryToken, setWorktreeResolutionRetryToken] = useState(0);
  const lastHandledRunCompletionRecoverySignalRef = useRef<number | null>(null);
  const pendingRunCompletionRecoverySignalRef = useRef<number | null>(null);
  const lastRunCompletionRecoveryContextKeyRef = useRef<string | null>(null);

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
  const worktreeResolutionContextKey =
    worktreeResolutionRepoPath != null && worktreeResolutionRunId != null
      ? `${worktreeResolutionRepoPath}::${worktreeResolutionRunId}`
      : null;
  const retryWorktreeResolution = useCallback((): void => {
    setWorktreeResolutionRetryToken((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (lastRunCompletionRecoveryContextKeyRef.current !== worktreeResolutionContextKey) {
      lastRunCompletionRecoveryContextKeyRef.current = worktreeResolutionContextKey;
      lastHandledRunCompletionRecoverySignalRef.current = null;
      pendingRunCompletionRecoverySignalRef.current = null;
    }

    if (runCompletionRecoverySignal == null) {
      lastHandledRunCompletionRecoverySignalRef.current = null;
      pendingRunCompletionRecoverySignalRef.current = null;
      return;
    }

    const pendingSignal = pendingRunCompletionRecoverySignalRef.current;
    if (pendingSignal != null && !isWorktreeResolutionResolving) {
      pendingRunCompletionRecoverySignalRef.current = null;
      lastHandledRunCompletionRecoverySignalRef.current = pendingSignal;

      if (
        worktreeResolutionRepoPath == null ||
        worktreeResolutionRunId == null ||
        hasResolvedWorktreeForCurrentContext
      ) {
        return;
      }

      setWorktreeResolutionRetryToken((previous) => previous + 1);
      return;
    }

    if (lastHandledRunCompletionRecoverySignalRef.current === null) {
      lastHandledRunCompletionRecoverySignalRef.current = runCompletionRecoverySignal;
      return;
    }

    if (
      runCompletionRecoverySignal === lastHandledRunCompletionRecoverySignalRef.current ||
      runCompletionRecoverySignal === pendingRunCompletionRecoverySignalRef.current
    ) {
      return;
    }

    if (
      worktreeResolutionRepoPath == null ||
      worktreeResolutionRunId == null ||
      hasResolvedWorktreeForCurrentContext
    ) {
      lastHandledRunCompletionRecoverySignalRef.current = runCompletionRecoverySignal;
      return;
    }

    if (isWorktreeResolutionResolving) {
      pendingRunCompletionRecoverySignalRef.current = runCompletionRecoverySignal;
      return;
    }

    lastHandledRunCompletionRecoverySignalRef.current = runCompletionRecoverySignal;
    setWorktreeResolutionRetryToken((previous) => previous + 1);
  }, [
    hasResolvedWorktreeForCurrentContext,
    isWorktreeResolutionResolving,
    runCompletionRecoverySignal,
    worktreeResolutionContextKey,
    worktreeResolutionRepoPath,
    worktreeResolutionRunId,
  ]);

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
        await appQueryClient.cancelQueries({
          queryKey: taskQueryKeys.runs(worktreeResolutionRepoPath),
        });
        await appQueryClient.invalidateQueries({
          queryKey: taskQueryKeys.runs(worktreeResolutionRepoPath),
        });
        const runs = await withTimeout(
          loadRepoRunsFromQuery(appQueryClient, worktreeResolutionRepoPath),
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

  return {
    worktreePath,
    worktreeResolutionRunId,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving,
    worktreeResolutionError,
    retryWorktreeResolution,
  };
}
