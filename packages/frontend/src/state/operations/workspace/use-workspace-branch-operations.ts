import type { GitBranch, GitCurrentBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import {
  currentBranchQueryOptions,
  gitQueryKeys,
  invalidateCurrentBranchQuery,
  invalidateRepoBranchesQuery,
  loadCurrentBranchFromQuery,
  loadRepoBranchesFromQuery,
  repoBranchesQueryOptions,
} from "../../queries/git";
import { shouldSkipBranchSwitch } from "./workspace-operations-model";
import type { WorkspaceBranchOperationsHostClient } from "./workspace-operations-types";

type UseWorkspaceBranchOperationsArgs = {
  activeRepo: string | null;
  hostClient: WorkspaceBranchOperationsHostClient;
  updateBranchSyncDegradedForRepo: (repoPath: string | null, value: boolean) => void;
};

type UseWorkspaceBranchOperationsResult = {
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: (repoPath?: string | null) => void;
};

export function useWorkspaceBranchOperations({
  activeRepo,
  hostClient,
  updateBranchSyncDegradedForRepo,
}: UseWorkspaceBranchOperationsArgs): UseWorkspaceBranchOperationsResult {
  const queryClient = useQueryClient();
  const queryRepoPath = activeRepo ?? "";
  const branchesQuery = useQuery({
    ...repoBranchesQueryOptions(queryRepoPath, hostClient),
    enabled: false,
  });
  const currentBranchQuery = useQuery({
    ...currentBranchQueryOptions(queryRepoPath, hostClient),
    enabled: false,
  });
  const [switchingBranchRepoPath, setSwitchingBranchRepoPath] = useState<string | null>(null);
  const branchRequestVersionRef = useRef(0);
  const currentWorkspaceRepoPathRef = useRef(activeRepo);

  useLayoutEffect(() => {
    currentWorkspaceRepoPathRef.current = activeRepo;
  }, [activeRepo]);

  const isCurrentBranchRequest = useCallback(
    (repoPath: string, requestVersion: number): boolean =>
      branchRequestVersionRef.current === requestVersion &&
      currentWorkspaceRepoPathRef.current === repoPath,
    [],
  );

  const clearBranchData = useCallback(
    (repoPath = currentWorkspaceRepoPathRef.current): void => {
      branchRequestVersionRef.current += 1;
      setSwitchingBranchRepoPath(null);
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string, force = false): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;

      try {
        if (force) {
          await Promise.all([
            invalidateCurrentBranchQuery(queryClient, repoPath),
            invalidateRepoBranchesQuery(queryClient, repoPath),
          ]);
        }

        await Promise.all([
          loadCurrentBranchFromQuery(queryClient, repoPath, hostClient),
          loadRepoBranchesFromQuery(queryClient, repoPath, hostClient),
        ]);

        if (isCurrentBranchRequest(repoPath, requestVersion)) {
          updateBranchSyncDegradedForRepo(repoPath, false);
        }
      } catch (error) {
        if (isCurrentBranchRequest(repoPath, requestVersion)) {
          throw error;
        }
      }
    },
    [hostClient, isCurrentBranchRequest, queryClient, updateBranchSyncDegradedForRepo],
  );

  const refreshBranches = useCallback(
    async (force = false): Promise<void> => {
      if (!activeRepo) {
        clearBranchData();
        return;
      }

      try {
        await refreshBranchesForRepo(activeRepo, force);
      } catch (error) {
        if (force) {
          toast.error("Branch data unavailable", {
            description: errorMessage(error),
          });
        }
        throw error;
      }
    },
    [activeRepo, clearBranchData, refreshBranchesForRepo],
  );

  const branches = branchesQuery.data ?? [];
  const activeBranch = currentBranchQuery.data ?? null;
  const hasBranchData = branchesQuery.data !== undefined && currentBranchQuery.data !== undefined;
  const isLoadingBranches =
    !hasBranchData && (branchesQuery.isFetching || currentBranchQuery.isFetching);
  const isSwitchingBranch = switchingBranchRepoPath === activeRepo;

  const switchBranch = useCallback(
    async (branchName: string): Promise<void> => {
      if (!activeRepo || !branchName) {
        return;
      }

      const cachedActiveBranch =
        queryClient.getQueryData<GitCurrentBranch>(gitQueryKeys.currentBranch(activeRepo)) ??
        activeBranch;

      if (shouldSkipBranchSwitch(cachedActiveBranch, branchName)) {
        return;
      }

      const previousBranch = cachedActiveBranch;
      const repoPath = activeRepo;
      const requestVersion = ++branchRequestVersionRef.current;
      const cancelBranchQueries = async (): Promise<void> => {
        await Promise.all([
          queryClient.cancelQueries(
            { queryKey: gitQueryKeys.currentBranch(repoPath), exact: true },
            { silent: true },
          ),
          queryClient.cancelQueries(
            { queryKey: gitQueryKeys.branches(repoPath), exact: true },
            { silent: true },
          ),
        ]);
      };
      setSwitchingBranchRepoPath(repoPath);

      try {
        await cancelBranchQueries();

        let current: GitCurrentBranch;

        try {
          current = await hostClient.gitSwitchBranch(repoPath, branchName);
        } catch (error) {
          if (isCurrentBranchRequest(repoPath, requestVersion)) {
            queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), previousBranch);

            toast.error("Failed to switch branch", {
              description: errorMessage(error),
            });
          }
          return;
        }

        if (isCurrentBranchRequest(repoPath, requestVersion)) {
          await cancelBranchQueries();

          if (!isCurrentBranchRequest(repoPath, requestVersion)) {
            return;
          }

          queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), current);
          updateBranchSyncDegradedForRepo(repoPath, false);

          try {
            await invalidateRepoBranchesQuery(queryClient, repoPath);
            await loadRepoBranchesFromQuery(queryClient, repoPath, hostClient);
          } catch (error) {
            if (isCurrentBranchRequest(repoPath, requestVersion)) {
              toast.error("Branch switched, but failed to refresh branch list", {
                description: errorMessage(error),
              });

              throw error;
            }
          }
        }
      } finally {
        if (branchRequestVersionRef.current === requestVersion) {
          setSwitchingBranchRepoPath(null);
        }
      }
    },
    [
      activeBranch,
      activeRepo,
      hostClient,
      isCurrentBranchRequest,
      queryClient,
      updateBranchSyncDegradedForRepo,
    ],
  );

  return {
    branches,
    activeBranch,
    isLoadingBranches,
    isSwitchingBranch,
    refreshBranches,
    switchBranch,
    clearBranchData,
  };
}
