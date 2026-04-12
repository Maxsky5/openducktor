import { useCallback, useEffect, useRef, useState } from "react";
import { appQueryClient } from "@/lib/query-client";
import {
  loadWorktreeStatusFromQuery,
  loadWorktreeStatusSummaryFromQuery,
} from "@/state/queries/git";
import {
  type DiffBatchState,
  type LoadDataMode,
  type ScopeSnapshot,
  toScopeSnapshot,
  toScopeSummaryFields,
} from "./agent-studio-diff-data-model";
import type { DiffScope } from "./contracts";
import {
  type LoadRequestContext,
  useAgentStudioDiffBatchState,
} from "./use-agent-studio-diff-batch-state";
import { useAgentStudioDiffPolling } from "./use-agent-studio-diff-polling";
import { useAgentStudioDiffRequestController } from "./use-agent-studio-diff-request-controller";

type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
  mode?: LoadDataMode;
  force?: boolean;
  replayIfInFlight?: boolean;
};

type InFlightRequestContext = LoadRequestContext & {
  mode: LoadDataMode;
  requestKey: string;
  requestSequence: number;
  version: number;
};

type UseAgentStudioDiffControllerArgs = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  requestContextKey: string | null;
  enablePolling: boolean;
  shouldBlockDiffLoading: boolean;
};

type UseAgentStudioDiffControllerResult = {
  activeScopeState: ScopeSnapshot;
  diffScope: DiffScope;
  setDiffScope: (scope: DiffScope) => void;
  state: DiffBatchState;
  statusSnapshotKey: string | null;
  refreshActiveScope: () => Promise<void>;
  reloadActiveScope: (showLoading?: boolean) => void;
};

