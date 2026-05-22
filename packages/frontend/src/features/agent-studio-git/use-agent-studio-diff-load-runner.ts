import { useCallback, useMemo } from "react";
import { appQueryClient } from "@/lib/query-client";
import {
  loadWorktreeStatusFromQuery,
  loadWorktreeStatusSummaryFromQuery,
} from "@/state/queries/git";
import type {
  DiffLoadRunner,
  InFlightRequestContext,
  UseAgentStudioDiffLoaderArgs,
} from "./agent-studio-diff-load-types";
import { toScopeSnapshot, toScopeSummaryFields } from "./agent-studio-diff-normalization";

type UseDiffLoadRunnerArgs = Pick<
  UseAgentStudioDiffLoaderArgs,
  | "repoPathRef"
  | "targetBranchRef"
  | "workingDirRef"
  | "applyFullResult"
  | "applySummaryResult"
  | "clearScopeInvalidation"
  | "markScopeInvalidated"
  | "shouldApplyResult"
>;

export const useAgentStudioDiffLoadRunner = ({
  repoPathRef,
  targetBranchRef,
  workingDirRef,
  applyFullResult,
  applySummaryResult,
  clearScopeInvalidation,
  markScopeInvalidated,
  shouldApplyResult,
}: UseDiffLoadRunnerArgs): DiffLoadRunner => {
  const hasLoadContextChanged = useCallback(
    (path: string, nextTargetBranch: string, nextWorkingDir: string | null): boolean =>
      repoPathRef.current !== path ||
      targetBranchRef.current !== nextTargetBranch ||
      (workingDirRef.current ?? null) !== nextWorkingDir,
    [repoPathRef, targetBranchRef, workingDirRef],
  );

  const runSummaryLoad = useCallback(
    async ({
      repoPath: activeRepoPath,
      requestSequence,
      scope,
      targetBranch: activeTargetBranch,
      version,
      workingDir: nextWorkingDir,
    }: InFlightRequestContext): Promise<void> => {
      if (
        hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) ||
        !shouldApplyResult(scope, "summary", version)
      ) {
        return;
      }

      const summary = await loadWorktreeStatusSummaryFromQuery(
        appQueryClient,
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir,
      );

      if (
        !hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) &&
        shouldApplyResult(scope, "summary", version)
      ) {
        applySummaryResult({
          loadContext: {
            repoPath: activeRepoPath,
            scope,
            targetBranch: activeTargetBranch,
            workingDir: nextWorkingDir,
          },
          markScopeInvalidated,
          requestSequence,
          scope,
          summaryFields: toScopeSummaryFields(summary),
        });
      }
    },
    [applySummaryResult, hasLoadContextChanged, markScopeInvalidated, shouldApplyResult],
  );

  const runFullLoad = useCallback(
    async ({
      force = false,
      repoPath: activeRepoPath,
      requestSequence,
      scope,
      targetBranch: activeTargetBranch,
      version,
      workingDir: nextWorkingDir,
    }: InFlightRequestContext & { force?: boolean }): Promise<void> => {
      if (
        hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) ||
        !shouldApplyResult(scope, "full", version)
      ) {
        return;
      }

      const snapshot = await loadWorktreeStatusFromQuery(
        appQueryClient,
        activeRepoPath,
        activeTargetBranch,
        scope,
        nextWorkingDir,
        { force },
      );

      if (
        !hasLoadContextChanged(activeRepoPath, activeTargetBranch, nextWorkingDir) &&
        shouldApplyResult(scope, "full", version)
      ) {
        applyFullResult({
          clearScopeInvalidation,
          requestSequence,
          scope,
          snapshot: toScopeSnapshot(snapshot),
        });
      }
    },
    [applyFullResult, clearScopeInvalidation, hasLoadContextChanged, shouldApplyResult],
  );

  return useMemo(
    () => ({
      hasLoadContextChanged,
      runFullLoad,
      runSummaryLoad,
    }),
    [hasLoadContextChanged, runFullLoad, runSummaryLoad],
  );
};
