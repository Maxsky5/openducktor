import type { TaskWorktreeSummary } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  type TaskWorktreeQueryHost,
  taskWorktreeQueryOptions,
} from "@/state/queries/build-runtime";
import {
  type AgentStudioGitPanelContextMode,
  type BuildToolsWorktreeStatus,
  buildQueryWorktreeError,
  resolveQueriedBuildWorktreePath,
} from "./agent-studio-build-tools-worktree-snapshot";

export type BuildToolsWorktreeSnapshotState = {
  path: string | null;
  status: BuildToolsWorktreeStatus;
  error: string | null;
  retry: () => Promise<void>;
  isResolving: boolean;
  shouldBlockDiffLoading: boolean;
  resolutionTaskId: string | null;
};

const EMPTY_ASYNC_RETRY = async (): Promise<void> => {};

export function useBuildToolsWorktree({
  host,
  repoPath,
  taskId,
  contextMode,
  sessionWorktreePath,
  isEnabled,
  isRightPanelOpen,
  hasSelectedTask,
  taskWorktreeVersion,
}: {
  host: TaskWorktreeQueryHost;
  repoPath: string | null;
  taskId: string | null;
  contextMode: AgentStudioGitPanelContextMode;
  sessionWorktreePath: string | null;
  isEnabled: boolean;
  isRightPanelOpen: boolean;
  hasSelectedTask: boolean;
  taskWorktreeVersion: string | null;
}) {
  const plan = planQuery({
    repoPath,
    taskId,
    contextMode,
    sessionWorktreePath,
    isEnabled,
    isRightPanelOpen,
    hasSelectedTask,
  });
  const query = useQuery({
    ...taskWorktreeQueryOptions({
      repoPath: repoPath ?? "",
      taskId: taskId ?? "",
      hostClient: host,
      taskVersion: plan.shouldQuery ? taskWorktreeVersion : null,
    }),
    enabled: plan.queryEnabled,
  });
  const read = readWorktree({
    plan,
    repoPath,
    taskId,
    contextMode,
    isEnabled,
    data: query.data,
    queryError: query.error,
    isFetching: query.isFetching,
  });
  const refetch = query.refetch;
  const retry = useCallback(async (): Promise<void> => {
    if (!plan.queryEnabled) return;
    await refetch();
  }, [plan.queryEnabled, refetch]);
  const worktree = useMemo<BuildToolsWorktreeSnapshotState>(
    () => ({
      path: read.path,
      status: read.status,
      error: read.error,
      retry: plan.queryEnabled ? retry : EMPTY_ASYNC_RETRY,
      isResolving: read.isResolving,
      shouldBlockDiffLoading: read.shouldBlockDiffLoading,
      resolutionTaskId: plan.queryEnabled ? taskId : null,
    }),
    [
      read.path,
      read.status,
      read.error,
      read.isResolving,
      read.shouldBlockDiffLoading,
      plan.queryEnabled,
      retry,
      taskId,
    ],
  );
  return {
    worktree,
    queriedPath: read.queriedPath,
    diffResolutionTaskId: plan.shouldQuery ? taskId : null,
  };
}

function planQuery({
  repoPath,
  taskId,
  contextMode,
  sessionWorktreePath,
  isEnabled,
  isRightPanelOpen,
  hasSelectedTask,
}: {
  repoPath: string | null;
  taskId: string | null;
  contextMode: AgentStudioGitPanelContextMode;
  sessionWorktreePath: string | null;
  isEnabled: boolean;
  isRightPanelOpen: boolean;
  hasSelectedTask: boolean;
}) {
  const directPath = repoPath != null ? sessionWorktreePath : null;
  const shouldQuery =
    contextMode === "worktree" && repoPath != null && taskId != null && directPath == null;
  const isResolutionEnabled = (isEnabled || isRightPanelOpen) && hasSelectedTask;
  return {
    directPath,
    shouldQuery,
    isResolutionEnabled,
    queryEnabled: isResolutionEnabled && shouldQuery,
  };
}

function readWorktree({
  plan,
  repoPath,
  taskId,
  contextMode,
  isEnabled,
  data,
  queryError,
  isFetching,
}: {
  plan: ReturnType<typeof planQuery>;
  repoPath: string | null;
  taskId: string | null;
  contextMode: AgentStudioGitPanelContextMode;
  isEnabled: boolean;
  data: TaskWorktreeSummary | null | undefined;
  queryError: Error | null;
  isFetching: boolean;
}) {
  const queried =
    plan.shouldQuery && repoPath != null && taskId != null && data !== undefined
      ? resolveQueriedBuildWorktreePath({
          repoPath,
          taskId,
          queriedWorkingDirectory: data?.workingDirectory ?? null,
        })
      : { path: null, error: null };
  const error =
    (plan.queryEnabled && taskId != null && queryError
      ? buildQueryWorktreeError(taskId, queryError)
      : null) ?? queried.error;
  const path = contextMode === "worktree" ? (plan.directPath ?? queried.path) : null;
  const isResolving = plan.queryEnabled && isFetching;
  const status = resolveStatus({
    isEnabled: plan.isResolutionEnabled,
    contextMode,
    path,
    isResolving,
    error,
  });
  const shouldBlockDiffLoading =
    !isEnabled ||
    (contextMode === "worktree" && plan.queryEnabled && (error != null || path == null));
  return { queriedPath: queried.path, error, path, isResolving, status, shouldBlockDiffLoading };
}

function resolveStatus({
  isEnabled,
  contextMode,
  path,
  isResolving,
  error,
}: {
  isEnabled: boolean;
  contextMode: AgentStudioGitPanelContextMode;
  path: string | null;
  isResolving: boolean;
  error: string | null;
}): BuildToolsWorktreeStatus {
  if (!isEnabled || contextMode === "repository") return "idle";
  if (path != null) return "resolved";
  if (isResolving) return "resolving";
  if (error != null) return "failed";
  return "idle";
}
