import type {
  UseAgentStudioDiffLoaderArgs,
  UseAgentStudioDiffLoaderResult,
} from "./agent-studio-diff-load-types";

export type { LoadDataContext } from "./agent-studio-diff-load-types";

import { useAgentStudioDiffLoadActions } from "./use-agent-studio-diff-load-actions";
import { useAgentStudioDiffLoadData } from "./use-agent-studio-diff-load-data";
import { useAgentStudioDiffLoadRunner } from "./use-agent-studio-diff-load-runner";

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
