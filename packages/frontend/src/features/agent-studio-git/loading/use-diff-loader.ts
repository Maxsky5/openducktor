import type { UseAgentStudioDiffLoaderArgs, UseAgentStudioDiffLoaderResult } from "./load-types";

export type { LoadDataContext } from "./load-types";

import { useAgentStudioDiffLoadActions } from "./use-diff-load-actions";
import { useAgentStudioDiffLoadData } from "./use-diff-load-data";
import { useAgentStudioDiffLoadRunner } from "./use-diff-load-runner";

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
  const runner = useAgentStudioDiffLoadRunner({
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    applyFullResult,
    applySummaryResult,
    clearScopeInvalidation,
    markScopeInvalidated,
    shouldApplyResult,
  });
  const loadData = useAgentStudioDiffLoadData({
    ...refs,
    applyScopeLoadError,
    beginRequest,
    finishRequest,
    setBatchLoading,
    shouldApplyResult,
    runner,
  });
  const actions = useAgentStudioDiffLoadActions({
    ...refs,
    loadData,
    shouldBlockDiffLoading,
  });

  return {
    loadData,
    ...actions,
  };
}
