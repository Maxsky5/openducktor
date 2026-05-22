import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffBatchState, ScopeSnapshot } from "./agent-studio-diff-data-model";
import type { DiffScope } from "./contracts";
import { useAgentStudioDiffBatchState } from "./use-agent-studio-diff-batch-state";
import { type LoadDataContext, useAgentStudioDiffLoader } from "./use-agent-studio-diff-loader";
import { useAgentStudioDiffRequestController } from "./use-agent-studio-diff-request-controller";

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
  reloadActiveScope: (showLoading?: boolean) => void;
};

export function useAgentStudioDiffController({
  repoPath,
  targetBranch,
  workingDir,
  requestContextKey,
  shouldBlockDiffLoading,
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
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

  const { loadData, refreshActiveScope, refreshActiveScopeSummary, reloadActiveScope } =
    useAgentStudioDiffLoader({
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

    if (repoPath && !shouldBlockDiffLoading) {
      if (hasContextChanged) {
        resetToDefaultScope();
        resetControllerState();
      }

      void loadData(true, {
        repoPath,
        targetBranch,
        workingDir,
        scope: hasContextChanged ? "uncommitted" : diffScopeRef.current,
        force: hasContextChanged,
      });
      return;
    }

    if (repoPath) {
      if (hasContextChanged) {
        resetToDefaultScope();
        resetControllerState();
      }
      return;
    }

    requestContextKeyRef.current = null;
    resetToDefaultScope();
    resetControllerState();
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
    reloadActiveScope,
  };
}
