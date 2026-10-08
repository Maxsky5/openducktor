import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  gitQueryKeys,
  loadWorktreeStatusFromQuery,
  loadWorktreeStatusSummaryFromQuery,
} from "@/state/queries/git";
import { toScopeSnapshot, toScopeSummaryFields } from "../model/normalization";
import type {
  DiffLoadRunner,
  InFlightRequestContext,
  UseAgentStudioDiffLoaderArgs,
} from "./load-types";
import type { LoadRequestContext } from "./use-diff-batch-state";

type UseDiffLoadRunnerArgs = Pick<
  UseAgentStudioDiffLoaderArgs,
  | "cacheKey"
  | "repoPathRef"
  | "requestContextKeyRef"
  | "targetBranchRef"
  | "workingDirRef"
  | "applyFullResult"
  | "applySummaryResult"
  | "clearScopeInvalidation"
  | "markScopeInvalidated"
  | "onLoadApplied"
  | "shouldApplyResult"
>;

export const useAgentStudioDiffLoadRunner = ({
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
}: UseDiffLoadRunnerArgs): DiffLoadRunner => {
  const queryClient = useQueryClient();
  const isStale = useCallback(
    (context: LoadRequestContext): boolean =>
      requestContextKeyRef.current !== context.requestContextKey ||
      repoPathRef.current !== context.repoPath ||
      targetBranchRef.current !== context.targetBranch ||
      workingDirRef.current !== context.workingDir,
    [requestContextKeyRef, repoPathRef, targetBranchRef, workingDirRef],
  );

  const runSummaryLoad = useCallback(
    async (context: InFlightRequestContext): Promise<void> => {
      const {
        repoPath,
        requestContextKey,
        requestSequence,
        scope,
        targetBranch,
        version,
        workingDir,
      } = context;
      if (isStale(context) || !shouldApplyResult(scope, "summary", version)) {
        return;
      }

      const summary = await loadWorktreeStatusSummaryFromQuery(
        queryClient,
        repoPath,
        scope === "uncommitted" ? "HEAD" : targetBranch,
        scope,
        workingDir,
        { branchKey: cacheKey },
      );

      if (!isStale(context) && shouldApplyResult(scope, "summary", version)) {
        applySummaryResult({
          loadContext: {
            requestContextKey,
            repoPath,
            scope,
            targetBranch,
            workingDir,
          },
          markScopeInvalidated: (invalidatedScope) => {
            markScopeInvalidated(invalidatedScope);
            void queryClient.invalidateQueries({
              queryKey: gitQueryKeys.worktreeStatus(
                repoPath,
                invalidatedScope === "uncommitted" ? "HEAD" : targetBranch,
                invalidatedScope,
                workingDir,
                cacheKey,
              ),
              exact: true,
              refetchType: "none",
            });
          },
          requestSequence,
          scope,
          summaryFields: toScopeSummaryFields(summary),
        });
        onLoadApplied?.(requestContextKey);
      }
    },
    [
      applySummaryResult,
      cacheKey,
      isStale,
      markScopeInvalidated,
      onLoadApplied,
      queryClient,
      shouldApplyResult,
    ],
  );

  const runFullLoad = useCallback(
    async (context: InFlightRequestContext & { force?: boolean }): Promise<void> => {
      const {
        force = false,
        repoPath,
        requestContextKey,
        requestSequence,
        scope,
        targetBranch,
        version,
        workingDir,
      } = context;
      if (isStale(context) || !shouldApplyResult(scope, "full", version)) {
        return;
      }

      const snapshot = await loadWorktreeStatusFromQuery(
        queryClient,
        repoPath,
        scope === "uncommitted" ? "HEAD" : targetBranch,
        scope,
        workingDir,
        { force, branchKey: cacheKey, staleTime: Infinity },
      );

      if (!isStale(context) && shouldApplyResult(scope, "full", version)) {
        applyFullResult({
          clearScopeInvalidation,
          requestSequence,
          scope,
          snapshot: toScopeSnapshot(snapshot),
        });
        onLoadApplied?.(requestContextKey);
      }
    },
    [
      applyFullResult,
      cacheKey,
      clearScopeInvalidation,
      isStale,
      onLoadApplied,
      queryClient,
      shouldApplyResult,
    ],
  );

  return useMemo(
    () => ({
      isStale,
      runFullLoad,
      runSummaryLoad,
    }),
    [isStale, runFullLoad, runSummaryLoad],
  );
};
