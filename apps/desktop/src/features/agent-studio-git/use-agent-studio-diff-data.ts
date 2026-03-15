import { useCallback, useMemo, useState } from "react";
import { canonicalTargetBranch } from "@/lib/target-branch";
import type { UseAgentStudioDiffDataInput } from "./agent-studio-diff-data-model";
import type { DiffDataState } from "./contracts";
import { useAgentStudioDiffController } from "./use-agent-studio-diff-controller";
import { useAgentStudioWorktreeResolution } from "./use-agent-studio-worktree-resolution";

export type { DiffDataState, DiffScope } from "./contracts";

export function useAgentStudioDiffData({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  defaultTargetBranch,
  branchIdentityKey = null,
  enablePolling,
  runCompletionRecoverySignal,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const targetBranch = canonicalTargetBranch(defaultTargetBranch);
  const {
    worktreePath,
    worktreeResolutionRunId,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving,
    worktreeResolutionError,
    retryWorktreeResolution,
  } = useAgentStudioWorktreeResolution({
    repoPath,
    sessionWorkingDirectory,
    sessionRunId,
    ...(runCompletionRecoverySignal == null ? {} : { runCompletionRecoverySignal }),
  });

  const requestContextKey = useMemo(() => {
    if (!repoPath) {
      return null;
    }

    return `${repoPath}::${targetBranch}::${worktreePath ?? ""}::${worktreeResolutionRunId ?? ""}::${
      branchIdentityKey ?? ""
    }`;
  }, [branchIdentityKey, repoPath, targetBranch, worktreePath, worktreeResolutionRunId]);

  const [selectedFileState, setSelectedFileState] = useState<string | null>(null);
  const handleContextReset = useCallback((): void => {
    setSelectedFileState(null);
  }, []);

  const {
    activeScopeState,
    diffScope,
    refreshActiveScope,
    reloadActiveScope,
    setDiffScope,
    state,
    statusSnapshotKey,
  } = useAgentStudioDiffController({
    repoPath,
    targetBranch,
    workingDir: worktreePath,
    requestContextKey,
    enablePolling,
    shouldBlockDiffLoading,
    onContextReset: handleContextReset,
  });

  const selectedFile = selectedFileState;

  const refresh = useCallback((): void => {
    if (worktreeResolutionError != null) {
      retryWorktreeResolution();
      return;
    }

    if (shouldBlockDiffLoading) {
      return;
    }

    refreshActiveScope();
  }, [
    refreshActiveScope,
    retryWorktreeResolution,
    shouldBlockDiffLoading,
    worktreeResolutionError,
  ]);

  const setSelectedFile = useCallback(
    (path: string | null): void => {
      setSelectedFileState(path);

      if (path === null || shouldBlockDiffLoading) {
        return;
      }

      reloadActiveScope();
    },
    [reloadActiveScope, shouldBlockDiffLoading],
  );

  const displayError = worktreeResolutionError ?? activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving;

  return useMemo<DiffDataState>(
    () => ({
      branch: activeScopeState.branch,
      worktreePath,
      targetBranch,
      diffScope,
      commitsAheadBehind: activeScopeState.commitsAheadBehind,
      upstreamAheadBehind: activeScopeState.upstreamAheadBehind,
      upstreamStatus: activeScopeState.upstreamStatus,
      fileDiffs: activeScopeState.fileDiffs,
      fileStatuses: activeScopeState.fileStatuses,
      statusSnapshotKey,
      uncommittedFileCount: activeScopeState.uncommittedFileCount,
      isLoading,
      error: displayError,
      refresh,
      selectedFile,
      setSelectedFile,
      setDiffScope,
    }),
    [
      activeScopeState,
      displayError,
      diffScope,
      isLoading,
      refresh,
      selectedFile,
      setDiffScope,
      setSelectedFile,
      statusSnapshotKey,
      targetBranch,
      worktreePath,
    ],
  );
}
