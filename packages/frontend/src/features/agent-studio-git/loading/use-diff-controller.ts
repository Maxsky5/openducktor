import type { GitWorktreeStatus } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { gitQueryKeys } from "@/state/queries/git";
import { toScopeSnapshot } from "../model/normalization";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DiffScope } from "../contracts";
import {
  createInitialDiffBatchState,
  type DiffBatchState,
  type ScopeSnapshot,
  toStatusSnapshotKey,
} from "../model/diff-data-model";
import { useAgentStudioDiffBatchState } from "./use-diff-batch-state";
import { useAgentStudioDiffLoader } from "./use-diff-loader";
import type { UseAgentStudioDiffLoaderResult } from "./load-types";
import { useAgentStudioDiffRequestController } from "./use-diff-request-controller";

type UseAgentStudioDiffControllerArgs = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  requestContextKey: string | null;
  cacheKey: string;
  shouldBlockDiffLoading: boolean;
  onLoadApplied?: (requestContextKey: string) => void;
};

type UseAgentStudioDiffControllerResult = {
  activeScopeState: ScopeSnapshot;
  diffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;
  state: DiffBatchState;
  statusSnapshotKey: string | null;
  refreshActiveScope: UseAgentStudioDiffLoaderResult["refreshActiveScope"];
  refreshActiveScopeSummary: UseAgentStudioDiffLoaderResult["refreshActiveScopeSummary"];
};

export function useAgentStudioDiffController({
  repoPath,
  targetBranch,
  workingDir,
  requestContextKey,
  cacheKey,
  shouldBlockDiffLoading,
  onLoadApplied,
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
  const queryClient = useQueryClient();
  const cachedState = useMemo(() => {
    const cached = createInitialDiffBatchState();
    if (!repoPath || !requestContextKey || shouldBlockDiffLoading) return cached;
    for (const scope of ["uncommitted", "target"] as const) {
      const reference = scope === "uncommitted" ? "HEAD" : targetBranch;
      const full = queryClient.getQueryState<GitWorktreeStatus>(
        gitQueryKeys.worktreeStatus(repoPath, reference, scope, workingDir, cacheKey),
      );
      if (full?.status !== "success" || full.isInvalidated || !full.data) continue;
      cached.byScope[scope] = toScopeSnapshot(full.data);
      cached.loadedByScope[scope] = true;
    }
    return cached;
  }, [
    cacheKey,
    queryClient,
    repoPath,
    requestContextKey,
    shouldBlockDiffLoading,
    targetBranch,
    workingDir,
  ]);
  useLayoutEffect(() => {
    if (!repoPath) return;
    // Cancel unfinished reads on exit so a later activation cannot join an old read.
    return () => {
      for (const scope of ["uncommitted", "target"] as const) {
        const reference = scope === "uncommitted" ? "HEAD" : targetBranch;
        void queryClient.cancelQueries({
          queryKey: gitQueryKeys.worktreeStatus(repoPath, reference, scope, workingDir, cacheKey),
          exact: true,
        });
        void queryClient.cancelQueries({
          queryKey: gitQueryKeys.worktreeStatusSummary(
            repoPath,
            reference,
            scope,
            workingDir,
            cacheKey,
          ),
          exact: true,
        });
      }
    };
  }, [cacheKey, queryClient, repoPath, requestContextKey, targetBranch, workingDir]);
  const [scopeSelection, setScopeSelection] = useState<{
    contextKey: string | null;
    scope: DiffScope;
  }>({ contextKey: requestContextKey, scope: "uncommitted" });
  const diffScope =
    scopeSelection.contextKey === requestContextKey ? scopeSelection.scope : "uncommitted";
  const setDiffScope = useCallback(
    (scope: DiffScope) => setScopeSelection({ contextKey: requestContextKey, scope }),
    [requestContextKey],
  );
  const controllerContextKeyRef = useRef<string | null>(null);
  const requestContextKeyRef = useRef(requestContextKey);
  const {
    beginRequest,
    clearScopeInvalidation,
    finishRequest,
    isScopeInvalidated,
    markScopeInvalidated,
    resetRequestTracking,
    shouldApplyResult,
  } = useAgentStudioDiffRequestController();

  const repoPathRef = useRef(repoPath);
  const targetBranchRef = useRef(targetBranch);
  const diffScopeRef = useRef(diffScope);
  const workingDirRef = useRef(workingDir);
  // Late reads must fail these guards when the new view commits, before passive effects run.
  useLayoutEffect(() => {
    requestContextKeyRef.current = requestContextKey;
    repoPathRef.current = repoPath;
    targetBranchRef.current = targetBranch;
    diffScopeRef.current = diffScope;
    workingDirRef.current = workingDir;
  }, [requestContextKey, repoPath, targetBranch, diffScope, workingDir]);

  const {
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

  const { loadData, refreshActiveScope, refreshActiveScopeSummary } = useAgentStudioDiffLoader({
    cacheKey,
    requestContextKeyRef,
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
      requestContextKey: pendingFullReload.requestContextKey,
      repoPath: pendingFullReload.repoPath,
      targetBranch: pendingFullReload.targetBranch,
      workingDir: pendingFullReload.workingDir,
      scope: pendingFullReload.scope,
      mode: "full",
      force: true,
    });
  }, [consumePendingFullReload, loadData, pendingFullReload]);

  const loadCurrentContext = useCallback(() => {
    const previousContextKey = controllerContextKeyRef.current;
    const hasContextChanged =
      previousContextKey !== null && previousContextKey !== requestContextKey;
    controllerContextKeyRef.current = requestContextKey;

    if (!repoPath) {
      if (previousContextKey !== null) {
        resetControllerState();
      }
      controllerContextKeyRef.current = null;
      return;
    }

    if (hasContextChanged || previousContextKey === null) {
      resetControllerState(cachedState);
    }

    const scope = hasContextChanged ? "uncommitted" : diffScopeRef.current;

    if (!shouldBlockDiffLoading) {
      void loadData(true, {
        repoPath,
        targetBranch,
        workingDir,
        scope,
        requestContextKey,
        force: false,
      });
    }
  }, [
    cachedState,
    loadData,
    repoPath,
    requestContextKey,
    resetControllerState,
    shouldBlockDiffLoading,
    targetBranch,
    workingDir,
  ]);
  useEffect(loadCurrentContext, [loadCurrentContext]);

  useEffect(() => {
    if (!repoPath || shouldBlockDiffLoading) {
      return;
    }

    if (state.loadedByScope[diffScope]) {
      return;
    }

    const shouldForce = isScopeInvalidated(diffScope) && !cachedState.loadedByScope[diffScope];

    void loadData(true, {
      repoPath,
      targetBranch,
      workingDir,
      scope: diffScope,
      requestContextKey,
      force: shouldForce,
    });
  }, [
    cachedState,
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

  const isRenderContextStale = controllerContextKeyRef.current !== requestContextKey;
  const visibleDiffScope = isRenderContextStale ? "uncommitted" : diffScope;
  const visibleState = useMemo<DiffBatchState>(() => {
    if (!isRenderContextStale) {
      return state;
    }

    return {
      ...cachedState,
      isLoading:
        repoPath !== null &&
        !shouldBlockDiffLoading &&
        !cachedState.loadedByScope[visibleDiffScope],
    };
  }, [
    cachedState,
    isRenderContextStale,
    repoPath,
    shouldBlockDiffLoading,
    state,
    visibleDiffScope,
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
