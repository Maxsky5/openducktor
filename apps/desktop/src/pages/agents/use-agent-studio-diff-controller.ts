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
  contextResetVersion: number;
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
}: UseAgentStudioDiffControllerArgs): UseAgentStudioDiffControllerResult {
  const [state, setState] = useState<DiffBatchState>(createInitialDiffBatchState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const [diffScope, setDiffScope] = useState<DiffScope>("target");
  const [contextResetVersion, setContextResetVersion] = useState(0);

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

  const loadData = useCallback(async (showLoading = false, context?: LoadDataContext) => {
    const path = context?.repoPath ?? repoPathRef.current;
    if (!path) {
      return;
    }

    const scope = context?.scope ?? diffScopeRef.current;
    const target = context?.targetBranch ?? targetBranchRef.current;
    const nextWorkingDir = context?.workingDir ?? workingDirRef.current;
    const mode = context?.mode ?? "full";
    const replayIfInFlight = context?.replayIfInFlight === true;
    const requestKey = `${path}::${target}::${nextWorkingDir ?? ""}`;

    if (inFlightScopeRequestRef.current[scope][mode] === requestKey) {
      if (mode === "full" && replayIfInFlight) {
        queuedFullReloadByScopeRef.current[scope] = true;
      }
      return;
    }

    if (mode === "summary" && inFlightScopeRequestRef.current[scope].full === requestKey) {
      return;
    }

    inFlightScopeRequestRef.current[scope][mode] = requestKey;
    const version = ++versionByScopeAndModeRef.current[scope][mode];
    const requestSequence = ++requestSequenceRef.current;

    if (showLoading) {
      setState((previousState) =>
        previousState.isLoading ? previousState : { ...previousState, isLoading: true },
      );
    }

    try {
      const hostWorkingDir = nextWorkingDir ?? undefined;

      if (mode === "summary") {
        const summary = await host.gitGetWorktreeStatusSummary(path, target, scope, hostWorkingDir);
        const hasContextChanged =
          repoPathRef.current !== path ||
          targetBranchRef.current !== target ||
          (workingDirRef.current ?? null) !== nextWorkingDir;
        if (hasContextChanged) {
          return;
        }

        if (versionByScopeAndModeRef.current[scope][mode] !== version) {
          return;
        }

        const summaryFields = toScopeSummaryFields(summary);
        const previousSummaryState = stateRef.current;
        const shouldReloadFullScope =
          previousSummaryState.loadedByScope[scope] &&
          (previousSummaryState.byScope[scope].hashVersion !== summaryFields.hashVersion ||
            previousSummaryState.byScope[scope].statusHash !== summaryFields.statusHash ||
            previousSummaryState.byScope[scope].diffHash !== summaryFields.diffHash);

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

        if (shouldReloadFullScope) {
          void loadData(false, {
            repoPath: path,
            targetBranch: target,
            workingDir: nextWorkingDir,
            scope,
            mode: "full",
          });
        }
        return;
      }

      const snapshot = await host.gitGetWorktreeStatus(path, target, scope, hostWorkingDir);
      const hasContextChanged =
        repoPathRef.current !== path ||
        targetBranchRef.current !== target ||
        (workingDirRef.current ?? null) !== nextWorkingDir;
      if (hasContextChanged) {
        return;
      }

      if (versionByScopeAndModeRef.current[scope][mode] !== version) {
        return;
      }

      const nextScopeSnapshot = toScopeSnapshot(snapshot);
      setState((previousState) => {
        const { nextState, nextLatestSharedSequence } = applyFullSnapshot({
          state: previousState,
          scope,
          snapshot: nextScopeSnapshot,
          requestSequence,
          latestSharedSequence: latestSharedSequenceRef.current,
        });
        latestSharedSequenceRef.current = nextLatestSharedSequence;
        return nextState;
      });
    } catch (error) {
      const hasContextChanged =
        repoPathRef.current !== path ||
        targetBranchRef.current !== target ||
        (workingDirRef.current ?? null) !== nextWorkingDir;
      if (hasContextChanged) {
        return;
      }

      if (versionByScopeAndModeRef.current[scope][mode] === version) {
        setState((previousState) =>
          applyScopeError({
            state: previousState,
            scope,
            mode,
            error: String(error),
          }),
        );
      }
    } finally {
      if (inFlightScopeRequestRef.current[scope][mode] === requestKey) {
        inFlightScopeRequestRef.current[scope][mode] = null;
      }

      if (mode === "full" && queuedFullReloadByScopeRef.current[scope]) {
        queuedFullReloadByScopeRef.current[scope] = false;
        globalThis.queueMicrotask(() => {
          void loadData(false, {
            repoPath: path,
            targetBranch: target,
            workingDir: nextWorkingDir,
            scope,
            mode: "full",
          });
        });
      }
    }
  }, []);

  useEffect(() => {
    const previousContextKey = requestContextKeyRef.current;
    const hasContextChanged =
      previousContextKey !== null && previousContextKey !== requestContextKey;
    requestContextKeyRef.current = requestContextKey;

    if (repoPath && !shouldBlockDiffLoading) {
      if (hasContextChanged) {
        resetRequestTracking();
        setState(createInitialDiffBatchState());
        setContextResetVersion((version) => version + 1);
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
        resetRequestTracking();
        setState(createInitialDiffBatchState());
        setContextResetVersion((version) => version + 1);
      }
      return;
    }

    const hadActiveContext = previousContextKey !== null;
    resetRequestTracking();
    requestContextKeyRef.current = null;
    setState(createInitialDiffBatchState());
    if (hadActiveContext) {
      setContextResetVersion((version) => version + 1);
    }
  }, [
    loadData,
    repoPath,
    requestContextKey,
    resetRequestTracking,
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
    contextResetVersion,
  };
}
