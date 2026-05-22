import { useCallback } from "react";
import type {
  DiffLoadRefs,
  DiffLoadRunner,
  InFlightRequestContext,
  LoadDataContext,
  UseAgentStudioDiffLoaderArgs,
  UseAgentStudioDiffLoaderResult,
} from "./agent-studio-diff-load-types";
import type { LoadRequestContext } from "./use-agent-studio-diff-batch-state";

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
