import { useCallback, useEffect, useRef, useState } from "react";
import { appQueryClient } from "@/lib/query-client";
import {
  loadWorktreeStatusFromQuery,
  loadWorktreeStatusSummaryFromQuery,
} from "@/state/queries/git";
import {
  applyFullSnapshot,
  applyScopeError,
  applySummarySnapshot,
  createInitialDiffBatchState,
  type DiffBatchState,
  type LoadDataMode,
  type ScopeSnapshot,
  toScopeSnapshot,
  toScopeSummaryFields,
  toStatusSnapshotKey,
} from "./agent-studio-diff-data-model";
import type { DiffScope } from "./contracts";
import { useAgentStudioDiffRequestController } from "./use-agent-studio-diff-request-controller";

const POLL_INTERVAL_MS = 30_000;

type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
  mode?: LoadDataMode;
  force?: boolean;
  replayIfInFlight?: boolean;
};

type LoadRequestContext = Required<Pick<LoadDataContext, "targetBranch" | "scope">> & {
  repoPath: string;
  workingDir: string | null;
};

type InFlightRequestContext = LoadRequestContext & {
  mode: LoadDataMode;
  requestKey: string;
  requestSequence: number;
  version: number;
};

type DiffControllerState = {
  batchState: DiffBatchState;
  latestSharedSequence: number;
  pendingFullReloads: LoadRequestContext[];
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
  refreshActiveScope: () => void;
  reloadActiveScope: (showLoading?: boolean) => void;
};

const createInitialControllerState = (): DiffControllerState => ({
  batchState: createInitialDiffBatchState(),
  latestSharedSequence: 0,
  pendingFullReloads: [],
});

const sameLoadRequestContext = (left: LoadRequestContext, right: LoadRequestContext): boolean =>
  left.repoPath === right.repoPath &&
  left.scope === right.scope &&
  left.targetBranch === right.targetBranch &&
  left.workingDir === right.workingDir;

const enqueuePendingFullReload = (
  queue: LoadRequestContext[],
  nextLoadContext: LoadRequestContext,
): LoadRequestContext[] => {
  if (queue.some((loadContext) => sameLoadRequestContext(loadContext, nextLoadContext))) {
    return queue;
  }
  return [...queue, nextLoadContext];
};

export function useAgentStudioDiffController({
  repoPath,
  targetBranch,
  workingDir,
  requestContextKey,
  enablePolling,
  shouldBlockDiffLoading,
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
  const [controllerState, setControllerState] = useState<DiffControllerState>(
    createInitialControllerState,
  );
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

  const setBatchLoading = useCallback((isLoading: boolean): void => {
    setControllerState((previousState) =>
      previousState.batchState.isLoading === isLoading
        ? previousState
        : {
            ...previousState,
            batchState: {
              ...previousState.batchState,
              isLoading,
            },
          },
    );
  }, []);

  const resetControllerState = useCallback((): void => {
    resetRequestTracking();
    setControllerState(createInitialControllerState());
  }, [resetRequestTracking]);

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
      const loadContext: LoadRequestContext = {
        repoPath: activeRepoPath,
        scope,
        targetBranch: activeTargetBranch,
        workingDir: nextWorkingDir,
      };

      setControllerState((previousState) => {
        const { invalidatedScopes, nextState, nextLatestSharedSequence, shouldReloadFullScope } =
          applySummarySnapshot({
            state: previousState.batchState,
            scope,
            summaryFields,
            requestSequence,
            latestSharedSequence: previousState.latestSharedSequence,
          });
        const nextPendingFullReloads = shouldReloadFullScope
          ? enqueuePendingFullReload(previousState.pendingFullReloads, loadContext)
          : previousState.pendingFullReloads;

        for (const invalidatedScope of invalidatedScopes) {
          markScopeInvalidated(invalidatedScope);
        }

        if (
          nextState === previousState.batchState &&
          nextLatestSharedSequence === previousState.latestSharedSequence &&
          nextPendingFullReloads === previousState.pendingFullReloads
        ) {
          return previousState;
        }

        return {
          batchState: nextState,
          latestSharedSequence: nextLatestSharedSequence,
          pendingFullReloads: nextPendingFullReloads,
        };
      });
    },
    [hasLoadContextChanged, markScopeInvalidated, shouldApplyResult],
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

      clearScopeInvalidation(scope);
      const nextScopeSnapshot = toScopeSnapshot(snapshot);
      setControllerState((previousState) => {
        const { nextState, nextLatestSharedSequence } = applyFullSnapshot({
          state: previousState.batchState,
          scope,
          snapshot: nextScopeSnapshot,
          requestSequence,
          latestSharedSequence: previousState.latestSharedSequence,
        });

        if (
          nextState === previousState.batchState &&
          nextLatestSharedSequence === previousState.latestSharedSequence
        ) {
          return previousState;
        }

        return {
          ...previousState,
          batchState: nextState,
          latestSharedSequence: nextLatestSharedSequence,
        };
      });
    },
    [clearScopeInvalidation, hasLoadContextChanged, shouldApplyResult],
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
          setControllerState((previousState) => {
            const nextBatchState = applyScopeError({
              state: previousState.batchState,
              scope: loadContext.scope,
              mode,
              error: String(error),
            });

            if (nextBatchState === previousState.batchState) {
              return previousState;
            }

            return {
              ...previousState,
              batchState: nextBatchState,
            };
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
      beginRequest,
      finishRequest,
      hasLoadContextChanged,
      runFullLoad,
      runSummaryLoad,
      setBatchLoading,
      shouldApplyResult,
    ],
  );

  const pendingFullReload = controllerState.pendingFullReloads[0];

  useEffect(() => {
    if (!pendingFullReload) {
      return;
    }

    setControllerState((previousState) => {
      const nextPendingFullReload = previousState.pendingFullReloads[0];
      if (
        !nextPendingFullReload ||
        !sameLoadRequestContext(nextPendingFullReload, pendingFullReload)
      ) {
        return previousState;
      }

      return {
        ...previousState,
        pendingFullReloads: previousState.pendingFullReloads.slice(1),
      };
    });

    void loadData(false, {
      repoPath: pendingFullReload.repoPath,
      targetBranch: pendingFullReload.targetBranch,
      workingDir: pendingFullReload.workingDir,
      scope: pendingFullReload.scope,
      mode: "full",
      force: true,
    });
  }, [loadData, pendingFullReload]);

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

    if (controllerState.batchState.loadedByScope[diffScope]) {
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
    controllerState.batchState.loadedByScope,
    diffScope,
    isScopeInvalidated,
    loadData,
    repoPath,
    shouldBlockDiffLoading,
    targetBranch,
    workingDir,
  ]);

  useEffect(() => {
    if (!enablePolling || !repoPath || shouldBlockDiffLoading) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      void loadData(false, {
        repoPath,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
        mode: "summary",
      });
    }, POLL_INTERVAL_MS);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [enablePolling, loadData, repoPath, shouldBlockDiffLoading]);

  const refreshActiveScope = useCallback((): void => {
    if (shouldBlockDiffLoading || !repoPathRef.current) {
      return;
    }

    void loadData(true, {
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

  const activeScopeState = controllerState.batchState.byScope[diffScope];

  return {
    activeScopeState,
    diffScope,
    setDiffScope,
    state: controllerState.batchState,
    statusSnapshotKey: toStatusSnapshotKey(activeScopeState),
    refreshActiveScope,
    reloadActiveScope,
  };
}
