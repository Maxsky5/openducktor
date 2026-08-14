import type { GitBranch, GitCurrentBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import {
  currentBranchQueryOptions,
  gitQueryKeys,
  loadCurrentBranchFromQuery,
  loadRepoBranchesFromQuery,
  repoBranchesQueryOptions,
} from "../../queries/git";
import { shouldSkipBranchSwitch } from "./workspace-operations-model";
import type {
  WorkspaceBranchOperationsHostClient,
  WorkspaceBranchProbeController,
} from "./workspace-operations-types";

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
  branchProbeController: WorkspaceBranchProbeController;
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
  const [, setBranchCacheRevision] = useState(0);
  const [loadingBranchRepoPath, setLoadingBranchRepoPath] = useState<string | null>(null);
  const [switchingBranchRepoPath, setSwitchingBranchRepoPath] = useState<string | null>(null);
  const branchRequestVersionRef = useRef(0);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);
  const lastKnownRevisionRef = useRef<string | null>(null);
  const currentWorkspaceRepoPathRef = useRef(activeRepo);

  useLayoutEffect(() => {
    currentWorkspaceRepoPathRef.current = activeRepo;
  }, [activeRepo]);

  const applyBranchState = useCallback(
    (repoPath: string, current: GitCurrentBranch): void => {
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
      lastKnownRevisionRef.current = current.revision ?? null;
      setBranchCacheRevision((revision) => revision + 1);
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const clearBranchData = useCallback(
    (repoPath = currentWorkspaceRepoPathRef.current): void => {
      branchRequestVersionRef.current += 1;
      lastKnownBranchNameRef.current = null;
      lastKnownDetachedRef.current = null;
      lastKnownRevisionRef.current = null;
      setLoadingBranchRepoPath(null);
      setSwitchingBranchRepoPath(null);
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string, force = false): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;
      const hasCachedBranchData =
        queryClient.getQueryData(gitQueryKeys.currentBranch(repoPath)) !== undefined &&
        queryClient.getQueryData(gitQueryKeys.branches(repoPath)) !== undefined;
      if (!hasCachedBranchData) {
        setLoadingBranchRepoPath(repoPath);
      }

      try {
        if (force) {
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: gitQueryKeys.currentBranch(repoPath),
              exact: true,
              refetchType: "none",
            }),
            queryClient.invalidateQueries({
              queryKey: gitQueryKeys.branches(repoPath),
              exact: true,
              refetchType: "none",
            }),
          ]);
        }

        const [current] = await Promise.all([
          loadCurrentBranchFromQuery(queryClient, repoPath, hostClient),
          loadRepoBranchesFromQuery(queryClient, repoPath, hostClient),
        ]);

        if (
          branchRequestVersionRef.current === requestVersion &&
          currentWorkspaceRepoPathRef.current === repoPath
        ) {
          applyBranchState(repoPath, current);
        }
      } finally {
        if (
          branchRequestVersionRef.current === requestVersion &&
          currentWorkspaceRepoPathRef.current === repoPath
        ) {
          setLoadingBranchRepoPath(null);
        }
      }
    },
    [applyBranchState, hostClient, queryClient],
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

  const cachedBranches = activeRepo
    ? queryClient.getQueryData<GitBranch[]>(gitQueryKeys.branches(activeRepo))
    : undefined;
  const cachedCurrentBranch = activeRepo
    ? queryClient.getQueryData<GitCurrentBranch>(gitQueryKeys.currentBranch(activeRepo))
    : undefined;
  const branches = cachedBranches ?? [];
  const activeBranch = cachedCurrentBranch ?? null;
  const hasBranchData = cachedBranches !== undefined && cachedCurrentBranch !== undefined;
  const isLoadingBranches =
    !hasBranchData &&
    (loadingBranchRepoPath === activeRepo ||
      branchesQuery.isFetching ||
      currentBranchQuery.isFetching);
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
      setSwitchingBranchRepoPath(repoPath);

      try {
        let current: GitCurrentBranch;

        try {
          current = await hostClient.gitSwitchBranch(repoPath, branchName);
        } catch (error) {
          if (
            branchRequestVersionRef.current === requestVersion &&
            currentWorkspaceRepoPathRef.current === repoPath
          ) {
            queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), previousBranch);
            lastKnownBranchNameRef.current = previousBranch?.name ?? null;
            lastKnownDetachedRef.current = previousBranch?.detached ?? null;
            lastKnownRevisionRef.current = previousBranch?.revision ?? null;

            toast.error("Failed to switch branch", {
              description: errorMessage(error),
            });
          }
          return;
        }

        if (
          branchRequestVersionRef.current === requestVersion &&
          currentWorkspaceRepoPathRef.current === repoPath
        ) {
          queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), current);
          applyBranchState(repoPath, current);

          try {
            await queryClient.invalidateQueries({
              queryKey: gitQueryKeys.branches(repoPath),
              exact: true,
              refetchType: "none",
            });

            const allBranches = await loadRepoBranchesFromQuery(queryClient, repoPath, hostClient);

            if (
              branchRequestVersionRef.current === requestVersion &&
              currentWorkspaceRepoPathRef.current === repoPath
            ) {
              queryClient.setQueryData(gitQueryKeys.branches(repoPath), allBranches);
            }
          } catch (error) {
            if (
              branchRequestVersionRef.current === requestVersion &&
              currentWorkspaceRepoPathRef.current === repoPath
            ) {
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
    [activeBranch, activeRepo, applyBranchState, hostClient, queryClient],
  );

  const branchProbeController = useMemo<WorkspaceBranchProbeController>(
    () => ({
      currentWorkspaceRepoPathRef,
      lastKnownBranchNameRef,
      lastKnownDetachedRef,
      lastKnownRevisionRef,
      refreshBranchesForRepo: (repoPath) => refreshBranchesForRepo(repoPath, true),
    }),
    [refreshBranchesForRepo],
  );

  return {
    branches,
    activeBranch,
    isLoadingBranches,
    isSwitchingBranch,
    refreshBranches,
    switchBranch,
    clearBranchData,
    branchProbeController,
  };
}
