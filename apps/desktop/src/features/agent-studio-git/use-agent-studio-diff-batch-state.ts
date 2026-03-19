import { useCallback, useMemo, useRef, useState } from "react";
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
  const [controllerState, setControllerStateState] = useState<DiffControllerState>(
    createInitialControllerState,
  );
  const controllerStateRef = useRef(controllerState);

  const commitControllerState = useCallback((nextState: DiffControllerState): void => {
    if (nextState === controllerStateRef.current) {
      return;
    }

    controllerStateRef.current = nextState;
    setControllerStateState(nextState);
  }, []);

  const setBatchLoading = useCallback(
    (isLoading: boolean): void => {
      const previousState = controllerStateRef.current;
      const nextState =
        previousState.batchState.isLoading === isLoading
          ? previousState
          : {
              ...previousState,
              batchState: {
                ...previousState.batchState,
                isLoading,
              },
            };
      commitControllerState(nextState);
    },
    [commitControllerState],
  );

  const resetControllerState = useCallback((): void => {
    resetRequestTracking();
    commitControllerState(createInitialControllerState());
  }, [commitControllerState, resetRequestTracking]);

  const applySummaryResult = useCallback(
    ({
      loadContext,
      markScopeInvalidated,
      requestSequence,
      scope,
      summaryFields,
    }: ApplySummaryResultArgs): void => {
      const previousState = controllerStateRef.current;
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
        commitControllerState(
          nextState === previousState.batchState &&
            nextLatestSharedSequence === previousState.latestSharedSequence
            ? previousState
            : {
                ...previousState,
                batchState: nextState,
                latestSharedSequence: nextLatestSharedSequence,
              },
        );
        return;
      }

      const nextPendingFullReloads = enqueuePendingFullReload(
        previousState.pendingFullReloads,
        loadContext,
      );

      commitControllerState(
        nextState === previousState.batchState &&
          nextLatestSharedSequence === previousState.latestSharedSequence &&
          nextPendingFullReloads === previousState.pendingFullReloads
          ? previousState
          : {
              batchState: nextState,
              latestSharedSequence: nextLatestSharedSequence,
              pendingFullReloads: nextPendingFullReloads,
            },
      );
    },
    [commitControllerState],
  );

  const applyFullResult = useCallback(
    ({ clearScopeInvalidation, requestSequence, scope, snapshot }: ApplyFullResultArgs): void => {
      clearScopeInvalidation(scope);
      const previousState = controllerStateRef.current;
      const { nextLatestSharedSequence, nextState } = applyFullSnapshot({
        state: previousState.batchState,
        scope,
        snapshot,
        requestSequence,
        latestSharedSequence: previousState.latestSharedSequence,
      });

      commitControllerState(
        nextState === previousState.batchState &&
          nextLatestSharedSequence === previousState.latestSharedSequence
          ? previousState
          : {
              ...previousState,
              batchState: nextState,
              latestSharedSequence: nextLatestSharedSequence,
            },
      );
    },
    [commitControllerState],
  );

  const applyScopeLoadError = useCallback(
    ({ error, mode, scope }: ApplyScopeLoadErrorArgs): void => {
      const previousState = controllerStateRef.current;
      const nextBatchState = applyScopeError({
        state: previousState.batchState,
        scope,
        mode,
        error,
      });

      commitControllerState(
        nextBatchState === previousState.batchState
          ? previousState
          : {
              ...previousState,
              batchState: nextBatchState,
            },
      );
    },
    [commitControllerState],
  );

  const pendingFullReload = controllerState.pendingFullReloads[0] ?? null;

  const consumePendingFullReload = useCallback(
    (loadContext: LoadRequestContext): void => {
      const previousState = controllerStateRef.current;
      const nextPendingFullReload = previousState.pendingFullReloads[0];
      if (!nextPendingFullReload || !sameLoadRequestContext(nextPendingFullReload, loadContext)) {
        return;
      }

      commitControllerState({
        ...previousState,
        pendingFullReloads: previousState.pendingFullReloads.slice(1),
      });
    },
    [commitControllerState],
  );

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
