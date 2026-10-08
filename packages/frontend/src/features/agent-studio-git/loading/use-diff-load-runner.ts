import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
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
        { branchKey: requestContextKey },
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
          markScopeInvalidated,
          requestSequence,
          scope,
          summaryFields: toScopeSummaryFields(summary),
        });
        onLoadApplied?.(requestContextKey);
      }
    },
    [
      applySummaryResult,
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
        { force, branchKey: requestContextKey },
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
