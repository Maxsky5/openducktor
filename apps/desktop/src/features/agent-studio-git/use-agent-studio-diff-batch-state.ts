import { useCallback, useMemo, useState } from "react";
import {
  applyFullSnapshot,
  applyScopeError,
  applySummarySnapshot,
  createInitialDiffBatchState,
  type DiffBatchState,
  type LoadDataMode,
  type ScopeSnapshot,
  type ScopeSummaryFields,
  toStatusSnapshotKey,
} from "./agent-studio-diff-data-model";
import type { DiffScope } from "./contracts";

export type LoadRequestContext = {
  repoPath: string;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
};

type DiffControllerState = {
  batchState: DiffBatchState;
  latestSharedSequence: number;
  pendingFullReloads: LoadRequestContext[];
};

type ApplySummaryResultArgs = {
  loadContext: LoadRequestContext;
  scope: DiffScope;
  summaryFields: ScopeSummaryFields;
  requestSequence: number;
  markScopeInvalidated: (scope: DiffScope) => void;
};

type ApplyFullResultArgs = {
  scope: DiffScope;
  snapshot: ScopeSnapshot;
  requestSequence: number;
  clearScopeInvalidation: (scope: DiffScope) => void;
};

type ApplyScopeLoadErrorArgs = {
  scope: DiffScope;
  mode: LoadDataMode;
  error: string;
};

type UseAgentStudioDiffBatchStateArgs = {
  diffScope: DiffScope;
  resetRequestTracking: () => void;
};

type UseAgentStudioDiffBatchStateResult = {
  activeScopeState: ScopeSnapshot;
  pendingFullReload: LoadRequestContext | null;
  state: DiffBatchState;
  statusSnapshotKey: string | null;
  applyFullResult: (args: ApplyFullResultArgs) => void;
  applyScopeLoadError: (args: ApplyScopeLoadErrorArgs) => void;
  applySummaryResult: (args: ApplySummaryResultArgs) => void;
  consumePendingFullReload: (loadContext: LoadRequestContext) => void;
  resetControllerState: () => void;
  setBatchLoading: (isLoading: boolean) => void;
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

export function useAgentStudioDiffBatchState({
  diffScope,
  resetRequestTracking,
}: UseAgentStudioDiffBatchStateArgs): UseAgentStudioDiffBatchStateResult {
  const [controllerState, setControllerState] = useState<DiffControllerState>(
    createInitialControllerState,
  );

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

  const applySummaryResult = useCallback(
    ({
      loadContext,
      markScopeInvalidated,
      requestSequence,
      scope,
      summaryFields,
    }: ApplySummaryResultArgs): void => {
      setControllerState((previousState) => {
        const { invalidatedScopes, nextLatestSharedSequence, nextState, shouldReloadFullScope } =
          applySummarySnapshot({
            state: previousState.batchState,
            scope,
            summaryFields,
            requestSequence,
            latestSharedSequence: previousState.latestSharedSequence,
          });

        for (const invalidatedScope of invalidatedScopes) {
          markScopeInvalidated(invalidatedScope);
        }

        if (!shouldReloadFullScope) {
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
        }

        const nextPendingFullReloads = enqueuePendingFullReload(
          previousState.pendingFullReloads,
          loadContext,
        );

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
    [],
  );

  const applyFullResult = useCallback(
    ({ clearScopeInvalidation, requestSequence, scope, snapshot }: ApplyFullResultArgs): void => {
      clearScopeInvalidation(scope);
      setControllerState((previousState) => {
        const { nextLatestSharedSequence, nextState } = applyFullSnapshot({
          state: previousState.batchState,
          scope,
          snapshot,
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
    [],
  );

  const applyScopeLoadError = useCallback(
    ({ error, mode, scope }: ApplyScopeLoadErrorArgs): void => {
      setControllerState((previousState) => {
        const nextBatchState = applyScopeError({
          state: previousState.batchState,
          scope,
          mode,
          error,
        });

        if (nextBatchState === previousState.batchState) {
          return previousState;
        }

        return {
          ...previousState,
          batchState: nextBatchState,
        };
      });
    },
    [],
  );

  const pendingFullReload = controllerState.pendingFullReloads[0] ?? null;

  const consumePendingFullReload = useCallback((loadContext: LoadRequestContext): void => {
    setControllerState((previousState) => {
      const nextPendingFullReload = previousState.pendingFullReloads[0];
      if (!nextPendingFullReload || !sameLoadRequestContext(nextPendingFullReload, loadContext)) {
        return previousState;
      }

      return {
        ...previousState,
        pendingFullReloads: previousState.pendingFullReloads.slice(1),
      };
    });
  }, []);

  const activeScopeState = controllerState.batchState.byScope[diffScope];
  const statusSnapshotKey = useMemo(
    () => toStatusSnapshotKey(activeScopeState),
    [activeScopeState],
  );

  return {
    activeScopeState,
    pendingFullReload,
    state: controllerState.batchState,
    statusSnapshotKey,
    applyFullResult,
    applyScopeLoadError,
    applySummaryResult,
    consumePendingFullReload,
    resetControllerState,
    setBatchLoading,
  };
}
