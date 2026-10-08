import { useCallback } from "react";
import type {
  DiffLoadRefs,
  DiffRefreshScopeContext,
  UseAgentStudioDiffLoaderResult,
} from "./load-types";

type UseDiffLoadActionsArgs = DiffLoadRefs & {
  loadData: UseAgentStudioDiffLoaderResult["loadData"];
  shouldBlockDiffLoading: boolean;
};

export const useAgentStudioDiffLoadActions = ({
  requestContextKeyRef,
  repoPathRef,
  targetBranchRef,
  workingDirRef,
  diffScopeRef,
  shouldBlockDiffLoading,
  loadData,
}: UseDiffLoadActionsArgs): Omit<UseAgentStudioDiffLoaderResult, "loadData"> => {
  const refreshActiveScope = useCallback(
    async (context?: DiffRefreshScopeContext, force = true): Promise<void> => {
      const refreshContext = context ?? {
        requestContextKey: requestContextKeyRef.current,
        repoPath: repoPathRef.current,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
      };

      if (shouldBlockDiffLoading || !refreshContext.repoPath) {
        return;
      }

      await loadData(true, {
        requestContextKey: refreshContext.requestContextKey,
        repoPath: refreshContext.repoPath,
        targetBranch: refreshContext.targetBranch,
        workingDir: refreshContext.workingDir,
        scope: refreshContext.scope,
        force,
        replayIfInFlight: force,
      });
    },
    [
      requestContextKeyRef,
      diffScopeRef,
      loadData,
      repoPathRef,
      shouldBlockDiffLoading,
      targetBranchRef,
      workingDirRef,
    ],
  );

  const refreshActiveScopeSummary = useCallback(
    async (context?: DiffRefreshScopeContext): Promise<void> => {
      const refreshContext = context ?? {
        requestContextKey: requestContextKeyRef.current,
        repoPath: repoPathRef.current,
        targetBranch: targetBranchRef.current,
        workingDir: workingDirRef.current,
        scope: diffScopeRef.current,
      };

      if (shouldBlockDiffLoading || !refreshContext.repoPath) {
        return;
      }

      await loadData(false, {
        requestContextKey: refreshContext.requestContextKey,
        repoPath: refreshContext.repoPath,
        targetBranch: refreshContext.targetBranch,
        workingDir: refreshContext.workingDir,
        scope: refreshContext.scope,
        mode: "summary",
      });
    },
    [
      requestContextKeyRef,
      diffScopeRef,
      loadData,
      repoPathRef,
      shouldBlockDiffLoading,
      targetBranchRef,
      workingDirRef,
    ],
  );

  return {
    refreshActiveScope,
    refreshActiveScopeSummary,
  };
};
