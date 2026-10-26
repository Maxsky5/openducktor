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
 * settings again when it opens. A start then uses the current default runtimes, models, efforts,
 * and target branch, also after a change in another client.
 */
export function useWorkspaceRepoSettings(workspace: WorkspaceRecord) {
  const queryClient = useQueryClient();
  const { workspaceId, repoPath } = workspace;
  const config = useQuery({ ...repoConfigQueryOptions(workspaceId), refetchOnMount: "always" });
  const branches = useQuery(repoBranchesQueryOptions(repoPath));
  const provider = useQuery(repositoryGitProviderContextQueryOptions(repoPath));
  const repoSettings = useMemo<RepoSettingsInput | null>(
    () => (config.data ? toRepoSettingsInput(config.data) : null),
    [config.data],
  );
  const loadGitProviderContext = useCallback(
    (): Promise<RepositoryGitProviderContext> =>
      queryClient.fetchQuery({
        ...repositoryGitProviderContextQueryOptions(repoPath),
        staleTime: 0,
      }),
    [queryClient, repoPath],
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
    /** True once the read that the sheet started has settled, with the settings or a failure. */
    repoSettingsReady: config.isFetchedAfterMount && !config.isFetching,
    repoSettingsError: config.error,
    retryRepoSettings,
    branches: branches.data ?? EMPTY_BRANCHES,
    branchesFailure,
    gitProvider: { context: provider.data, error: provider.error, load: loadGitProviderContext },
  };
}

const EMPTY_BRANCHES: GitBranch[] = [];
