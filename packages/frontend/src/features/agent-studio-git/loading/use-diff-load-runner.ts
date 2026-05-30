import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  loadWorktreeStatusFromQuery,
  loadWorktreeStatusSummaryFromQuery,
} from "@/state/queries/git";
import { toScopeSnapshot, toScopeSummaryFields } from "../model/normalization";
import { readCachedFullLoadSnapshot } from "./cached-full-load";
import type {
  DiffLoadRunner,
  InFlightRequestContext,
  UseAgentStudioDiffLoaderArgs,
} from "./load-types";
import type { LoadRequestContext } from "./use-diff-batch-state";

type UseDiffLoadRunnerArgs = Pick<
  UseAgentStudioDiffLoaderArgs,
  | "repoPathRef"
  | "targetBranchRef"
  | "workingDirRef"
  | "applyCachedFullResult"
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
  applyCachedFullResult,
  applyFullResult,
  applySummaryResult,
  clearScopeInvalidation,
  markScopeInvalidated,
  shouldApplyResult,
}: UseDiffLoadRunnerArgs): DiffLoadRunner => {
  const queryClient = useQueryClient();
  const hasLoadContextChanged = useCallback(
    (path: string, nextTargetBranch: string, nextWorkingDir: string | null): boolean =>
      repoPathRef.current !== path ||
      targetBranchRef.current !== nextTargetBranch ||
      (workingDirRef.current ?? null) !== nextWorkingDir,
    [repoPathRef, targetBranchRef, workingDirRef],
  );

  const hydrateCachedFullLoad = useCallback(
    (context: LoadRequestContext): boolean => {
      const cachedSnapshot = readCachedFullLoadSnapshot(queryClient, context);
      if (cachedSnapshot === null) {
        return false;
      }

      applyCachedFullResult({
        clearScopeInvalidation,
        scope: context.scope,
        snapshot: cachedSnapshot,
      });
      return true;
    },
    [applyCachedFullResult, clearScopeInvalidation, queryClient],
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
        queryClient,
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
    [
      applySummaryResult,
      hasLoadContextChanged,
      markScopeInvalidated,
      queryClient,
      shouldApplyResult,
    ],
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
        queryClient,
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
    [
      applyFullResult,
      clearScopeInvalidation,
      hasLoadContextChanged,
      queryClient,
      shouldApplyResult,
    ],
  );

  return useMemo(
    () => ({
      hasLoadContextChanged,
      hydrateCachedFullLoad,
      runFullLoad,
      runSummaryLoad,
    }),
    [hasLoadContextChanged, hydrateCachedFullLoad, runFullLoad, runSummaryLoad],
  );
};
