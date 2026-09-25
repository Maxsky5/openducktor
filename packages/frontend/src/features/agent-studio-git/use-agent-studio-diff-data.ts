import { useCallback, useMemo } from "react";
import { canonicalTargetBranch } from "@/lib/target-branch";
import type { DiffDataState, UseAgentStudioDiffDataInput } from "./contracts";
import { useAgentStudioDiffController } from "./loading/use-diff-controller";
import type { DiffRefreshContext } from "./refresh/refresh-types";
import {
  useAgentStudioDiffRefreshController,
  useAgentStudioDiffRefreshUiState,
} from "./refresh/use-diff-refresh-controller";
import { useAgentStudioDiffVisibilityRefresh } from "./refresh/use-diff-visibility-refresh";

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
  enableScheduledRefresh,
}: UseAgentStudioDiffDataInput): DiffDataState & { refreshAllScopes: () => Promise<void> } {
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
  const refreshAllScopes = useCallback(async (): Promise<void> => {
    if (!effectiveRepoPath || shouldBlockDiffLoading || preconditionError) return;
    await Promise.all(
      (["target", "uncommitted"] as const).map((scope) =>
        refreshActiveScope({
          repoPath: effectiveRepoPath,
          targetBranch,
          workingDir: worktreePath,
          scope,
        }),
      ),
    );
  }, [
    effectiveRepoPath,
    preconditionError,
    refreshActiveScope,
    shouldBlockDiffLoading,
    targetBranch,
    worktreePath,
  ]);
  const scheduledPoll = useCallback(() => {
    void refresh("scheduled");
  }, [refresh]);

  useAgentStudioDiffVisibilityRefresh({
    enableScheduledRefresh,
    repoPath: effectiveRepoPath,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
    refresh: scheduledPoll,
  });

  const displayError =
    preconditionError ??
    worktreeResolutionError ??
    refreshUi.refreshError ??
    activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving || refreshUi.isRefreshing;

  return useMemo<DiffDataState & { refreshAllScopes: () => Promise<void> }>(
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
      refreshAllScopes,
      setDiffScope,
    }),
    [
      activeScopeState,
      displayError,
      diffScope,
      isLoading,
      refresh,
      refreshAllScopes,
      setDiffScope,
      state.byScope,
      state.loadedByScope,
      statusSnapshotKey,
      targetBranch,
      worktreePath,
    ],
  );
}
