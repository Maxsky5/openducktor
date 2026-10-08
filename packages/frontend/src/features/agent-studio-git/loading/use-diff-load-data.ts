import { useCallback } from "react";
import type {
  DiffLoadRefs,
  DiffLoadRunner,
  InFlightRequestContext,
  LoadDataContext,
  UseAgentStudioDiffLoaderArgs,
  UseAgentStudioDiffLoaderResult,
} from "./load-types";
import type { LoadRequestContext } from "./use-diff-batch-state";

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

export const useAgentStudioDiffLoadData = ({
  requestContextKeyRef,
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
    async (showLoading = false, context?: LoadDataContext): Promise<void> => {
      const activeRepoPath = context ? context.repoPath : repoPathRef.current;
      const requestContextKey = context ? context.requestContextKey : requestContextKeyRef.current;
      if (!activeRepoPath || requestContextKey === null) {
        return;
      }

      const loadContext: LoadRequestContext = {
        requestContextKey,
        repoPath: activeRepoPath,
        scope: context?.scope ?? diffScopeRef.current,
        targetBranch: context?.targetBranch ?? targetBranchRef.current,
        workingDir: context ? context.workingDir : workingDirRef.current,
      };
      if (runner.isStale(loadContext)) return;
      const mode = context?.mode ?? "full";
      const force = context?.force === true;
      const replayIfInFlight = context?.replayIfInFlight === true;

      const beginRequestResult = beginRequest({
        scope: loadContext.scope,
        mode,
        requestKey: requestContextKey,
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
        const request: InFlightRequestContext = {
          ...loadContext,
          requestSequence,
          version,
        };

        if (mode === "summary") {
          await runner.runSummaryLoad(request);
          return;
        }

        await runner.runFullLoad({ ...request, force });
      } catch (error) {
        if (runner.isStale(loadContext)) {
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
        if (!runner.isStale(loadContext)) {
          const { clearLoading, replayFullLoad } = finishRequest({
            scope: loadContext.scope,
            mode,
            requestKey: requestContextKey,
            requestSequence,
            showLoading,
          });

          if (clearLoading) {
            setBatchLoading(false);
          }

          if (mode === "full" && replayFullLoad) {
            queueMicrotask(() => {
              void loadData(false, {
                requestContextKey: loadContext.requestContextKey,
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
      }
    },
    [
      applyScopeLoadError,
      beginRequest,
      diffScopeRef,
      finishRequest,
      repoPathRef,
      requestContextKeyRef,
      runner,
      setBatchLoading,
      shouldApplyResult,
      targetBranchRef,
      workingDirRef,
    ],
  );

  return loadData;
};
