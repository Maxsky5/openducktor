import { useCallback, useMemo } from "react";
import { appQueryClient } from "@/lib/query-client";
import {
  loadWorktreeStatusFromQuery,
  loadWorktreeStatusSummaryFromQuery,
} from "@/state/queries/git";
import type { LoadDataMode } from "./agent-studio-diff-data-model";
import { toScopeSnapshot, toScopeSummaryFields } from "./agent-studio-diff-normalization";
import type { DiffScope } from "./contracts";
import type {
  LoadRequestContext,
  useAgentStudioDiffBatchState,
} from "./use-agent-studio-diff-batch-state";
import type { useAgentStudioDiffRequestController } from "./use-agent-studio-diff-request-controller";

type CurrentRef<T> = {
  current: T;
};

export type LoadDataContext = {
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

type DiffRefreshScopeContext = Pick<
  LoadDataContext,
  "repoPath" | "targetBranch" | "workingDir" | "scope"
>;

type DiffBatchStateController = ReturnType<typeof useAgentStudioDiffBatchState>;
type DiffRequestController = ReturnType<typeof useAgentStudioDiffRequestController>;

type DiffLoadRefs = {
  repoPathRef: CurrentRef<string | null>;
  targetBranchRef: CurrentRef<string>;
  workingDirRef: CurrentRef<string | null>;
  diffScopeRef: CurrentRef<DiffScope>;
};

type UseAgentStudioDiffLoaderArgs = DiffLoadRefs & {
  shouldBlockDiffLoading: boolean;
  applyFullResult: DiffBatchStateController["applyFullResult"];
  applyScopeLoadError: DiffBatchStateController["applyScopeLoadError"];
  applySummaryResult: DiffBatchStateController["applySummaryResult"];
  setBatchLoading: DiffBatchStateController["setBatchLoading"];
  beginRequest: DiffRequestController["beginRequest"];
  clearScopeInvalidation: DiffRequestController["clearScopeInvalidation"];
  finishRequest: DiffRequestController["finishRequest"];
  markScopeInvalidated: DiffRequestController["markScopeInvalidated"];
  shouldApplyResult: DiffRequestController["shouldApplyResult"];
};

type UseAgentStudioDiffLoaderResult = {
  loadData: (showLoading?: boolean, context?: LoadDataContext) => Promise<void>;
  refreshActiveScope: (context?: DiffRefreshScopeContext) => Promise<void>;
  refreshActiveScopeSummary: (context?: DiffRefreshScopeContext) => Promise<void>;
  reloadActiveScope: (showLoading?: boolean) => void;
};

type DiffLoadRunner = {
  hasLoadContextChanged: (
    path: string,
    nextTargetBranch: string,
    nextWorkingDir: string | null,
  ) => boolean;
  runFullLoad: (context: InFlightRequestContext & { force?: boolean }) => Promise<void>;
  runSummaryLoad: (context: InFlightRequestContext) => Promise<void>;
};

type UseDiffLoadRunnerArgs = Pick<
  UseAgentStudioDiffLoaderArgs,
  | "repoPathRef"
  | "targetBranchRef"
  | "workingDirRef"
  | "applyFullResult"
  | "applySummaryResult"
  | "clearScopeInvalidation"
  | "markScopeInvalidated"
  | "shouldApplyResult"
>;

const useDiffLoadRunner = ({
  repoPathRef,
  targetBranchRef,
  workingDirRef,
  applyFullResult,
  applySummaryResult,
  clearScopeInvalidation,
  markScopeInvalidated,
  shouldApplyResult,
}: UseDiffLoadRunnerArgs): DiffLoadRunner => {
  const hasLoadContextChanged = useCallback(
    (path: string, nextTargetBranch: string, nextWorkingDir: string | null): boolean =>
      repoPathRef.current !== path ||
      targetBranchRef.current !== nextTargetBranch ||
      (workingDirRef.current ?? null) !== nextWorkingDir,
    [repoPathRef, targetBranchRef, workingDirRef],
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
      if (
        hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) ||
        !shouldApplyResult(scope, "summary", version)
      ) {
        return;
      }
      const summary = await loadWorktreeStatusSummaryFromQuery(
        appQueryClient,
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir,
      );

      if (
        !hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) &&
        shouldApplyResult(scope, "summary", version)
      ) {
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
          summaryFields: toScopeSummaryFields(summary),
        });
      }
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
      if (
        hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) ||
        !shouldApplyResult(scope, "full", version)
      ) {
        return;
      }
      const snapshot = await loadWorktreeStatusFromQuery(
        appQueryClient,
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir,
        { force },
      );

      if (
        !hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) &&
        shouldApplyResult(scope, "full", version)
      ) {
        applyFullResult({
          clearScopeInvalidation,
          requestSequence,
          scope,
          snapshot: toScopeSnapshot(snapshot),
        });
      }
    },
    [applyFullResult, clearScopeInvalidation, hasLoadContextChanged, shouldApplyResult],
  );

  return useMemo(
    () => ({
      hasLoadContextChanged,
      runFullLoad,
      runSummaryLoad,
    }),
    [hasLoadContextChanged, runFullLoad, runSummaryLoad],
  );
};

