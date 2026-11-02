import type {
  GitBranch,
  RepositoryGitProviderContext,
  WorkspaceRecord,
} from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { repositoryGitProviderContextQueryOptions } from "@openducktor/frontend-core/queries/git-provider-context";
import { repoBranchesQueryOptions } from "@openducktor/frontend-core/queries/git";
import {
  repoConfigQueryOptions,
  toRepoSettingsInput,
} from "@openducktor/frontend-core/queries/workspace";
import type { RepoSettingsInput } from "@openducktor/frontend-core/types/session-slices";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

/** The branch list read failed, so a start cannot offer every target branch. */
export type BranchesFailure = { message: string; retry: () => void };

/**
 * The repository settings, branches, and Git provider of a workspace for its task workflows. The
 * host sends no event when its settings change, so each workflow sheet reads the repository
 * settings again when it opens. Cached settings let the form open at once while the read checks
 * for changes in another client.
 */
export function useWorkspaceRepoSettings(workspace: WorkspaceRecord) {
  const queryClient = useQueryClient();
  const { workspaceId, repoPath } = workspace;
  const config = useQuery({ ...repoConfigQueryOptions(workspaceId), refetchOnMount: "always" });
  const branches = useQuery(repoBranchesQueryOptions(repoPath));
  const provider = useQuery(repositoryGitProviderContextQueryOptions({ workspaceId, repoPath }));
  const repoSettings = useMemo<RepoSettingsInput | null>(
    () => (config.data ? toRepoSettingsInput(config.data) : null),
    [config.data],
  );
  const loadGitProviderContext = useCallback(
    (): Promise<RepositoryGitProviderContext> =>
      queryClient.fetchQuery({
        ...repositoryGitProviderContextQueryOptions({ workspaceId, repoPath }),
        staleTime: 0,
      }),
    [queryClient, repoPath, workspaceId],
  );
  const { refetch } = config;
  const retryRepoSettings = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const { refetch: refetchBranches } = branches;
  const retryBranches = useCallback(() => {
    void refetchBranches();
  }, [refetchBranches]);
  const branchesFailure = useMemo<BranchesFailure | null>(
    () => (branches.error ? { message: errorMessage(branches.error), retry: retryBranches } : null),
    [branches.error, retryBranches],
  );
  return {
    repoSettings,
    repoSettingsReady: config.data !== undefined,
    repoSettingsError: config.data === undefined ? config.error : null,
    repoSettingsRefreshError: config.data !== undefined ? config.error : null,
    retryRepoSettings,
    branches: branches.data ?? EMPTY_BRANCHES,
    branchesFailure,
    gitProvider: { context: provider.data, error: provider.error, load: loadGitProviderContext },
  };
}

const EMPTY_BRANCHES: GitBranch[] = [];
