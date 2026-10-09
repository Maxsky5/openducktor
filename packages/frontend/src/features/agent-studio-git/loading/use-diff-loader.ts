import type { UseAgentStudioDiffLoaderArgs, UseAgentStudioDiffLoaderResult } from "./load-types";

export type { LoadDataContext } from "./load-types";

import { useAgentStudioDiffLoadActions } from "./use-diff-load-actions";
import { useAgentStudioDiffLoadData } from "./use-diff-load-data";
import { useAgentStudioDiffLoadRunner } from "./use-diff-load-runner";

export function useAgentStudioDiffLoader({
  cacheKey,
  requestContextKeyRef,
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
  onLoadApplied,
  setBatchLoading,
  shouldApplyResult,
}: UseAgentStudioDiffLoaderArgs): UseAgentStudioDiffLoaderResult {
  const refs = {
    requestContextKeyRef,
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    diffScopeRef,
  };
  const runner = useAgentStudioDiffLoadRunner({
    cacheKey,
    requestContextKeyRef,
    repoPathRef,
    targetBranchRef,
    workingDirRef,
    applyFullResult,
    applySummaryResult,
    clearScopeInvalidation,
    markScopeInvalidated,
    onLoadApplied,
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
