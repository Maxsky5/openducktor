import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hostClient } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { canonicalTargetBranch } from "@/lib/target-branch";
import { invalidateRepoBranchesQuery } from "@/state/queries/git";
import type { UseAgentStudioDiffDataInput } from "./agent-studio-diff-data-model";
import type { DiffDataState, GitDiffRefreshMode } from "./contracts";
import { useAgentStudioDiffController } from "./use-agent-studio-diff-controller";
import { useAgentStudioDiffPolling } from "./use-agent-studio-diff-polling";
import { useAgentStudioWorktreeResolution } from "./use-agent-studio-worktree-resolution";

type RefreshContext = {
  requestContextKey: string;
  repoPath: string;
  targetBranch: string;
  workingDir: string | null;
  scope: DiffDataState["diffScope"];
};

type RefreshRequest = {
  context: RefreshContext;
  mode: GitDiffRefreshMode;
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
}: Pick<RefreshContext, "repoPath" | "targetBranch" | "workingDir">): string =>
  `${repoPath}::${targetBranch}::${workingDir ?? ""}`;

export function useAgentStudioDiffData({
  repoPath,
  sessionWorkingDirectory,
  sessionRunId,
  defaultTargetBranch,
  preconditionError = null,
  branchIdentityKey = null,
  enablePolling,
  runCompletionRecoverySignal,
}: UseAgentStudioDiffDataInput): DiffDataState {
  const targetBranch = canonicalTargetBranch(defaultTargetBranch);
  const effectiveRepoPath = preconditionError ? null : repoPath;
  const {
    worktreePath,
    worktreeResolutionRunId,
    shouldBlockDiffLoading,
    isWorktreeResolutionResolving,
    worktreeResolutionError,
    retryWorktreeResolution,
  } = useAgentStudioWorktreeResolution({
    repoPath: effectiveRepoPath,
    sessionWorkingDirectory,
    sessionRunId,
    ...(runCompletionRecoverySignal == null ? {} : { runCompletionRecoverySignal }),
  });

  const requestContextKey = useMemo(() => {
    if (!effectiveRepoPath) {
      return null;
    }

    return `${effectiveRepoPath}::${targetBranch}::${worktreePath ?? ""}::${worktreeResolutionRunId ?? ""}::${
      branchIdentityKey ?? ""
    }`;
  }, [branchIdentityKey, effectiveRepoPath, targetBranch, worktreePath, worktreeResolutionRunId]);

  const {
    activeScopeState,
    diffScope,
    refreshActiveScope,
    refreshActiveScopeSummary,
    setDiffScope,
    state,
    statusSnapshotKey,
  } = useAgentStudioDiffController({
    repoPath: effectiveRepoPath,
    targetBranch,
    workingDir: worktreePath,
    requestContextKey,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
  });
  const refreshContext = useMemo<RefreshContext | null>(() => {
    if (requestContextKey == null || effectiveRepoPath == null) {
      return null;
    }

    return {
      requestContextKey,
      repoPath: effectiveRepoPath,
      targetBranch,
      workingDir: worktreePath,
      scope: diffScope,
    };
  }, [diffScope, effectiveRepoPath, requestContextKey, targetBranch, worktreePath]);
  const refreshContextKey = refreshContext?.requestContextKey ?? null;

  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const queuedRefreshRequestRef = useRef<RefreshRequest | null>(null);
  const refreshContextRef = useRef<RefreshContext | null>(refreshContext);
  const scheduledFetchAtByContextRef = useRef(new Map<string, number>());
  refreshContextRef.current = refreshContext;
  const previousIsLoadingRef = useRef(state.isLoading);

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
    previousIsLoadingRef.current = state.isLoading;

    if (refreshError != null && wasLoading && !state.isLoading && activeScopeState.error == null) {
      setRefreshError(null);
    }
  }, [activeScopeState.error, refreshError, state.isLoading]);

  const refresh = useCallback(
    (mode: GitDiffRefreshMode = "hard"): void => {
      if (preconditionError != null) {
        return;
      }

      if (worktreeResolutionError != null) {
        retryWorktreeResolution();
        return;
      }

      if (shouldBlockDiffLoading) {
        return;
      }

      const nextRefreshContext = refreshContextRef.current;
      if (nextRefreshContext == null) {
        return;
      }

      if (refreshPromiseRef.current != null) {
        if (mode === "scheduled") {
          return;
        }

        queuedRefreshRequestRef.current = mergeRefreshRequests(queuedRefreshRequestRef.current, {
          context: nextRefreshContext,
          mode,
        });
        return;
      }

      queuedRefreshRequestRef.current = {
        context: nextRefreshContext,
        mode,
      };

      const runRefreshLoop = async (): Promise<void> => {
        while (queuedRefreshRequestRef.current != null) {
          const activeRefreshRequest = queuedRefreshRequestRef.current;
          queuedRefreshRequestRef.current = null;
          const activeRefreshContext = activeRefreshRequest.context;
          const hasSameRefreshContext = (): boolean =>
            refreshContextRef.current?.requestContextKey === activeRefreshContext.requestContextKey;
          const showLoading = activeRefreshRequest.mode !== "scheduled";
          const scheduledFetchCooldownKey = buildScheduledFetchCooldownKey(activeRefreshContext);
          const shouldRunScheduledFetch = (): boolean => {
            const lastFetchedAt =
              scheduledFetchAtByContextRef.current.get(scheduledFetchCooldownKey);
            return (
              lastFetchedAt == null || Date.now() - lastFetchedAt >= SCHEDULED_FETCH_COOLDOWN_MS
            );
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
            break;
          }

          if (showLoading) {
            setIsRefreshing(true);
          }

          try {
            if (activeRefreshRequest.mode === "hard") {
              const fetchCompleted = await fetchRemote();
              if (!fetchCompleted) {
                break;
              }

              setRefreshError(null);
              await refreshActiveScope({
                repoPath: activeRefreshContext.repoPath,
                targetBranch: activeRefreshContext.targetBranch,
                workingDir: activeRefreshContext.workingDir,
                scope: activeRefreshContext.scope,
              });
              continue;
            }

            if (activeRefreshRequest.mode === "soft") {
              setRefreshError(null);
              await refreshActiveScope({
                repoPath: activeRefreshContext.repoPath,
                targetBranch: activeRefreshContext.targetBranch,
                workingDir: activeRefreshContext.workingDir,
                scope: activeRefreshContext.scope,
              });
              continue;
            }

            let scheduledFetchError: string | null = null;
            if (shouldRunScheduledFetch()) {
              try {
                const fetchCompleted = await fetchRemote();
                if (!fetchCompleted) {
                  break;
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
            await refreshActiveScopeSummary({
              repoPath: activeRefreshContext.repoPath,
              targetBranch: activeRefreshContext.targetBranch,
              workingDir: activeRefreshContext.workingDir,
              scope: activeRefreshContext.scope,
            });
          } catch (error) {
            if (hasSameRefreshContext()) {
              setRefreshError(String(error));
            }
          } finally {
            if (showLoading && hasSameRefreshContext()) {
              setIsRefreshing(false);
            }
          }
        }
      };

      const refreshPromise = runRefreshLoop().finally(() => {
        if (refreshPromiseRef.current === refreshPromise) {
          refreshPromiseRef.current = null;
        }
      });
      refreshPromiseRef.current = refreshPromise;
    },
    [
      refreshActiveScope,
      preconditionError,
      retryWorktreeResolution,
      shouldBlockDiffLoading,
      worktreeResolutionError,
      refreshActiveScopeSummary,
    ],
  );

  useAgentStudioDiffPolling({
    enablePolling,
    repoPath: effectiveRepoPath,
    shouldBlockDiffLoading: shouldBlockDiffLoading || preconditionError != null,
    poll: () => {
      refresh("scheduled");
    },
  });

  const displayError =
    preconditionError ?? worktreeResolutionError ?? refreshError ?? activeScopeState.error;
  const isLoading = state.isLoading || isWorktreeResolutionResolving || isRefreshing;

  return useMemo<DiffDataState>(
    () => ({
      branch: activeScopeState.branch,
      worktreePath,
      targetBranch,
      diffScope,
      scopeStatesByScope: state.byScope,
      loadedScopesByScope: state.loadedByScope,
      commitsAheadBehind: activeScopeState.commitsAheadBehind,
      upstreamAheadBehind: activeScopeState.upstreamAheadBehind,
      upstreamStatus: activeScopeState.upstreamStatus,
      fileDiffs: activeScopeState.fileDiffs,
      fileStatuses: activeScopeState.fileStatuses,
      statusSnapshotKey,
      hashVersion: activeScopeState.hashVersion,
      statusHash: activeScopeState.statusHash,
      diffHash: activeScopeState.diffHash,
      uncommittedFileCount: activeScopeState.uncommittedFileCount,
      isLoading,
      error: displayError,
      refresh,
      setDiffScope,
    }),
    [
      activeScopeState,
      displayError,
      diffScope,
      isLoading,
      refresh,
      setDiffScope,
      state.byScope,
      state.loadedByScope,
      statusSnapshotKey,
      targetBranch,
      worktreePath,
    ],
  );
}
