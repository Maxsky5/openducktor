import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedWorktreeStatusFromQuery } from "@/state/queries/git";
import type { DiffScope } from "../contracts";
import type { DiffBatchState, ScopeSnapshot } from "../model/diff-data-model";
import { toScopeSnapshot } from "../model/normalization";
import { useAgentStudioDiffBatchState } from "./use-diff-batch-state";
import { type LoadDataContext, useAgentStudioDiffLoader } from "./use-diff-loader";
import { useAgentStudioDiffRequestController } from "./use-diff-request-controller";

type UseAgentStudioDiffControllerArgs = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  requestContextKey: string | null;
  shouldBlockDiffLoading: boolean;
};

type UseAgentStudioDiffControllerResult = {
  activeScopeState: ScopeSnapshot;
  diffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;
  state: DiffBatchState;
  statusSnapshotKey: string | null;
  refreshActiveScope: (
    context?: Pick<LoadDataContext, "repoPath" | "targetBranch" | "workingDir" | "scope">,
  ) => Promise<void>;
  refreshActiveScopeSummary: (
    context?: Pick<LoadDataContext, "repoPath" | "targetBranch" | "workingDir" | "scope">,
  ) => Promise<void>;
};

export function useAgentStudioDiffController({
  repoPath,
  targetBranch,
  workingDir,
  requestContextKey,
  shouldBlockDiffLoading,
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
  const queryClient = useQueryClient();
  const [diffScope, setDiffScope] = useState<DiffScope>("uncommitted");
  const requestContextKeyRef = useRef<string | null>(null);
  const {
    beginRequest,
    clearScopeInvalidation,
    finishRequest,
    isScopeInvalidated,
    markScopeInvalidated,
    resetRequestTracking: resetRequestLifecycle,
    shouldApplyResult,
  } = useAgentStudioDiffRequestController();

  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const targetBranchRef = useRef(targetBranch);
  targetBranchRef.current = targetBranch;
  const diffScopeRef = useRef(diffScope);
  diffScopeRef.current = diffScope;
  const workingDirRef = useRef(workingDir);
  workingDirRef.current = workingDir;

  const resetRequestTracking = useCallback((): void => {
    resetRequestLifecycle();
  }, [resetRequestLifecycle]);

  const {
    activeScopeState,
    applyFullResult,
    applyScopeLoadError,
    applySummaryResult,
    consumePendingFullReload,
    pendingFullReload,
    resetControllerState,
    setBatchLoading,
    state,
    statusSnapshotKey,
  } = useAgentStudioDiffBatchState({
    diffScope,
    resetRequestTracking,
  });

  const resetToDefaultScope = useCallback((): void => {
    if (diffScopeRef.current === "uncommitted") {
      return;
    }

    diffScopeRef.current = "uncommitted";
    setDiffScope("uncommitted");
  }, []);

  const hydrateCachedWorktreeStatus = useCallback(
    (scope: DiffScope): boolean => {
      // Worktree contexts are task-keyed; repository-mode branch identity is tracked outside this query key.
      if (!repoPath || workingDir === null) {
        return false;
      }

      const cachedStatus = getCachedWorktreeStatusFromQuery(
        queryClient,
        repoPath,
        targetBranch,
        scope,
        workingDir,
      );
      if (cachedStatus === undefined) {
        return false;
      }

      applyFullResult({
        clearScopeInvalidation,
        requestSequence: 0,
        scope,
        snapshot: toScopeSnapshot(cachedStatus),
      });
      return true;
    },
    [applyFullResult, clearScopeInvalidation, queryClient, repoPath, targetBranch, workingDir],
  );

  const { loadData, refreshActiveScope, refreshActiveScopeSummary } = useAgentStudioDiffLoader({
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    diffScopeRef,
    shouldBlockDiffLoading,
    applyFullResult,
    applyScopeLoadError,
    applySummaryResult,
    beginRequest,
    clearScopeInvalidation,
    finishRequest,
    markScopeInvalidated,
    setBatchLoading,
    shouldApplyResult,
  });

  useEffect(() => {
    if (!pendingFullReload) {
      return;
    }

    consumePendingFullReload(pendingFullReload);

    void loadData(false, {
      repoPath: pendingFullReload.repoPath,
      targetBranch: pendingFullReload.targetBranch,
      workingDir: pendingFullReload.workingDir,
      scope: pendingFullReload.scope,
      mode: "full",
      force: true,
    });
  }, [consumePendingFullReload, loadData, pendingFullReload]);

  useEffect(() => {
    const previousContextKey = requestContextKeyRef.current;
    const hasContextChanged =
      previousContextKey !== null && previousContextKey !== requestContextKey;
    requestContextKeyRef.current = requestContextKey;

    if (!repoPath) {
      requestContextKeyRef.current = null;
      resetToDefaultScope();
      resetControllerState();
      return;
    }

    const scope = hasContextChanged ? "uncommitted" : diffScopeRef.current;
    const shouldHydrateFromCache = previousContextKey === null || hasContextChanged;

    if (hasContextChanged) {
      resetToDefaultScope();
      resetControllerState();
    }

    const didHydrateFromCache =
      !shouldBlockDiffLoading && shouldHydrateFromCache && hydrateCachedWorktreeStatus(scope);

    if (!shouldBlockDiffLoading) {
      void loadData(!didHydrateFromCache, {
        repoPath,
        targetBranch,
        workingDir,
        scope,
        force: hasContextChanged,
      });
    }
  }, [
    hydrateCachedWorktreeStatus,
    loadData,
    repoPath,
    requestContextKey,
    resetControllerState,
    resetToDefaultScope,
    shouldBlockDiffLoading,
    targetBranch,
    workingDir,
  ]);

  useEffect(() => {
    if (!repoPath || shouldBlockDiffLoading) {
      return;
    }

    if (state.loadedByScope[diffScope]) {
      return;
    }

    const shouldForce = isScopeInvalidated(diffScope);

    void loadData(true, {
      repoPath,
      targetBranch,
      workingDir,
      scope: diffScope,
      force: shouldForce,
    });
  }, [
    diffScope,
    isScopeInvalidated,
    loadData,
    repoPath,
    shouldBlockDiffLoading,
    state.loadedByScope,
    targetBranch,
    workingDir,
  ]);

  return {
    activeScopeState,
    diffScope,
    setDiffScope,
    state,
    statusSnapshotKey,
    refreshActiveScope,
    refreshActiveScopeSummary,
  };
}
