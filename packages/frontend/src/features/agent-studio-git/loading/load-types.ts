import type { DiffScope } from "../contracts";
import type { LoadDataMode } from "../model/diff-data-model";
import type { LoadRequestContext, useAgentStudioDiffBatchState } from "./use-diff-batch-state";
import type { useAgentStudioDiffRequestController } from "./use-diff-request-controller";

export type CurrentRef<T> = {
  current: T;
};

export type LoadDataContext = {
  repoPath: string | null;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffScope;
  mode?: LoadDataMode;
  force?: boolean;
  hydrateCachedFullLoad?: boolean;
  replayIfInFlight?: boolean;
};

export type InFlightRequestContext = LoadRequestContext & {
  mode: LoadDataMode;
  requestKey: string;
  requestSequence: number;
  version: number;
};

export type DiffRefreshScopeContext = Pick<
  LoadDataContext,
  "repoPath" | "targetBranch" | "workingDir" | "scope"
>;

export type DiffBatchStateController = ReturnType<typeof useAgentStudioDiffBatchState>;
export type DiffRequestController = ReturnType<typeof useAgentStudioDiffRequestController>;

export type DiffLoadRefs = {
  repoPathRef: CurrentRef<string | null>;
  targetBranchRef: CurrentRef<string>;
  workingDirRef: CurrentRef<string | null>;
  diffScopeRef: CurrentRef<DiffScope>;
};

export type UseAgentStudioDiffLoaderArgs = DiffLoadRefs & {
  shouldBlockDiffLoading: boolean;
  applyCachedFullResult: DiffBatchStateController["applyCachedFullResult"];
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

export type UseAgentStudioDiffLoaderResult = {
  loadData: (showLoading?: boolean, context?: LoadDataContext) => Promise<void>;
  refreshActiveScope: (context?: DiffRefreshScopeContext) => Promise<void>;
  refreshActiveScopeSummary: (context?: DiffRefreshScopeContext) => Promise<void>;
};

export type DiffLoadRunner = {
  hasLoadContextChanged: (
    path: string,
    nextTargetBranch: string,
    nextWorkingDir: string | null,
  ) => boolean;
  hydrateCachedFullLoad: (context: LoadRequestContext) => boolean;
  runFullLoad: (context: InFlightRequestContext & { force?: boolean }) => Promise<void>;
  runSummaryLoad: (context: InFlightRequestContext) => Promise<void>;
};
