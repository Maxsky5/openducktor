import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { hostClient } from "@/lib/host-client";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import type { GitDiffRefresh } from "../contracts";
import { mergeRefreshRequests, runDiffRefreshRequest } from "./refresh-execution";
import type { DiffRefreshContext, RefreshRequest, RefreshScopeContext } from "./refresh-types";

type UseAgentStudioDiffRefreshControllerArgs = {
  refreshContext: DiffRefreshContext | null;
  preconditionError: string | null;
  shouldBlockDiffLoading: boolean;
  worktreeResolutionError: string | null;
  retryWorktreeResolution: () => void;
  refreshActiveScope: (context: RefreshScopeContext) => Promise<void>;
  refreshActiveScopeSummary: (context: RefreshScopeContext) => Promise<void>;
  refreshUi: DiffRefreshUiController;
};

type UseAgentStudioDiffRefreshControllerResult = {
  refresh: GitDiffRefresh;
};

type RefreshUiState = {
  contextKey: string | null;
  error: string | null;
  isRefreshing: boolean;
};

export type DiffRefreshUiController = {
  clearRefreshErrorForContext: (contextKey: string) => void;
  isRefreshing: boolean;
  refreshError: string | null;
  setContextRefreshError: (contextKey: string, error: string | null) => void;
  setContextRefreshing: (contextKey: string, isRefreshing: boolean) => void;
};

export function useAgentStudioDiffRefreshUiState(
  refreshContextKey: string | null,
): DiffRefreshUiController {
  const [refreshUiState, setRefreshUiState] = useState<RefreshUiState>({
    contextKey: refreshContextKey,
    error: null,
    isRefreshing: false,
  });

  const setContextRefreshing = useCallback((contextKey: string, isRefreshing: boolean): void => {
    setRefreshUiState((current) => ({
      contextKey,
      error: current.contextKey === contextKey ? current.error : null,
      isRefreshing,
    }));
  }, []);

  const setContextRefreshError = useCallback((contextKey: string, error: string | null): void => {
    setRefreshUiState((current) => ({
      contextKey,
      error,
      isRefreshing: current.contextKey === contextKey ? current.isRefreshing : false,
    }));
  }, []);

  const clearRefreshErrorForContext = useCallback((contextKey: string): void => {
    setRefreshUiState((current) =>
      current.contextKey === contextKey && current.error != null
        ? { ...current, error: null }
        : current,
    );
  }, []);

  return {
    clearRefreshErrorForContext,
    refreshError: refreshUiState.contextKey === refreshContextKey ? refreshUiState.error : null,
    isRefreshing: refreshUiState.contextKey === refreshContextKey && refreshUiState.isRefreshing,
    setContextRefreshError,
    setContextRefreshing,
  };
}

export function useAgentStudioDiffRefreshController({
  refreshContext,
  preconditionError,
  shouldBlockDiffLoading,
  worktreeResolutionError,
  retryWorktreeResolution,
  refreshActiveScope,
  refreshActiveScopeSummary,
  refreshUi,
}: UseAgentStudioDiffRefreshControllerArgs): UseAgentStudioDiffRefreshControllerResult {
  const queryClient = useQueryClient();
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRefreshRequestRef = useRef<RefreshRequest | null>(null);
  const refreshContextRef = useRef<DiffRefreshContext | null>(refreshContext);
  const scheduledFetchAtByContextRef = useRef<Map<string, number> | null>(null);
  if (scheduledFetchAtByContextRef.current === null) {
    scheduledFetchAtByContextRef.current = new Map<string, number>();
  }
  const scheduledFetchAtByContext = scheduledFetchAtByContextRef.current;
  refreshContextRef.current = refreshContext;

  const runRefreshRequest = useCallback(
    (activeRefreshRequest: RefreshRequest): Promise<boolean> =>
      runDiffRefreshRequest(activeRefreshRequest, {
        getCurrentRefreshContextKey: () => refreshContextRef.current?.requestContextKey ?? null,
        setIsRefreshing: refreshUi.setContextRefreshing,
        setRefreshError: refreshUi.setContextRefreshError,
        scheduledFetchAtByContext,
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
    [
      queryClient,
      refreshActiveScope,
      refreshActiveScopeSummary,
      refreshUi.setContextRefreshError,
      refreshUi.setContextRefreshing,
      scheduledFetchAtByContext,
    ],
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
  };
}
