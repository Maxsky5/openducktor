import type { GitBranch, GitTargetBranch, WorkspaceProviderSetupRef } from "@openducktor/contracts";
import { useHostConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { setupTargetBranchesOptions } from "@openducktor/frontend-core/queries/workspace-provider-setup";
import { useQuery } from "@tanstack/react-query";

export type WorkspaceCreationTargetBranches = {
  branches: GitBranch[];
  /** Why Git cannot tell the default branch, while the user has not chosen one. */
  unknownReason: string | null;
  isLoading: boolean;
  error: string | null;
  retry: () => void;
};

export type WorkspaceCreationTargetBranch = {
  defaultTargetBranch: GitTargetBranch | null;
  targetBranches: WorkspaceCreationTargetBranches;
};

/**
 * The default target branch of a new workspace: the choice of the user, else the repository
 * default that Git reports. Without a setup session, it reads nothing.
 */
export function useWorkspaceCreationTargetBranch(
  session: WorkspaceProviderSetupRef | null,
  chosen: GitTargetBranch | null,
): WorkspaceCreationTargetBranch {
  const { client } = useHostConnection();
  const query = useQuery(setupTargetBranchesOptions(client, session));
  const repositoryDefault = query.data?.repositoryDefault;
  const detected = repositoryDefault?.kind === "detected" ? repositoryDefault.targetBranch : null;
  const targetBranches: WorkspaceCreationTargetBranches = {
    branches: query.data?.branches ?? [],
    unknownReason:
      chosen === null && repositoryDefault?.kind === "unknown" ? repositoryDefault.reason : null,
    isLoading: query.isPending,
    error: query.data ? null : (query.error?.message ?? null),
    retry: () => void query.refetch(),
  };
  return {
    defaultTargetBranch: chosen ?? detected,
    targetBranches,
  };
}
