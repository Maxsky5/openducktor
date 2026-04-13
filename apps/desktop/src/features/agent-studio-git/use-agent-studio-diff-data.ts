import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostClient } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { canonicalTargetBranch } from "@/lib/target-branch";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import type { UseAgentStudioDiffDataInput } from "./agent-studio-diff-data-model";
import type { DiffDataState } from "./contracts";
import { useAgentStudioDiffController } from "./use-agent-studio-diff-controller";
import { useAgentStudioWorktreeResolution } from "./use-agent-studio-worktree-resolution";

type RefreshContext = {
  requestContextKey: string;
  repoPath: string;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffDataState["diffScope"];
};

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
  const refreshContext = useMemo<RefreshContext | null>(() => {
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

  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRefreshContextRef = useRef<RefreshContext | null>(null);
  const refreshContextRef = useRef<RefreshContext | null>(refreshContext);
  refreshContextRef.current = refreshContext;

  useEffect(() => {
    if (refreshContextKey !== (refreshContextRef.current?.requestContextKey ?? null)) {
      return;
    }

    setRefreshError(null);
    queuedRefreshContextRef.current = null;
    refreshPromiseRef.current = null;
    setIsRefreshing(false);
  }, [refreshContextKey]);

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

    const nextRefreshContext = refreshContextRef.current;
    if (nextRefreshContext == null) {
      return;
    }

    queuedRefreshContextRef.current = nextRefreshContext;
    if (refreshPromiseRef.current != null) {
      return;
    }

    const runRefreshLoop = async (): Promise<void> => {
      while (queuedRefreshContextRef.current != null) {
        const activeRefreshContext = queuedRefreshContextRef.current;
        queuedRefreshContextRef.current = null;
        const hasSameRefreshContext = (): boolean =>
          refreshContextRef.current?.requestContextKey === activeRefreshContext.requestContextKey;

        if (!hasSameRefreshContext()) {
          break;
        }

        setIsRefreshing(true);

        try {
          await hostClient.gitFetchRemote(
            activeRefreshContext.repoPath,
            activeRefreshContext.targetBranch,
            activeRefreshContext.workingDir ?? undefined,
          );
          if (!hasSameRefreshContext()) {
            break;
          }

          await invalidateRepoBranchesQuery(appQueryClient, activeRefreshContext.repoPath);
          if (!hasSameRefreshContext()) {
            break;
          }

          setRefreshError(null);
          await refreshActiveScope({
            repoPath: activeRefreshContext.repoPath,
            targetBranch: activeRefreshContext.targetBranch,
            workingDir: activeRefreshContext.workingDir,
            scope: activeRefreshContext.scope,
          });
        } catch (error) {
          if (hasSameRefreshContext()) {
            setRefreshError(String(error));
          }
        } finally {
          if (hasSameRefreshContext()) {
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
    refreshActiveScope,
    preconditionError,
    retryWorktreeResolution,
    shouldBlockDiffLoading,
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
