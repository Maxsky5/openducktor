import type { GitBranch, GitCurrentBranch } from "@openducktor/contracts";
import { CancelledError, useQuery, useQueryClient } from "@tanstack/react-query";
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

type SwitchingBranchRequest = {
  repoPath: string;
  requestVersion: number;
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
  const [switchingBranchRequest, setSwitchingBranchRequest] =
    useState<SwitchingBranchRequest | null>(null);
  const branchRequestVersionRef = useRef(0);
  const latestSwitchRequestVersionByRepoRef = useRef(new Map<string, number>());
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

  const isLatestSwitchRequest = useCallback(
    (repoPath: string, requestVersion: number): boolean =>
      latestSwitchRequestVersionByRepoRef.current.get(repoPath) === requestVersion,
    [],
  );

  const clearBranchData = useCallback(
    (repoPath = currentWorkspaceRepoPathRef.current): void => {
      branchRequestVersionRef.current += 1;
      setSwitchingBranchRequest(null);
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string, force = false): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;

      if (force) {
        await Promise.all([
          invalidateCurrentBranchQuery(queryClient, repoPath),
          invalidateRepoBranchesQuery(queryClient, repoPath),
        ]);
      }

      try {
        await Promise.all([
          loadCurrentBranchFromQuery(queryClient, repoPath, hostClient),
          loadRepoBranchesFromQuery(queryClient, repoPath, hostClient),
        ]);
      } catch (error) {
        if (error instanceof CancelledError) {
          return;
        }

        throw error;
      }

      if (isCurrentBranchRequest(repoPath, requestVersion)) {
        updateBranchSyncDegradedForRepo(repoPath, false);
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
  const isSwitchingBranch = switchingBranchRequest?.repoPath === activeRepo;

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
      latestSwitchRequestVersionByRepoRef.current.set(repoPath, requestVersion);
      setSwitchingBranchRequest({ repoPath, requestVersion });

      try {
        await cancelBranchQueries();

        let current: GitCurrentBranch;

        try {
          current = await hostClient.gitSwitchBranch(repoPath, branchName);
        } catch (error) {
          if (
            isLatestSwitchRequest(repoPath, requestVersion) &&
            currentWorkspaceRepoPathRef.current === repoPath
          ) {
            queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), previousBranch);

            toast.error("Failed to switch branch", {
              description: errorMessage(error),
            });
          }
          return;
        }

        if (!isLatestSwitchRequest(repoPath, requestVersion)) {
          return;
        }

        await cancelBranchQueries();

        if (!isLatestSwitchRequest(repoPath, requestVersion)) {
          return;
        }

        queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), current);
        if (currentWorkspaceRepoPathRef.current === repoPath) {
          updateBranchSyncDegradedForRepo(repoPath, false);
        }

        try {
          await invalidateRepoBranchesQuery(queryClient, repoPath);
          await loadRepoBranchesFromQuery(queryClient, repoPath, hostClient);
        } catch (error) {
          if (isLatestSwitchRequest(repoPath, requestVersion)) {
            if (currentWorkspaceRepoPathRef.current === repoPath) {
              toast.error("Branch switched, but failed to refresh branch list", {
                description: errorMessage(error),
              });
            }

            throw error;
          }
        }
      } finally {
        if (isLatestSwitchRequest(repoPath, requestVersion)) {
          latestSwitchRequestVersionByRepoRef.current.delete(repoPath);
        }
        setSwitchingBranchRequest((currentRequest) =>
          currentRequest?.repoPath === repoPath && currentRequest.requestVersion === requestVersion
            ? null
            : currentRequest,
        );
      }
    },
    [
      activeBranch,
      activeRepo,
      hostClient,
      isLatestSwitchRequest,
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