export function useAgentStudioDiffController({
  repoPath,
  targetBranch,
  workingDir,
  requestContextKey,
  enablePolling,
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

  const hasLoadContextChanged = useCallback(
    (path: string, nextTargetBranch: string, nextWorkingDir: string | null): boolean =>
      repoPathRef.current !== path ||
      targetBranchRef.current !== nextTargetBranch ||
      (workingDirRef.current ?? null) !== nextWorkingDir,
    [],
  );

  const runSummaryLoad = useCallback(
    async ({
      repoPath: activeRepoPath,
      requestSequence,
      scope,
      targetBranch: activeTargetBranch,
      version,
      workingDir: nextWorkingDir,
    }: InFlightRequestContext): Promise<void> => {
      const summary = await loadWorktreeStatusSummaryFromQuery(
        appQueryClient,
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir,
      );

      if (hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir)) {
        return;
      }

      if (!shouldApplyResult(scope, "summary", version)) {
        return;
      }

      const summaryFields = toScopeSummaryFields(summary);
      applySummaryResult({
        loadContext: {
          repoPath: activeRepoPath,
          scope,
          targetBranch: activeTargetBranch,
          workingDir: nextWorkingDir,
        },
        markScopeInvalidated,
        requestSequence,
        scope,
        summaryFields,
      });
    },
    [applySummaryResult, hasLoadContextChanged, markScopeInvalidated, shouldApplyResult],
  );

  const runFullLoad = useCallback(
    async ({
      force = false,
      repoPath: activeRepoPath,
      requestSequence,
      scope,
      targetBranch: activeTargetBranch,
      version,
      workingDir: nextWorkingDir,
    }: InFlightRequestContext & { force?: boolean }): Promise<void> => {
      const snapshot = await loadWorktreeStatusFromQuery(
        appQueryClient,
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir,
        { force },
      );

      if (hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir)) {
        return;
      }

      if (!shouldApplyResult(scope, "full", version)) {
        return;
      }

      applyFullResult({
        clearScopeInvalidation,
        requestSequence,
        scope,
        snapshot: toScopeSnapshot(snapshot),
      });
    },
    [applyFullResult, clearScopeInvalidation, hasLoadContextChanged, shouldApplyResult],
  );

  const loadData = useCallback(
    async (showLoading = false, context?: LoadDataContext) => {
      const activeRepoPath = context?.repoPath ?? repoPathRef.current;
      if (!activeRepoPath) {
        return;
      }

      const loadContext: LoadRequestContext = {
        repoPath: activeRepoPath,
        scope: context?.scope ?? diffScopeRef.current,
        targetBranch: context?.targetBranch ?? targetBranchRef.current,
        workingDir: context?.workingDir ?? workingDirRef.current,
      };
      const mode = context?.mode ?? "full";
      const force = context?.force === true;
      const replayIfInFlight = context?.replayIfInFlight === true;
      const requestKey = `${loadContext.repoPath}::${loadContext.targetBranch}::${loadContext.workingDir ?? ""}`;

      const beginRequestResult = beginRequest({
        scope: loadContext.scope,
        mode,
        requestKey,
        showLoading,
        replayIfInFlight,
        force,
      });
      if (beginRequestResult.kind === "skip") {
        return;
      }
      const { requestSequence, version } = beginRequestResult;
      if (showLoading) {
        setBatchLoading(true);
      }

      try {
        const inFlightRequestContext: InFlightRequestContext = {
          ...loadContext,
          mode,
          requestKey,
          requestSequence,
          version,
        };

        if (mode === "summary") {
          await runSummaryLoad(inFlightRequestContext);
          return;
        }

        await runFullLoad({ ...inFlightRequestContext, force });
      } catch (error) {
        if (
          hasLoadContextChanged(
            loadContext.repoPath,
            loadContext.targetBranch,
            loadContext.workingDir,
          )
        ) {
          return;
        }

        if (shouldApplyResult(loadContext.scope, mode, version)) {
          applyScopeLoadError({
            scope: loadContext.scope,
            mode,
            error: String(error),
          });
        }
      } finally {
        const { clearLoading, replayFullLoad } = finishRequest({
          scope: loadContext.scope,
          mode,
          requestKey,
          requestSequence,
          showLoading,
        });

        if (clearLoading) {
          setBatchLoading(false);
        }

        if (mode === "full" && replayFullLoad) {
          globalThis.queueMicrotask(() => {
            void loadData(false, {
              repoPath: loadContext.repoPath,
              targetBranch: loadContext.targetBranch,
              workingDir: loadContext.workingDir,
              scope: loadContext.scope,
              mode: "full",
              force: replayFullLoad.force,
            });
          });
        }
      }
    },
    [
      applyScopeLoadError,
      beginRequest,
      finishRequest,
      hasLoadContextChanged,
      runFullLoad,
      runSummaryLoad,
      setBatchLoading,
      shouldApplyResult,
    ],
  );

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

  const pollActiveScopeSummary = useCallback((): void => {
    if (!repoPathRef.current) {
      return;
    }

    void loadData(false, {
      repoPath: repoPathRef.current,
      targetBranch: targetBranchRef.current,
      workingDir: workingDirRef.current,
      scope: diffScopeRef.current,
      mode: "summary",
    });
  }, [loadData]);

  useAgentStudioDiffPolling({
    enablePolling,
    repoPath,
    shouldBlockDiffLoading,
    poll: pollActiveScopeSummary,
  });

  const refreshActiveScope = useCallback(async (): Promise<void> => {
    if (shouldBlockDiffLoading || !repoPathRef.current) {
      return;
    }

    await loadData(true, {
      repoPath: repoPathRef.current,
      targetBranch: targetBranchRef.current,
      workingDir: workingDirRef.current,
      scope: diffScopeRef.current,
      force: true,
      replayIfInFlight: true,
    });
  }, [loadData, shouldBlockDiffLoading]);

  const reloadActiveScope = useCallback(
    (showLoading = false): void => {
      if (shouldBlockDiffLoading || !repoPathRef.current) {
        return;
      }

      void loadData(showLoading, {
        repoPath: repoPathRef.current,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
        mode: "full",
        force: true,
        replayIfInFlight: true,
      });
    },
    [loadData, shouldBlockDiffLoading],
  );

  return {
    activeScopeState,
    diffScope,
    setDiffScope,
    state,
    statusSnapshotKey,
    refreshActiveScope,
    reloadActiveScope,
  };
}
