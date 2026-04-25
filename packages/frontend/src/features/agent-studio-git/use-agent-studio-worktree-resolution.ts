import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/shared/host";

const WORKTREE_RESOLUTION_TIMEOUT_MS = 5_000;

type WorktreeResolutionState =
  | { status: "idle" }
  | {
      status: "resolving";
      repoPath: string;
      taskId: string;
    }
  | {
      status: "resolved";
      repoPath: string;
      taskId: string;
      path: string | null;
    }
  | {
      status: "failed";
      repoPath: string;
      taskId: string;
      error: string;
    };

type UseAgentStudioWorktreeResolutionInput = {
  repoPath: string | null;
  taskId: string | null;
  sessionWorkingDirectory: string | null;
  worktreeRecoverySignal?: number;
};

type WorktreeResolutionResult = {
  worktreePath: string | null;
  worktreeResolutionTaskId: string | null;
  shouldBlockDiffLoading: boolean;
  isWorktreeResolutionResolving: boolean;
  worktreeResolutionError: string | null;
  retryWorktreeResolution: () => void;
};

const IDLE_WORKTREE_RESOLUTION_STATE: WorktreeResolutionState = { status: "idle" };

const buildWorktreeResolutionError = (taskId: string, reason?: string): string => {
  const baseMessage = `Failed to resolve task worktree path for task ${taskId}`;
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
  taskId,
  sessionWorkingDirectory,
  worktreeRecoverySignal,
}: UseAgentStudioWorktreeResolutionInput): WorktreeResolutionResult {
  const [worktreeResolutionState, setWorktreeResolutionState] = useState<WorktreeResolutionState>(
    IDLE_WORKTREE_RESOLUTION_STATE,
  );
  const [worktreeResolutionRetryToken, setWorktreeResolutionRetryToken] = useState(0);
  const lastHandledWorktreeRecoverySignalRef = useRef<number | null>(null);
  const pendingWorktreeRecoverySignalRef = useRef<number | null>(null);
  const lastWorktreeRecoveryContextKeyRef = useRef<string | null>(null);

  const directWorktreePath =
    sessionWorkingDirectory && sessionWorkingDirectory !== repoPath
      ? sessionWorkingDirectory
      : null;
  const shouldResolveWorktreeFromTask =
    directWorktreePath === null && repoPath != null && taskId != null;
  const worktreeResolutionRepoPath = shouldResolveWorktreeFromTask ? repoPath : null;
  const worktreeResolutionTaskId = shouldResolveWorktreeFromTask ? taskId : null;
  const hasResolvedWorktreeForCurrentContext =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionTaskId != null &&
    worktreeResolutionState.status === "resolved" &&
    worktreeResolutionState.repoPath === worktreeResolutionRepoPath &&
    worktreeResolutionState.taskId === worktreeResolutionTaskId;
  const resolvedWorktreePath = hasResolvedWorktreeForCurrentContext
    ? worktreeResolutionState.path
    : null;
  const worktreePath = directWorktreePath ?? resolvedWorktreePath;
  const shouldBlockDiffLoading =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionTaskId != null &&
    !hasResolvedWorktreeForCurrentContext;
  const isWorktreeResolutionResolving =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionTaskId != null &&
    worktreeResolutionState.status === "resolving" &&
    worktreeResolutionState.repoPath === worktreeResolutionRepoPath &&
    worktreeResolutionState.taskId === worktreeResolutionTaskId;
  const worktreeResolutionError =
    worktreeResolutionRepoPath != null &&
    worktreeResolutionTaskId != null &&
    worktreeResolutionState.status === "failed" &&
    worktreeResolutionState.repoPath === worktreeResolutionRepoPath &&
    worktreeResolutionState.taskId === worktreeResolutionTaskId
      ? worktreeResolutionState.error
      : null;
  const worktreeResolutionRequestKey =
    worktreeResolutionRepoPath != null && worktreeResolutionTaskId != null
      ? `${worktreeResolutionRepoPath}::${worktreeResolutionTaskId}::${worktreeResolutionRetryToken}`
      : null;
  const worktreeResolutionContextKey =
    worktreeResolutionRepoPath != null && worktreeResolutionTaskId != null
      ? `${worktreeResolutionRepoPath}::${worktreeResolutionTaskId}`
      : null;
  const retryWorktreeResolution = useCallback((): void => {
    setWorktreeResolutionRetryToken((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (lastWorktreeRecoveryContextKeyRef.current !== worktreeResolutionContextKey) {
      lastWorktreeRecoveryContextKeyRef.current = worktreeResolutionContextKey;
      lastHandledWorktreeRecoverySignalRef.current = null;
      pendingWorktreeRecoverySignalRef.current = null;
    }

    if (worktreeRecoverySignal == null) {
      lastHandledWorktreeRecoverySignalRef.current = null;
      pendingWorktreeRecoverySignalRef.current = null;
      return;
    }

    const pendingSignal = pendingWorktreeRecoverySignalRef.current;
    if (pendingSignal != null && !isWorktreeResolutionResolving) {
      pendingWorktreeRecoverySignalRef.current = null;
      lastHandledWorktreeRecoverySignalRef.current = pendingSignal;

      if (
        worktreeResolutionRepoPath == null ||
        worktreeResolutionTaskId == null ||
        hasResolvedWorktreeForCurrentContext
      ) {
        return;
      }

      setWorktreeResolutionRetryToken((previous) => previous + 1);
      return;
    }

    if (lastHandledWorktreeRecoverySignalRef.current === null) {
      lastHandledWorktreeRecoverySignalRef.current = worktreeRecoverySignal;
      return;
    }

    if (
      worktreeRecoverySignal === lastHandledWorktreeRecoverySignalRef.current ||
      worktreeRecoverySignal === pendingWorktreeRecoverySignalRef.current
    ) {
      return;
    }

    if (
      worktreeResolutionRepoPath == null ||
      worktreeResolutionTaskId == null ||
      hasResolvedWorktreeForCurrentContext
    ) {
      lastHandledWorktreeRecoverySignalRef.current = worktreeRecoverySignal;
      return;
    }

    if (isWorktreeResolutionResolving) {
      pendingWorktreeRecoverySignalRef.current = worktreeRecoverySignal;
      return;
    }

    lastHandledWorktreeRecoverySignalRef.current = worktreeRecoverySignal;
    setWorktreeResolutionRetryToken((previous) => previous + 1);
  }, [
    hasResolvedWorktreeForCurrentContext,
    isWorktreeResolutionResolving,
    worktreeRecoverySignal,
    worktreeResolutionContextKey,
    worktreeResolutionRepoPath,
    worktreeResolutionTaskId,
  ]);

  useEffect(() => {
    if (!worktreeResolutionRequestKey || !worktreeResolutionRepoPath || !worktreeResolutionTaskId) {
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
        previous.taskId === worktreeResolutionTaskId
      ) {
        return previous;
      }

      return {
        status: "resolving",
        repoPath: worktreeResolutionRepoPath,
        taskId: worktreeResolutionTaskId,
      };
    });

    void (async () => {
      try {
        const taskWorktree = await withTimeout(
          host.taskWorktreeGet(worktreeResolutionRepoPath, worktreeResolutionTaskId),
          WORKTREE_RESOLUTION_TIMEOUT_MS,
          `Timed out after ${WORKTREE_RESOLUTION_TIMEOUT_MS}ms while loading task worktree.`,
        );
        if (!isCurrent) {
          return;
        }

        if (!taskWorktree) {
          const missingWorktreeError = buildWorktreeResolutionError(
            worktreeResolutionTaskId,
            "Task worktree is not available.",
          );
          setWorktreeResolutionState((previous) => {
            if (
              previous.status === "failed" &&
              previous.repoPath === worktreeResolutionRepoPath &&
              previous.taskId === worktreeResolutionTaskId &&
              previous.error === missingWorktreeError
            ) {
              return previous;
            }

            return {
              status: "failed",
              repoPath: worktreeResolutionRepoPath,
              taskId: worktreeResolutionTaskId,
              error: missingWorktreeError,
            };
          });
          return;
        }

        const nextPath =
          taskWorktree.workingDirectory !== worktreeResolutionRepoPath
            ? taskWorktree.workingDirectory
            : null;

        setWorktreeResolutionState((previous) => {
          if (
            previous.status === "resolved" &&
            previous.repoPath === worktreeResolutionRepoPath &&
            previous.taskId === worktreeResolutionTaskId &&
            previous.path === nextPath
          ) {
            return previous;
          }

          return {
            status: "resolved",
            repoPath: worktreeResolutionRepoPath,
            taskId: worktreeResolutionTaskId,
            path: nextPath,
          };
        });
      } catch (cause) {
        if (!isCurrent) {
          return;
        }

        const resolutionError = buildWorktreeResolutionError(
          worktreeResolutionTaskId,
          errorMessage(cause),
        );
        setWorktreeResolutionState({
          status: "failed",
          repoPath: worktreeResolutionRepoPath,
          taskId: worktreeResolutionTaskId,
          error: resolutionError,
        });
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [worktreeResolutionRepoPath, worktreeResolutionRequestKey, worktreeResolutionTaskId]);

  return {
    worktreePath,
    worktreeResolutionTaskId,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving,
    worktreeResolutionError,
    retryWorktreeResolution,
  };
}
