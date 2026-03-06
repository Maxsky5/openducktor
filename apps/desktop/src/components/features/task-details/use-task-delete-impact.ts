import type { AgentSessionRecord } from "@openducktor/contracts";
import { useEffect, useState } from "react";
import { useWorkspaceState } from "@/state";
import { host } from "@/state/operations/host";

export type TaskDeleteImpact = {
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
};

const EMPTY_DELETE_IMPACT: TaskDeleteImpact = {
  hasManagedSessionCleanup: false,
  managedWorktreeCount: 0,
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
  };
};

export const getManagedTaskDeleteImpactFromTasks = (
  repoPath: string,
  taskSessions: AgentSessionRecord[][],
): TaskDeleteImpact => getManagedTaskDeleteImpact(repoPath, taskSessions.flat());

export const getConservativeTaskDeleteImpact = (): TaskDeleteImpact => ({
  hasManagedSessionCleanup: true,
  managedWorktreeCount: 0,
});

export function useTaskDeleteImpact(taskIds: string[], open: boolean): TaskDeleteImpact {
  const { activeRepo } = useWorkspaceState();
  const [impact, setImpact] = useState<TaskDeleteImpact>(EMPTY_DELETE_IMPACT);

  useEffect(() => {
    if (taskIds.length === 0 || !open || !activeRepo) {
      setImpact(EMPTY_DELETE_IMPACT);
      return;
    }

    let cancelled = false;
    void Promise.all(taskIds.map((taskId) => host.agentSessionsList(activeRepo, taskId)))
      .then((taskSessions: AgentSessionRecord[][]) => {
        if (cancelled) {
          return;
        }
        setImpact(getManagedTaskDeleteImpactFromTasks(activeRepo, taskSessions));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setImpact(getConservativeTaskDeleteImpact());
      });

    return () => {
      cancelled = true;
    };
  }, [activeRepo, open, taskIds]);

  return impact;
}