type UseDiffLoadDataArgs = DiffLoadRefs &
  Pick<
    UseAgentStudioDiffLoaderArgs,
    | "applyScopeLoadError"
    | "beginRequest"
    | "finishRequest"
    | "setBatchLoading"
    | "shouldApplyResult"
  > & {
    runner: DiffLoadRunner;
  };

const useDiffLoadData = ({
  repoPathRef,
  targetBranchRef,
  workingDirRef,
  diffScopeRef,
  applyScopeLoadError,
  beginRequest,
  finishRequest,
  setBatchLoading,
  shouldApplyResult,
  runner,
}: UseDiffLoadDataArgs): UseAgentStudioDiffLoaderResult["loadData"] => {
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
      const requestKey = `${loadContext.repoPath}::${loadContext.targetBranch}::${
        loadContext.workingDir ?? ""
      }`;

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
          await runner.runSummaryLoad(inFlightRequestContext);
          return;
        }

        await runner.runFullLoad({ ...inFlightRequestContext, force });
      } catch (error) {
        if (
          runner.hasLoadContextChanged(
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
      diffScopeRef,
      finishRequest,
      repoPathRef,
      runner,
      setBatchLoading,
      shouldApplyResult,
      targetBranchRef,
      workingDirRef,
    ],
  );

  return loadData;
};

type UseDiffLoadActionsArgs = DiffLoadRefs & {
  loadData: UseAgentStudioDiffLoaderResult["loadData"];
  shouldBlockDiffLoading: boolean;
};

const useDiffLoadActions = ({
  repoPathRef,
  targetBranchRef,
  workingDirRef,
  diffScopeRef,
  shouldBlockDiffLoading,
  loadData,
}: UseDiffLoadActionsArgs): Omit<UseAgentStudioDiffLoaderResult, "loadData"> => {
  const refreshActiveScope = useCallback(
    async (context?: DiffRefreshScopeContext): Promise<void> => {
      const refreshContext = context ?? {
        repoPath: repoPathRef.current,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
      };

      if (shouldBlockDiffLoading || !refreshContext.repoPath) {
        return;
      }

      await loadData(true, {
        repoPath: refreshContext.repoPath,
        targetBranch: refreshContext.targetBranch,
        workingDir: refreshContext.workingDir,
        scope: refreshContext.scope,
        force: true,
        replayIfInFlight: true,
      });
    },
    [diffScopeRef, loadData, repoPathRef, shouldBlockDiffLoading, targetBranchRef, workingDirRef],
  );

  const refreshActiveScopeSummary = useCallback(
    async (context?: DiffRefreshScopeContext): Promise<void> => {
      const refreshContext = context ?? {
        repoPath: repoPathRef.current,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
      };

      if (shouldBlockDiffLoading || !refreshContext.repoPath) {
        return;
      }

      await loadData(false, {
        repoPath: refreshContext.repoPath,
        targetBranch: refreshContext.targetBranch,
        workingDir: refreshContext.workingDir,
        scope: refreshContext.scope,
        mode: "summary",
      });
    },
    [diffScopeRef, loadData, repoPathRef, shouldBlockDiffLoading, targetBranchRef, workingDirRef],
  );

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
    [diffScopeRef, loadData, repoPathRef, shouldBlockDiffLoading, targetBranchRef, workingDirRef],
  );

  return {
    refreshActiveScope,
    refreshActiveScopeSummary,
    reloadActiveScope,
  };
};

export function useAgentStudioDiffLoader({
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
}: UseAgentStudioDiffLoaderArgs): UseAgentStudioDiffLoaderResult {
  const refs = {
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    diffScopeRef,
  };
  const runner = useDiffLoadRunner({
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    applyFullResult,
    applySummaryResult,
    clearScopeInvalidation,
    markScopeInvalidated,
    shouldApplyResult,
  });
  const loadData = useDiffLoadData({
    ...refs,
    applyScopeLoadError,
    beginRequest,
    finishRequest,
    setBatchLoading,
    shouldApplyResult,
    runner,
  });
  const actions = useDiffLoadActions({
    ...refs,
    loadData,
    shouldBlockDiffLoading,
  });

  return {
    loadData,
    ...actions,
  };
}
