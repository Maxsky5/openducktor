import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@/state/operations/host";
import {
  ALL_LOAD_DATA_MODES,
  ALL_SCOPES,
  applyFullSnapshot,
  applyScopeError,
  applySummarySnapshot,
  createInitialDiffBatchState,
  type DiffBatchState,
  type DiffScope,
  getSummaryReloadDecision,
  type LoadDataMode,
  type ScopeSnapshot,
  toScopeSnapshot,
  toScopeSummaryFields,
  toStatusSnapshotKey,
} from "./agent-studio-diff-data-model";

const POLL_INTERVAL_MS = 30_000;

type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
  mode?: LoadDataMode;
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

type UseAgentStudioDiffControllerArgs = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  requestContextKey: string | null;
  enablePolling: boolean;
  shouldBlockDiffLoading: boolean;
  onContextReset?: () => void;
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

const createVersionState = (): Record<DiffScope, Record<LoadDataMode, number>> => ({
  target: { full: 0, summary: 0 },
  uncommitted: { full: 0, summary: 0 },
});

const createInFlightState = (): Record<DiffScope, Record<LoadDataMode, string | null>> => ({
  target: { full: null, summary: null },
  uncommitted: { full: null, summary: null },
});

const createQueuedReloadState = (): Record<DiffScope, boolean> => ({
  target: false,
  uncommitted: false,
});

