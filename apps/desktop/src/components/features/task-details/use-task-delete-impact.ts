import type { AgentSessionRecord } from "@openducktor/contracts";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useWorkspaceState } from "@/state";
import { agentSessionListQueryOptions } from "@/state/queries/agent-sessions";

type TaskDeleteImpact = {
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  impactError: string | null;
  isLoadingImpact: boolean;
};

const EMPTY_DELETE_IMPACT: TaskDeleteImpact = {
  hasManagedSessionCleanup: false,
  managedWorktreeCount: 0,
  impactError: null,
  isLoadingImpact: false,
};

const normalizePathForComparison = (path: string): string => {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return "";
  }
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, "");
  return withoutTrailingSeparators.length > 0 ? withoutTrailingSeparators : trimmed;
};

export const getManagedTaskDeleteImpact = (
  repoPath: string,
  sessions: AgentSessionRecord[],
): TaskDeleteImpact => {
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
    impactError: null,
    isLoadingImpact: false,
  };
};

export const getManagedTaskDeleteImpactFromTasks = (
  repoPath: string,
  taskSessions: AgentSessionRecord[][],
): TaskDeleteImpact => getManagedTaskDeleteImpact(repoPath, taskSessions.flat());

export const TASK_DELETE_IMPACT_ERROR_MESSAGE = "Unable to load linked worktree cleanup impact.";

export function useTaskDeleteImpact(taskIds: string[], open: boolean): TaskDeleteImpact {
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

  return useMemo((): TaskDeleteImpact => {
    if (taskIds.length === 0 || !open || !workspaceRepoPath) {
      return EMPTY_DELETE_IMPACT;
    }

    const failedQuery = taskSessionQueries.find((query) => query.error != null);
    if (failedQuery) {
      return {
        hasManagedSessionCleanup: false,
        managedWorktreeCount: 0,
        impactError: TASK_DELETE_IMPACT_ERROR_MESSAGE,
        isLoadingImpact: false,
      };
    }

    if (taskSessionQueries.some((query) => query.isLoading)) {
      return {
        ...EMPTY_DELETE_IMPACT,
        isLoadingImpact: true,
      };
    }

    return getManagedTaskDeleteImpactFromTasks(
      workspaceRepoPath,
      taskSessionQueries.map((query) => query.data ?? []),
    );
  }, [workspaceRepoPath, open, taskIds, taskSessionQueries]);
}
