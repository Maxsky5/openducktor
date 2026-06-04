import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffScope } from "../contracts";
import {
  type DiffBatchState,
  type ScopeSnapshot,
  toStatusSnapshotKey,
} from "../model/diff-data-model";
import {
  createVisibleDiffBatchStateFromCachedFullLoad,
  readCachedFullLoadSnapshot,
} from "./cached-full-load";
import { useAgentStudioDiffBatchState } from "./use-diff-batch-state";
import { type LoadDataContext, useAgentStudioDiffLoader } from "./use-diff-loader";
import { useAgentStudioDiffRequestController } from "./use-diff-request-controller";

type UseAgentStudioDiffControllerArgs = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  requestContextKey: string | null;
  shouldBlockDiffLoading: boolean;
  onLoadApplied?: (requestContextKey: string) => void;
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
  onLoadApplied,
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
    applyCachedFullResult,
    applyFullResult,
    applyScopeLoadError,
    applySummaryResult,
    consumePendingFullReload,
    pendingFullReload,
    resetControllerState,
    setBatchLoading,
    state,
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

  const { loadData, refreshActiveScope, refreshActiveScopeSummary } = useAgentStudioDiffLoader({
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    diffScopeRef,
    shouldBlockDiffLoading,
    applyCachedFullResult,
    applyFullResult,
    applyScopeLoadError,
    applySummaryResult,
    beginRequest,
    clearScopeInvalidation,
    finishRequest,
    markScopeInvalidated,
    onLoadApplied,
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

  const syncDiffRequestContext = useCallback(() => {
    const previousContextKey = requestContextKeyRef.current;
    const hasContextChanged =
      previousContextKey !== null && previousContextKey !== requestContextKey;
    requestContextKeyRef.current = requestContextKey;

    if (!repoPath) {
      if (previousContextKey !== null) {
        resetToDefaultScope();
        resetControllerState();
      }
      requestContextKeyRef.current = null;
      return;
    }

    if (hasContextChanged) {
      resetToDefaultScope();
      resetControllerState();
    }

    const scope = hasContextChanged ? "uncommitted" : diffScopeRef.current;
    const shouldHydrateFromCache = previousContextKey === null || hasContextChanged;

    if (!shouldBlockDiffLoading) {
      void loadData(true, {
        repoPath,
        targetBranch,
        workingDir,
        scope,
        requestContextKey,
        force: hasContextChanged,
        hydrateCachedFullLoad: shouldHydrateFromCache,
      });
    }
  }, [
    loadData,
    repoPath,
    requestContextKey,
    resetControllerState,
    resetToDefaultScope,
    shouldBlockDiffLoading,
    targetBranch,
    workingDir,
  ]);
  useEffect(syncDiffRequestContext, [syncDiffRequestContext]);

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
      requestContextKey,
      force: shouldForce,
    });
  }, [
    diffScope,
    isScopeInvalidated,
    loadData,
    repoPath,
    requestContextKey,
    shouldBlockDiffLoading,
    state.loadedByScope,
    targetBranch,
    workingDir,
  ]);

  const isRenderContextStale = requestContextKeyRef.current !== requestContextKey;
  const visibleDiffScope = isRenderContextStale ? "uncommitted" : diffScope;
  const visibleState = useMemo<DiffBatchState>(() => {
    if (!isRenderContextStale) {
      return state;
    }

    const cachedRenderSnapshot =
      repoPath === null
        ? null
        : readCachedFullLoadSnapshot(queryClient, {
            repoPath,
            targetBranch,
            workingDir,
            scope: visibleDiffScope,
          });
    return createVisibleDiffBatchStateFromCachedFullLoad({
      scope: visibleDiffScope,
      snapshot: cachedRenderSnapshot,
      isLoadingWhenMissing: repoPath !== null && !shouldBlockDiffLoading,
    });
  }, [
    isRenderContextStale,
    queryClient,
    repoPath,
    shouldBlockDiffLoading,
    state,
    targetBranch,
    visibleDiffScope,
    workingDir,
  ]);
  const visibleActiveScopeState = visibleState.byScope[visibleDiffScope];
  const visibleStatusSnapshotKey = useMemo(
    () => toStatusSnapshotKey(visibleActiveScopeState),
    [visibleActiveScopeState],
  );

  return {
    activeScopeState: visibleActiveScopeState,
    diffScope: visibleDiffScope,
    setDiffScope,
    state: visibleState,
    statusSnapshotKey: visibleStatusSnapshotKey,
    refreshActiveScope,
    refreshActiveScopeSummary,
  };
}
