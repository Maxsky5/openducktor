import { useMemo } from "react";
import { canonicalTargetBranch } from "@/lib/target-branch";
import type { UseAgentStudioDiffDataInput } from "./agent-studio-diff-data-model";
import type { DiffDataState } from "./contracts";
import { useAgentStudioDiffController } from "./use-agent-studio-diff-controller";
import { useAgentStudioDiffPolling } from "./use-agent-studio-diff-polling";
import {
  type DiffRefreshContext,
  useAgentStudioDiffRefreshController,
} from "./use-agent-studio-diff-refresh-controller";
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
  const refreshContextKey = refreshContext?.requestContextKey ?? null;
  const { refresh, refreshError, isRefreshing } = useAgentStudioDiffRefreshController({
    refreshContext,
    refreshContextKey,
    preconditionError,
    shouldBlockDiffLoading,
    worktreeResolutionError,
    retryWorktreeResolution,
    isControllerLoading: state.isLoading,
    activeScopeError: activeScopeState.error,
    refreshActiveScope,
    refreshActiveScopeSummary,
  });

  useAgentStudioDiffPolling({
    enablePolling,
    repoPath: effectiveRepoPath,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
    poll: () => {
      void refresh("scheduled");
    },
  });

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
