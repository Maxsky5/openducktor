import { useCallback } from "react";
import type {
  DiffLoadRefs,
  DiffRefreshScopeContext,
  UseAgentStudioDiffLoaderResult,
} from "./agent-studio-diff-load-types";

type UseDiffLoadActionsArgs = DiffLoadRefs & {
  loadData: UseAgentStudioDiffLoaderResult["loadData"];
  shouldBlockDiffLoading: boolean;
};

export const useAgentStudioDiffLoadActions = ({
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

  return {
    refreshActiveScope,
    refreshActiveScopeSummary,
  };
};
