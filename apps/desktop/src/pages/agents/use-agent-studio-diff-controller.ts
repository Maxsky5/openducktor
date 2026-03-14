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
  onContextReset,
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
  const [controllerState, setControllerState] = useState<DiffControllerState>(
    createInitialControllerState,
  );
  const [diffScope, setDiffScope] = useState<DiffScope>("target");

  const versionByScopeAndModeRef = useRef(createVersionState());
  const requestSequenceRef = useRef(0);
  const inFlightScopeRequestRef = useRef(createInFlightState());
  const queuedFullReloadByScopeRef = useRef(createQueuedReloadState());
  const latestLoadingRequestSequenceRef = useRef<number | null>(null);
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
    latestLoadingRequestSequenceRef.current = null;
    requestSequenceRef.current = 0;
  }, []);

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

  const resetControllerState = useCallback(
    (notifyContextReset: boolean): void => {
      resetRequestTracking();
      setControllerState(createInitialControllerState());
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

  const runSummaryLoad = useCallback(
    async ({
      repoPath: activeRepoPath,
      requestSequence,
      scope,
      targetBranch: activeTargetBranch,
      version,
      workingDir: nextWorkingDir,
    }: InFlightRequestContext): Promise<void> => {
      const summary = await host.gitGetWorktreeStatusSummary(
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir ?? undefined,
      );

      if (hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir)) {
        return;
      }

      if (versionByScopeAndModeRef.current[scope].summary !== version) {
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
        const { nextState, nextLatestSharedSequence, shouldReloadFullScope } = applySummarySnapshot(
          {
            state: previousState.batchState,
            scope,
            summaryFields,
            requestSequence,
            latestSharedSequence: previousState.latestSharedSequence,
          },
        );
        const nextPendingFullReloads = shouldReloadFullScope
          ? enqueuePendingFullReload(previousState.pendingFullReloads, loadContext)
          : previousState.pendingFullReloads;

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
    [hasLoadContextChanged],
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
    [hasLoadContextChanged],
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
        latestLoadingRequestSequenceRef.current = requestSequence;
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
        if (inFlightScopeRequestRef.current[loadContext.scope][mode] === requestKey) {
          inFlightScopeRequestRef.current[loadContext.scope][mode] = null;
        }

        if (
          showLoading &&
          latestLoadingRequestSequenceRef.current === requestSequence
        ) {
          latestLoadingRequestSequenceRef.current = null;
          setBatchLoading(false);
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
    [hasLoadContextChanged, runFullLoad, runSummaryLoad, setBatchLoading],
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
    });
  }, [loadData, pendingFullReload]);

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

    if (controllerState.batchState.loadedByScope[diffScope]) {
      return;
    }

    void loadData(true, {
      repoPath,
      targetBranch,
      workingDir,
      scope: diffScope,
    });
  }, [
    controllerState.batchState.loadedByScope,
    diffScope,
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
