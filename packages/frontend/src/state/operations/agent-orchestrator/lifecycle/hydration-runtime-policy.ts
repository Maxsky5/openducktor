import type { AgentSessionRecord } from "@openducktor/contracts";
import { normalizeWorkingDirectory } from "../support/core";

const REPO_ROOT_WORKSPACE_RUNTIME_ROLES = new Set<AgentSessionRecord["role"]>(["spec", "planner"]);

export const canUseWorkspaceRuntimeForHydration = (
  record: Pick<AgentSessionRecord, "role" | "workingDirectory">,
  repoPath: string,
): boolean => {
  const normalizedWorkingDirectory = normalizeWorkingDirectory(record.workingDirectory);
  const normalizedRepoPath = normalizeWorkingDirectory(repoPath);

  if (normalizedWorkingDirectory.length === 0) {
    return false;
  }

  return (
    REPO_ROOT_WORKSPACE_RUNTIME_ROLES.has(record.role) &&
    normalizedWorkingDirectory === normalizedRepoPath
  );
};
