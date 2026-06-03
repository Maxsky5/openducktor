import { useCallback, useMemo } from "react";
import { canonicalTargetBranch } from "@/lib/target-branch";
import type { DiffDataState, UseAgentStudioDiffDataInput } from "./contracts";
import { useAgentStudioDiffController } from "./loading/use-diff-controller";
import type { DiffRefreshContext } from "./refresh/refresh-types";
import { useAgentStudioDiffPolling } from "./refresh/use-diff-polling";
import {
  useAgentStudioDiffRefreshController,
  useAgentStudioDiffRefreshUiState,
} from "./refresh/use-diff-refresh-controller";

export function useAgentStudioDiffData({
  repoPath,
  worktreePath,
  worktreeResolutionTaskId,
  shouldBlockDiffLoading,
  isWorktreeResolutionResolving,
  worktreeResolutionError,
  retryWorktreeResolution,
  defaultTargetBranch,
  preconditionError = null,
  branchIdentityKey = null,
  enablePolling,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const targetBranch = canonicalTargetBranch(defaultTargetBranch);
  const effectiveRepoPath = preconditionError ? null : repoPath;

  const requestContextKey = useMemo(() => {
    if (!effectiveRepoPath) {
      return null;
    }

    return `${effectiveRepoPath}::${targetBranch}::${worktreePath ?? ""}::${worktreeResolutionTaskId ?? ""}::${
      branchIdentityKey ?? ""
    }`;
  }, [branchIdentityKey, effectiveRepoPath, targetBranch, worktreePath, worktreeResolutionTaskId]);
  const refreshContextKey = requestContextKey;
  const refreshUi = useAgentStudioDiffRefreshUiState(refreshContextKey);

  const {
    activeScopeState,
    diffScope,
    refreshActiveScope,
    refreshActiveScopeSummary,
    setDiffScope,
    state,
    statusSnapshotKey,
  } = useAgentStudioDiffController({
    repoPath: effectiveRepoPath,
    targetBranch,
    workingDir: worktreePath,
    requestContextKey,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
    onLoadApplied: refreshUi.clearRefreshErrorForContext,
  });
  const refreshContext = useMemo<DiffRefreshContext | null>(() => {
    if (requestContextKey == null || effectiveRepoPath == null) {
      return null;
    }

    return {
      requestContextKey,
      repoPath: effectiveRepoPath,
      targetBranch,
      workingDir: worktreePath,
      scope: diffScope,
    };
  }, [diffScope, effectiveRepoPath, requestContextKey, targetBranch, worktreePath]);
  const { refresh } = useAgentStudioDiffRefreshController({
    refreshContext,
    preconditionError,
    shouldBlockDiffLoading,
    worktreeResolutionError,
    retryWorktreeResolution,
    refreshActiveScope,
    refreshActiveScopeSummary,
    refreshUi,
  });
  const scheduledPoll = useCallback(() => {
    void refresh("scheduled");
  }, [refresh]);

  useAgentStudioDiffPolling({
    enablePolling,
    repoPath: effectiveRepoPath,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
    poll: scheduledPoll,
  });

  const displayError =
    preconditionError ??
    worktreeResolutionError ??
    refreshUi.refreshError ??
    activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving || refreshUi.isRefreshing;

  return useMemo<DiffDataState>(
    () => ({
      branch: activeScopeState.branch,
      worktreePath,
      targetBranch,
      diffScope,
      gitConflict: activeScopeState.gitConflict ?? null,
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
