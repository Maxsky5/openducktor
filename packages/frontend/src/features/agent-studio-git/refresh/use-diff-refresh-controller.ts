import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { hostClient } from "@/lib/host-client";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import type { GitDiffRefresh } from "../contracts";
import { mergeRefreshRequests, runDiffRefreshRequest } from "./refresh-execution";
import type { DiffRefreshContext, RefreshRequest, RefreshScopeContext } from "./refresh-types";

type UseAgentStudioDiffRefreshControllerArgs = {
  refreshContext: DiffRefreshContext | null;
  refreshContextKey: string | null;
  preconditionError: string | null;
  shouldBlockDiffLoading: boolean;
  worktreeResolutionError: string | null;
  retryWorktreeResolution: () => void;
  isControllerLoading: boolean;
  activeScopeError: string | null;
  refreshActiveScope: (context: RefreshScopeContext) => Promise<void>;
  refreshActiveScopeSummary: (context: RefreshScopeContext) => Promise<void>;
};

type UseAgentStudioDiffRefreshControllerResult = {
  refresh: GitDiffRefresh;
  refreshError: string | null;
  isRefreshing: boolean;
};

export function useAgentStudioDiffRefreshController({
  refreshContext,
  refreshContextKey,
  preconditionError,
  shouldBlockDiffLoading,
  worktreeResolutionError,
  retryWorktreeResolution,
  isControllerLoading,
  activeScopeError,
  refreshActiveScope,
  refreshActiveScopeSummary,
}: UseAgentStudioDiffRefreshControllerArgs): UseAgentStudioDiffRefreshControllerResult {
  const queryClient = useQueryClient();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRefreshRequestRef = useRef<RefreshRequest | null>(null);
  const refreshContextRef = useRef<DiffRefreshContext | null>(refreshContext);
  const scheduledFetchAtByContextRef = useRef(new Map<string, number>());
  const previousIsLoadingRef = useRef(isControllerLoading);
  refreshContextRef.current = refreshContext;

  useEffect(() => {
    // Skip cleanup from stale renders if a newer refresh context won the race to commit.
    if (refreshContextKey !== (refreshContextRef.current?.requestContextKey ?? null)) {
      return;
    }

    setRefreshError(null);
    queuedRefreshRequestRef.current = null;
    refreshPromiseRef.current = null;
    setIsRefreshing(false);
  }, [refreshContextKey]);

  useEffect(() => {
    const wasLoading = previousIsLoadingRef.current;
    previousIsLoadingRef.current = isControllerLoading;

    if (refreshError != null && wasLoading && !isControllerLoading && activeScopeError == null) {
      setRefreshError(null);
    }
  }, [activeScopeError, isControllerLoading, refreshError]);

  const runRefreshRequest = useCallback(
    (activeRefreshRequest: RefreshRequest): Promise<boolean> =>
      runDiffRefreshRequest(activeRefreshRequest, {
        getCurrentRefreshContextKey: () => refreshContextRef.current?.requestContextKey ?? null,
        setIsRefreshing,
        setRefreshError,
        scheduledFetchAtByContext: scheduledFetchAtByContextRef.current,
        nowMs: Date.now,
        fetchRemote: (context) =>
          hostClient.gitFetchRemote(
            context.repoPath,
            context.targetBranch,
            context.workingDir ?? undefined,
          ),
        invalidateRepoBranches: (repoPath) => invalidateRepoBranchesQuery(queryClient, repoPath),
        refreshActiveScope,
        refreshActiveScopeSummary,
      }),
    [queryClient, refreshActiveScope, refreshActiveScopeSummary],
  );

  const refresh = useCallback<GitDiffRefresh>(
    (mode = "hard") => {
      if (preconditionError != null) {
        return Promise.resolve();
      }

      if (worktreeResolutionError != null) {
        retryWorktreeResolution();
        return Promise.resolve();
      }

      if (shouldBlockDiffLoading) {
        return Promise.resolve();
      }

      const nextRefreshContext = refreshContextRef.current;
      if (nextRefreshContext == null) {
        return Promise.resolve();
      }

      if (refreshPromiseRef.current != null) {
        if (mode === "scheduled") {
          return refreshPromiseRef.current;
        }

        queuedRefreshRequestRef.current = mergeRefreshRequests(queuedRefreshRequestRef.current, {
          context: nextRefreshContext,
          mode,
        });
        return refreshPromiseRef.current;
      }

      queuedRefreshRequestRef.current = {
        context: nextRefreshContext,
        mode,
      };

      const refreshPromise = (async (): Promise<void> => {
        const runQueuedRefreshRequest = async (): Promise<void> => {
          if (queuedRefreshRequestRef.current == null) {
            return;
          }
          const activeRefreshRequest = queuedRefreshRequestRef.current;
          queuedRefreshRequestRef.current = null;

          const shouldContinue = await runRefreshRequest(activeRefreshRequest);
          if (shouldContinue) {
            await runQueuedRefreshRequest();
          }
        };

        await runQueuedRefreshRequest();
      })().finally(() => {
        if (refreshPromiseRef.current === refreshPromise) {
          refreshPromiseRef.current = null;
        }
      });
      refreshPromiseRef.current = refreshPromise;
      return refreshPromise;
    },
    [
      preconditionError,
      retryWorktreeResolution,
      runRefreshRequest,
      shouldBlockDiffLoading,
      worktreeResolutionError,
    ],
  );

  return {
    refresh,
    refreshError,
    isRefreshing,
  };
}
