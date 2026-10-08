import { useCallback, useMemo } from "react";
import { canonicalTargetBranch } from "@/lib/target-branch";
import type { DiffDataState, DiffScope, UseAgentStudioDiffDataInput } from "./contracts";
import { useAgentStudioDiffController } from "./loading/use-diff-controller";
import type { LoadDataMode } from "./model/diff-data-model";
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
  comparisonReference,
  preconditionError = null,
  branchIdentityKey = null,
  cacheKey = branchIdentityKey ?? "",
  enableScheduledRefresh,
}: UseAgentStudioDiffDataInput): DiffDataState & {
  refreshAllScopes: (mode?: LoadDataMode) => Promise<void>;
  refreshInactiveScope: () => Promise<void>;
  loadAllScopes: () => Promise<void>;
  loadInactiveScope: () => Promise<void>;
} {
  const targetBranch = comparisonReference ?? canonicalTargetBranch(defaultTargetBranch);
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
    cacheKey,
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
  const refreshScope = useCallback(
    async (scope: DiffScope, mode: LoadDataMode = "full", force = true): Promise<void> => {
      if (!effectiveRepoPath || shouldBlockDiffLoading || preconditionError) return;
      const refresh = mode === "summary" ? refreshActiveScopeSummary : refreshActiveScope;
      await refresh(
        {
          requestContextKey,
          repoPath: effectiveRepoPath,
          targetBranch,
          workingDir: worktreePath,
          scope,
        },
        force,
      );
    },
    [
      effectiveRepoPath,
      preconditionError,
      requestContextKey,
      refreshActiveScope,
      refreshActiveScopeSummary,
      shouldBlockDiffLoading,
      targetBranch,
      worktreePath,
    ],
  );
  const refreshAllScopes = useCallback(
    async (mode: LoadDataMode = "full"): Promise<void> => {
      await Promise.all([refreshScope("target", mode), refreshScope("uncommitted", mode)]);
    },
    [refreshScope],
  );
  const refreshInactiveScope = useCallback(
    () => refreshScope(diffScope === "target" ? "uncommitted" : "target"),
    [diffScope, refreshScope],
  );
  const loadAllScopes = useCallback(
    () =>
      Promise.all([
        refreshScope("target", "full", false),
        refreshScope("uncommitted", "full", false),
      ]).then(() => undefined),
    [refreshScope],
  );
  const loadInactiveScope = useCallback(
    () => refreshScope(diffScope === "target" ? "uncommitted" : "target", "full", false),
    [diffScope, refreshScope],
  );
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

  return useMemo<
    DiffDataState & {
      refreshAllScopes: (mode?: LoadDataMode) => Promise<void>;
      refreshInactiveScope: () => Promise<void>;
      loadAllScopes: () => Promise<void>;
      loadInactiveScope: () => Promise<void>;
    }
  >(
    () => ({
      branch: activeScopeState.branch,
      branchKnown: state.loadedByScope.uncommitted || state.loadedByScope.target,
      worktreePath,
      targetBranch,
      diffScope,
      gitConflict: activeScopeState.gitConflict ?? null,
      scopeStatesByScope: state.byScope,
      loadedScopesByScope: state.loadedByScope,
      commitsAheadBehind: activeScopeState.commitsAheadBehind,
      upstreamAheadBehind: activeScopeState.upstreamAheadBehind,
      upstreamStatus: activeScopeState.upstreamStatus,
      upstreamError: activeScopeState.upstreamError ?? null,
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
      refreshInactiveScope,
      loadAllScopes,
      loadInactiveScope,
      setDiffScope,
    }),
    [
      activeScopeState,
      displayError,
      diffScope,
      isLoading,
      refresh,
      refreshAllScopes,
      refreshInactiveScope,
      loadAllScopes,
      loadInactiveScope,
      setDiffScope,
      state.byScope,
      state.loadedByScope,
      statusSnapshotKey,
      targetBranch,
      worktreePath,
    ],
  );
}
