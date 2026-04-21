import type { AgentSessionRecord } from "@openducktor/contracts";
import { normalizeWorkingDirectory } from "../support/core";

const REPO_ROOT_WORKSPACE_RUNTIME_ROLES = new Set<AgentSessionRecord["role"]>(["spec", "planner"]);
const WORKTREE_WORKSPACE_RUNTIME_ROLES = new Set<AgentSessionRecord["role"]>(["build", "qa"]);

export const canUseWorkspaceRuntimeForHydration = (
  record: Pick<AgentSessionRecord, "role" | "workingDirectory">,
  repoPath: string,
): boolean => {
  const normalizedWorkingDirectory = normalizeWorkingDirectory(record.workingDirectory);
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

  if (REPO_ROOT_WORKSPACE_RUNTIME_ROLES.has(record.role)) {
    return normalizedWorkingDirectory === normalizedRepoPath;
  }

  if (WORKTREE_WORKSPACE_RUNTIME_ROLES.has(record.role)) {
    return (
      normalizedWorkingDirectory.length > 0 && normalizedWorkingDirectory !== normalizedRepoPath
    );
  }

  return false;
};