export function useAgentStudioDiffController({
  repoPath,
  targetBranch,
  workingDir,
  requestContextKey,
  enablePolling,
  shouldBlockDiffLoading,
  onContextReset,
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
  const [state, setState] = useState<DiffBatchState>(createInitialDiffBatchState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [diffScope, setDiffScope] = useState<DiffScope>("target");

  const versionByScopeAndModeRef = useRef(createVersionState());
  const requestSequenceRef = useRef(0);
  const latestSharedSequenceRef = useRef(0);
  const inFlightScopeRequestRef = useRef(createInFlightState());
  const queuedFullReloadByScopeRef = useRef(createQueuedReloadState());
  const requestContextKeyRef = useRef<string | null>(null);

  const repoPathRef = useRef(repoPath);
  repoPathRef.current = repoPath;
  const targetBranchRef = useRef(targetBranch);
  targetBranchRef.current = targetBranch;
  const diffScopeRef = useRef(diffScope);
  diffScopeRef.current = diffScope;
  const workingDirRef = useRef(workingDir);
  workingDirRef.current = workingDir;

  const resetRequestTracking = useCallback((): void => {
    for (const scope of ALL_SCOPES) {
      for (const mode of ALL_LOAD_DATA_MODES) {
        versionByScopeAndModeRef.current[scope][mode] += 1;
        inFlightScopeRequestRef.current[scope][mode] = null;
      }
      queuedFullReloadByScopeRef.current[scope] = false;
    }
    requestSequenceRef.current = 0;
    latestSharedSequenceRef.current = 0;
  }, []);

  const resetControllerState = useCallback(
    (notifyContextReset: boolean): void => {
      resetRequestTracking();
      setState(createInitialDiffBatchState());
      if (notifyContextReset) {
        onContextReset?.();
      }
    },
    [onContextReset, resetRequestTracking],
  );

  const hasLoadContextChanged = useCallback(
    (path: string, nextTargetBranch: string, nextWorkingDir: string | null): boolean =>
      repoPathRef.current !== path ||
      targetBranchRef.current !== nextTargetBranch ||
      (workingDirRef.current ?? null) !== nextWorkingDir,
    [],
  );

  const commitSummaryLoad = useCallback(
    (
      scope: DiffScope,
      summaryFields: ReturnType<typeof toScopeSummaryFields>,
      requestSequence: number,
    ) => {
      const shouldReloadFullScope = getSummaryReloadDecision(
        stateRef.current,
        scope,
        summaryFields,
      ).shouldReloadFullScope;

      setState((previousState) => {
        const { nextState, nextLatestSharedSequence } = applySummarySnapshot({
          state: previousState,
          scope,
          summaryFields,
          requestSequence,
          latestSharedSequence: latestSharedSequenceRef.current,
        });
        latestSharedSequenceRef.current = nextLatestSharedSequence;
        return nextState;
      });

      return shouldReloadFullScope;
    },
    [],
  );

  const commitFullLoad = useCallback(
    (scope: DiffScope, snapshot: ScopeSnapshot, requestSequence: number): void => {
      setState((previousState) => {
        const { nextState, nextLatestSharedSequence } = applyFullSnapshot({
          state: previousState,
          scope,
          snapshot,
          requestSequence,
          latestSharedSequence: latestSharedSequenceRef.current,
        });
        latestSharedSequenceRef.current = nextLatestSharedSequence;
        return nextState;
      });
    },
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
    }: InFlightRequestContext): Promise<boolean> => {
      const summary = await host.gitGetWorktreeStatusSummary(
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir ?? undefined,
      );

      if (hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir)) {
        return false;
      }

      if (versionByScopeAndModeRef.current[scope].summary !== version) {
        return false;
      }

      return commitSummaryLoad(scope, toScopeSummaryFields(summary), requestSequence);
    },
    [commitSummaryLoad, hasLoadContextChanged],
  );

  const runFullLoad = useCallback(
    async ({
      repoPath: activeRepoPath,
      requestSequence,
      scope,
      targetBranch: activeTargetBranch,
      version,
      workingDir: nextWorkingDir,
    }: InFlightRequestContext): Promise<void> => {
      const snapshot = await host.gitGetWorktreeStatus(
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir ?? undefined,
      );

      if (hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir)) {
        return;
      }

      if (versionByScopeAndModeRef.current[scope].full !== version) {
        return;
      }

      commitFullLoad(scope, toScopeSnapshot(snapshot), requestSequence);
    },
    [commitFullLoad, hasLoadContextChanged],
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
      const replayIfInFlight = context?.replayIfInFlight === true;
      const requestKey = `${loadContext.repoPath}::${loadContext.targetBranch}::${loadContext.workingDir ?? ""}`;

      if (inFlightScopeRequestRef.current[loadContext.scope][mode] === requestKey) {
        if (mode === "full" && replayIfInFlight) {
          queuedFullReloadByScopeRef.current[loadContext.scope] = true;
        }
        return;
      }

      if (
        mode === "summary" &&
        inFlightScopeRequestRef.current[loadContext.scope].full === requestKey
      ) {
        return;
      }

      inFlightScopeRequestRef.current[loadContext.scope][mode] = requestKey;
      const version = ++versionByScopeAndModeRef.current[loadContext.scope][mode];
      const requestSequence = ++requestSequenceRef.current;

      if (showLoading) {
        setState((previousState) =>
          previousState.isLoading ? previousState : { ...previousState, isLoading: true },
        );
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
          const shouldReloadFullScope = await runSummaryLoad(inFlightRequestContext);
          if (shouldReloadFullScope) {
            void loadData(false, {
              repoPath: loadContext.repoPath,
              targetBranch: loadContext.targetBranch,
              workingDir: loadContext.workingDir,
              scope: loadContext.scope,
              mode: "full",
            });
          }
          return;
        }

        await runFullLoad(inFlightRequestContext);
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

        if (versionByScopeAndModeRef.current[loadContext.scope][mode] === version) {
          setState((previousState) =>
            applyScopeError({
              state: previousState,
              scope: loadContext.scope,
              mode,
              error: String(error),
            }),
          );
        }
      } finally {
        if (inFlightScopeRequestRef.current[loadContext.scope][mode] === requestKey) {
          inFlightScopeRequestRef.current[loadContext.scope][mode] = null;
        }

        if (mode === "full" && queuedFullReloadByScopeRef.current[loadContext.scope]) {
          queuedFullReloadByScopeRef.current[loadContext.scope] = false;
          globalThis.queueMicrotask(() => {
            void loadData(false, {
              repoPath: loadContext.repoPath,
              targetBranch: loadContext.targetBranch,
              workingDir: loadContext.workingDir,
              scope: loadContext.scope,
              mode: "full",
            });
          });
        }
      }
    },
    [hasLoadContextChanged, runFullLoad, runSummaryLoad],
  );

  useEffect(() => {
    const previousContextKey = requestContextKeyRef.current;
    const hasContextChanged =
      previousContextKey !== null && previousContextKey !== requestContextKey;
    requestContextKeyRef.current = requestContextKey;

    if (repoPath && !shouldBlockDiffLoading) {
      if (hasContextChanged) {
        resetControllerState(true);
      }

      void loadData(true, {
        repoPath,
        targetBranch,
        workingDir,
        scope: diffScopeRef.current,
      });
      return;
    }

    if (repoPath) {
      if (hasContextChanged) {
        resetControllerState(true);
      }
      return;
    }

    requestContextKeyRef.current = null;
    resetControllerState(previousContextKey !== null);
  }, [
    loadData,
    repoPath,
    requestContextKey,
    resetControllerState,
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

    void loadData(true, {
      repoPath,
      targetBranch,
      workingDir,
      scope: diffScope,
    });
  }, [
    diffScope,
    loadData,
    repoPath,
    shouldBlockDiffLoading,
    state.loadedByScope,
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
        replayIfInFlight: true,
      });
    },
    [loadData, shouldBlockDiffLoading],
  );

  const activeScopeState = state.byScope[diffScope];

  return {
    activeScopeState,
    diffScope,
    setDiffScope,
    state,
    statusSnapshotKey: toStatusSnapshotKey(activeScopeState),
    refreshActiveScope,
    reloadActiveScope,
  };
}
