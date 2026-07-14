import type { AgentSessionRecord, TaskWorktreeSummary } from "@openducktor/contracts";
import { normalizePathForComparison } from "@openducktor/path-support";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useWorkspaceState } from "@/state/app-state-provider";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";
import { taskWorktreeQueryOptions } from "@/state/queries/build-runtime";

type TaskCleanupImpact = {
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  legacyWorktreeCount: number;
  impactError: string | null;
  isLoadingImpact: boolean;
};

type TaskCleanupImpactQuerySnapshot = {
  data: AgentSessionRecord[] | undefined;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
};

type TaskWorktreeImpactQuerySnapshot = {
  data: TaskWorktreeSummary | null | undefined;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
};

const EMPTY_CLEANUP_IMPACT: TaskCleanupImpact = {
  hasManagedSessionCleanup: false,
  managedWorktreeCount: 0,
  legacyWorktreeCount: 0,
  impactError: null,
  isLoadingImpact: false,
};

export const getManagedTaskCleanupImpact = (
  repoPath: string,
  sessions: AgentSessionRecord[],
): TaskCleanupImpact => {
  const normalizedRepoPath = normalizePathForComparison(repoPath);
  const managedWorktrees = new Set<string>();

  for (const session of sessions) {
    if (session.role !== "build" && session.role !== "qa") {
      continue;
    }

    const normalizedWorkingDirectory = normalizePathForComparison(session.workingDirectory);
    if (
      normalizedWorkingDirectory.length === 0 ||
      normalizedWorkingDirectory === normalizedRepoPath
    ) {
      continue;
    }

    managedWorktrees.add(normalizedWorkingDirectory);
  }

  return {
    hasManagedSessionCleanup: managedWorktrees.size > 0,
    managedWorktreeCount: managedWorktrees.size,
    legacyWorktreeCount: managedWorktrees.size,
    impactError: null,
    isLoadingImpact: false,
  };
};

export const getManagedTaskCleanupImpactFromTasks = (
  repoPath: string,
  taskSessions: AgentSessionRecord[][],
): TaskCleanupImpact => getManagedTaskCleanupImpact(repoPath, taskSessions.flat());

export const TASK_CLEANUP_IMPACT_ERROR_MESSAGE = "Unable to load linked worktree cleanup impact.";

export const getTaskCleanupImpactFromSessionQueries = (
  repoPath: string | null,
  taskIds: string[],
  taskSessionQueries: readonly TaskCleanupImpactQuerySnapshot[],
  taskWorktreeQueries: readonly TaskWorktreeImpactQuerySnapshot[] = [],
): TaskCleanupImpact => {
  if (taskIds.length === 0 || !repoPath) {
    return EMPTY_CLEANUP_IMPACT;
  }

  const failedQuery = [...taskSessionQueries, ...taskWorktreeQueries].find(
    (query) => query.error != null,
  );
  if (failedQuery) {
    return {
      hasManagedSessionCleanup: false,
      managedWorktreeCount: 0,
      legacyWorktreeCount: 0,
      impactError: TASK_CLEANUP_IMPACT_ERROR_MESSAGE,
      isLoadingImpact: false,
    };
  }

  if (
    [...taskSessionQueries, ...taskWorktreeQueries].some(
      (query) => query.isLoading || query.isFetching,
    )
  ) {
    return {
      ...EMPTY_CLEANUP_IMPACT,
      isLoadingImpact: true,
    };
  }

  const sessionImpact = getManagedTaskCleanupImpactFromTasks(
    repoPath,
    taskSessionQueries.map((query) => query.data ?? []),
  );
  const managedPaths = new Set<string>();
  const canonicalPaths = new Set<string>();
  const legacyWorktreePaths = new Set<string>();
  for (const query of taskWorktreeQueries) {
    const path = query.data?.workingDirectory
      ? normalizePathForComparison(query.data.workingDirectory)
      : "";
    if (path && path !== normalizePathForComparison(repoPath)) {
      managedPaths.add(path);
      canonicalPaths.add(path);
    }
  }
  for (const sessions of taskSessionQueries) {
    for (const session of sessions.data ?? []) {
      const path = normalizePathForComparison(session.workingDirectory);
      if (path && path !== normalizePathForComparison(repoPath)) {
        managedPaths.add(path);
        if ((session.role === "build" || session.role === "qa") && !canonicalPaths.has(path)) {
          legacyWorktreePaths.add(path);
        }
      }
    }
  }
  return {
    ...sessionImpact,
    hasManagedSessionCleanup: managedPaths.size > 0,
    managedWorktreeCount: managedPaths.size,
    legacyWorktreeCount: legacyWorktreePaths.size,
  };
};

export function useTaskCleanupImpact(taskIds: string[], open: boolean): TaskCleanupImpact {
  const { activeWorkspace } = useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const taskSessionQueries = useQueries({
    queries: taskIds.map((taskId) => ({
      ...(workspaceRepoPath
        ? agentSessionListQueryOptions(workspaceRepoPath, taskId)
        : agentSessionListQueryOptions("", taskId)),
      enabled: open && Boolean(workspaceRepoPath),
    })),
  });
  const taskWorktreeQueries = useQueries({
    queries: taskIds.map((taskId) => ({
      ...(workspaceRepoPath
        ? taskWorktreeQueryOptions({ repoPath: workspaceRepoPath, taskId })
        : taskWorktreeQueryOptions({ repoPath: "", taskId })),
      enabled: open && Boolean(workspaceRepoPath),
    })),
  });

  return useMemo((): TaskCleanupImpact => {
    return getTaskCleanupImpactFromSessionQueries(
      open ? workspaceRepoPath : null,
      taskIds,
      taskSessionQueries,
      taskWorktreeQueries,
    );
  }, [workspaceRepoPath, open, taskIds, taskSessionQueries, taskWorktreeQueries]);
}
