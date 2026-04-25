import { useCallback, useEffect, useRef, useState } from "react";
import { hostClient } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import type { DiffDataState, GitDiffRefresh, GitDiffRefreshMode } from "./contracts";

export type DiffRefreshContext = {
  requestContextKey: string;
  repoPath: string;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffDataState["diffScope"];
};

type RefreshRequest = {
  context: DiffRefreshContext;
  mode: GitDiffRefreshMode;
};

type UseAgentStudioDiffRefreshControllerArgs = {
  refreshContext: DiffRefreshContext | null;
  refreshContextKey: string | null;
  preconditionError: string | null;
  shouldBlockDiffLoading: boolean;
  worktreeResolutionError: string | null;
  retryWorktreeResolution: () => void;
  isControllerLoading: boolean;
  activeScopeError: string | null;
  refreshActiveScope: (
    context: Pick<DiffRefreshContext, "repoPath" | "targetBranch" | "workingDir" | "scope">,
  ) => Promise<void>;
  refreshActiveScopeSummary: (
    context: Pick<DiffRefreshContext, "repoPath" | "targetBranch" | "workingDir" | "scope">,
  ) => Promise<void>;
};

type UseAgentStudioDiffRefreshControllerResult = {
  refresh: GitDiffRefresh;
  refreshError: string | null;
  isRefreshing: boolean;
};

const SCHEDULED_FETCH_COOLDOWN_MS = 5 * 60 * 1000;

const refreshModePriority = (mode: GitDiffRefreshMode): number => {
  switch (mode) {
    case "hard":
      return 3;
    case "soft":
      return 2;
    case "scheduled":
      return 1;
  }
};

const mergeRefreshRequests = (
  current: RefreshRequest | null,
  next: RefreshRequest,
): RefreshRequest => {
  if (current == null || current.context.requestContextKey !== next.context.requestContextKey) {
    return next;
  }

  return refreshModePriority(next.mode) > refreshModePriority(current.mode) ? next : current;
};

const buildScheduledFetchCooldownKey = ({
  repoPath,
  targetBranch,
  workingDir,
}: Pick<DiffRefreshContext, "repoPath" | "targetBranch" | "workingDir">): string =>
  `${repoPath}::${targetBranch}::${workingDir ?? ""}`;

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
    async (activeRefreshRequest: RefreshRequest): Promise<boolean> => {
      const activeRefreshContext = activeRefreshRequest.context;
      const hasSameRefreshContext = (): boolean =>
        refreshContextRef.current?.requestContextKey === activeRefreshContext.requestContextKey;
      const showLoading = activeRefreshRequest.mode !== "scheduled";
      const scheduledFetchCooldownKey = buildScheduledFetchCooldownKey(activeRefreshContext);
      const shouldRunScheduledFetch = (): boolean => {
        const lastFetchedAt = scheduledFetchAtByContextRef.current.get(scheduledFetchCooldownKey);
        return lastFetchedAt == null || Date.now() - lastFetchedAt >= SCHEDULED_FETCH_COOLDOWN_MS;
      };
      const updateScheduledFetchCooldown = (): void => {
        scheduledFetchAtByContextRef.current.set(scheduledFetchCooldownKey, Date.now());
      };
      const fetchRemote = async (): Promise<boolean> => {
        const fetchResult = await hostClient.gitFetchRemote(
          activeRefreshContext.repoPath,
          activeRefreshContext.targetBranch,
          activeRefreshContext.workingDir ?? undefined,
        );
        if (!hasSameRefreshContext()) {
          return false;
        }

        if (fetchResult.outcome === "fetched") {
          await invalidateRepoBranchesQuery(appQueryClient, activeRefreshContext.repoPath);
          if (!hasSameRefreshContext()) {
            return false;
          }
        }

        updateScheduledFetchCooldown();
        return true;
      };

      if (!hasSameRefreshContext()) {
        return false;
      }

      if (showLoading) {
        setIsRefreshing(true);
      }

      try {
        if (activeRefreshRequest.mode === "hard") {
          const fetchCompleted = await fetchRemote();
          if (!fetchCompleted) {
            return false;
          }

          setRefreshError(null);
          await refreshActiveScope(activeRefreshContext);
          return true;
        }

        if (activeRefreshRequest.mode === "soft") {
          setRefreshError(null);
          await refreshActiveScope(activeRefreshContext);
          return true;
        }

        let scheduledFetchError: string | null = null;
        if (shouldRunScheduledFetch()) {
          try {
            const fetchCompleted = await fetchRemote();
            if (!fetchCompleted) {
              return false;
            }
          } catch (error) {
            if (hasSameRefreshContext()) {
              scheduledFetchError = String(error);
            }
          }
        }

        if (hasSameRefreshContext()) {
          setRefreshError(scheduledFetchError);
        }
        await refreshActiveScopeSummary(activeRefreshContext);
        return true;
      } catch (error) {
        if (hasSameRefreshContext()) {
          setRefreshError(String(error));
        }
        return true;
      } finally {
        if (showLoading && hasSameRefreshContext()) {
          setIsRefreshing(false);
        }
      }
    },
    [refreshActiveScope, refreshActiveScopeSummary],
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
        while (queuedRefreshRequestRef.current != null) {
          const activeRefreshRequest = queuedRefreshRequestRef.current;
          queuedRefreshRequestRef.current = null;

          const shouldContinue = await runRefreshRequest(activeRefreshRequest);
          if (!shouldContinue) {
            break;
          }
        }
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
