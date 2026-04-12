import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostClient } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { canonicalTargetBranch } from "@/lib/target-branch";
import { gitQueryKeys } from "@/state/queries/git";
import type { UseAgentStudioDiffDataInput } from "./agent-studio-diff-data-model";
import type { DiffDataState } from "./contracts";
import { useAgentStudioDiffController } from "./use-agent-studio-diff-controller";
import { useAgentStudioWorktreeResolution } from "./use-agent-studio-worktree-resolution";

export function useAgentStudioDiffData({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  defaultTargetBranch,
  preconditionError = null,
  branchIdentityKey = null,
  enablePolling,
  runCompletionRecoverySignal,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const targetBranch = canonicalTargetBranch(defaultTargetBranch);
  const effectiveRepoPath = preconditionError ? null : repoPath;
  const {
    worktreePath,
    worktreeResolutionRunId,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving,
    worktreeResolutionError,
    retryWorktreeResolution,
  } = useAgentStudioWorktreeResolution({
    repoPath: effectiveRepoPath,
    sessionWorkingDirectory,
    sessionRunId,
    ...(runCompletionRecoverySignal == null ? {} : { runCompletionRecoverySignal }),
  });

  const requestContextKey = useMemo(() => {
    if (!effectiveRepoPath) {
      return null;
    }

    return `${effectiveRepoPath}::${targetBranch}::${worktreePath ?? ""}::${worktreeResolutionRunId ?? ""}::${
      branchIdentityKey ?? ""
    }`;
  }, [branchIdentityKey, effectiveRepoPath, targetBranch, worktreePath, worktreeResolutionRunId]);

  const {
    activeScopeState,
    diffScope,
    refreshActiveScope,
    setDiffScope,
    state,
    statusSnapshotKey,
  } = useAgentStudioDiffController({
    repoPath: effectiveRepoPath,
    targetBranch,
    workingDir: worktreePath,
    requestContextKey,
    enablePolling,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
  });

  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const requestContextKeyRef = useRef(requestContextKey);
  requestContextKeyRef.current = requestContextKey;

  useEffect(() => {
    const resetContextKey = requestContextKey;
    if (requestContextKeyRef.current !== resetContextKey) {
      return;
    }

    setRefreshError(null);
    refreshQueuedRef.current = false;
    refreshPromiseRef.current = null;
    setIsRefreshing(false);
  }, [requestContextKey]);

  const refresh = useCallback((): void => {
    if (preconditionError != null) {
      return;
    }

    if (worktreeResolutionError != null) {
      retryWorktreeResolution();
      return;
    }

    if (shouldBlockDiffLoading) {
      return;
    }

    if (!effectiveRepoPath) {
      return;
    }

    refreshQueuedRef.current = true;
    if (refreshPromiseRef.current != null) {
      return;
    }

    const runRefreshLoop = async (): Promise<void> => {
      const refreshContextKey = requestContextKeyRef.current;

      while (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        if (requestContextKeyRef.current !== refreshContextKey) {
          break;
        }

        setIsRefreshing(true);

        try {
          await hostClient.gitFetchRemote(
            effectiveRepoPath,
            targetBranch,
            worktreePath ?? undefined,
          );
          await appQueryClient.invalidateQueries({
            queryKey: gitQueryKeys.branches(effectiveRepoPath),
            exact: true,
            refetchType: "none",
          });
          setRefreshError(null);
          await refreshActiveScope();
        } catch (error) {
          if (requestContextKeyRef.current === refreshContextKey) {
            setRefreshError(String(error));
          }
        } finally {
          if (requestContextKeyRef.current === refreshContextKey) {
            setIsRefreshing(false);
          }
        }
      }
    };

    const refreshPromise = runRefreshLoop().finally(() => {
      if (refreshPromiseRef.current === refreshPromise) {
        refreshPromiseRef.current = null;
      }
    });
    refreshPromiseRef.current = refreshPromise;
  }, [
    effectiveRepoPath,
    refreshActiveScope,
    preconditionError,
    retryWorktreeResolution,
    shouldBlockDiffLoading,
    targetBranch,
    worktreePath,
    worktreeResolutionError,
  ]);

  const displayError =
    preconditionError ?? worktreeResolutionError ?? refreshError ?? activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving || isRefreshing;

  return useMemo<DiffDataState>(
    () => ({
      branch: activeScopeState.branch,
      worktreePath,
      targetBranch,
      diffScope,
      scopeStatesByScope: state.byScope,
      loadedScopesByScope: state.loadedByScope,
      commitsAheadBehind: activeScopeState.commitsAheadBehind,
      upstreamAheadBehind: activeScopeState.upstreamAheadBehind,
      upstreamStatus: activeScopeState.upstreamStatus,
      fileDiffs: activeScopeState.fileDiffs,
      fileStatuses: activeScopeState.fileStatuses,
      statusSnapshotKey,
      hashVersion: activeScopeState.hashVersion,
      statusHash: activeScopeState.statusHash,
      diffHash: activeScopeState.diffHash,
      uncommittedFileCount: activeScopeState.uncommittedFileCount,
      isLoading,
      error: displayError,
      refresh,
      setDiffScope,
    }),
    [
      activeScopeState,
      displayError,
      diffScope,
      isLoading,
      refresh,
      setDiffScope,
      state.byScope,
      state.loadedByScope,
      statusSnapshotKey,
      targetBranch,
      worktreePath,
    ],
  );
}
