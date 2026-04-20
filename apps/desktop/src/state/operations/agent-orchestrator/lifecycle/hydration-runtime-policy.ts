import type { AgentSessionRecord } from "@openducktor/contracts";
import { normalizeWorkingDirectory } from "../support/core";

const HYDRATION_WORKSPACE_RUNTIME_ROLES = new Set<AgentSessionRecord["role"]>(["spec", "planner"]);

export const canUseRepoRootWorkspaceRuntimeForHydration = (
  record: Pick<AgentSessionRecord, "role" | "workingDirectory">,
  repoPath: string,
): boolean => {
  if (!HYDRATION_WORKSPACE_RUNTIME_ROLES.has(record.role)) {
    return false;
  }

  return normalizeWorkingDirectory(record.workingDirectory) === normalizeWorkingDirectory(repoPath);
};
