import type { GitBranch, GitCurrentBranch } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import {
  gitQueryKeys,
  loadCurrentBranchFromQuery,
  loadRepoBranchesFromQuery,
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
  const [branchDataRepoPath, setBranchDataRepoPath] = useState<string | null>(activeRepo);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [activeBranch, setActiveBranch] = useState<GitCurrentBranch | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const branchRequestVersionRef = useRef(0);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);
  const lastKnownRevisionRef = useRef<string | null>(null);
  const currentWorkspaceRepoPathRef = useRef(activeRepo);

  useLayoutEffect(() => {
    currentWorkspaceRepoPathRef.current = activeRepo;
  }, [activeRepo]);

  const applyBranchState = useCallback(
    (repoPath: string, current: GitCurrentBranch, allBranches: GitBranch[]): void => {
      setBranchDataRepoPath(repoPath);
      setActiveBranch(current);
      setBranches(allBranches);
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
      lastKnownRevisionRef.current = current.revision ?? null;
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const applyCurrentBranchSnapshot = useCallback(
    (repoPath: string, current: GitCurrentBranch): void => {
      setBranchDataRepoPath(repoPath);
      setActiveBranch(current);
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
      lastKnownRevisionRef.current = current.revision ?? null;
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const clearBranchData = useCallback(
    (repoPath = currentWorkspaceRepoPathRef.current): void => {
      branchRequestVersionRef.current += 1;
      setBranchDataRepoPath(repoPath);
      lastKnownBranchNameRef.current = null;
      lastKnownDetachedRef.current = null;
      lastKnownRevisionRef.current = null;
      setBranches([]);
      setActiveBranch(null);
      setIsLoadingBranches(false);
      setIsSwitchingBranch(false);
      updateBranchSyncDegradedForRepo(repoPath, false);
    },
    [updateBranchSyncDegradedForRepo],
  );

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;
      setBranchDataRepoPath(() => repoPath);
      setBranches([]);
      setActiveBranch(null);
      setIsLoadingBranches(true);

      try {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: gitQueryKeys.currentBranch(repoPath),
          }),
          queryClient.invalidateQueries({
            queryKey: gitQueryKeys.branches(repoPath),
          }),
        ]);

        const [current, allBranches] = await Promise.all([
          loadCurrentBranchFromQuery(queryClient, repoPath, hostClient),
          loadRepoBranchesFromQuery(queryClient, repoPath, hostClient),
        ]);

        if (
          branchRequestVersionRef.current === requestVersion &&
          currentWorkspaceRepoPathRef.current === repoPath
        ) {
          applyBranchState(repoPath, current, allBranches);
        }
      } finally {
        if (
          branchRequestVersionRef.current === requestVersion &&
          currentWorkspaceRepoPathRef.current === repoPath
        ) {
          setIsLoadingBranches(false);
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
        await refreshBranchesForRepo(activeRepo);
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

  const hasCurrentRepoBranchData = branchDataRepoPath === activeRepo;
  const activeBranchForCurrentRepo = hasCurrentRepoBranchData ? activeBranch : null;

  const switchBranch = useCallback(
    async (branchName: string): Promise<void> => {
      if (!activeRepo || !branchName) {
        return;
      }

      if (shouldSkipBranchSwitch(activeBranchForCurrentRepo, branchName)) {
        return;
      }

      const previousBranch = activeBranchForCurrentRepo;
      const repoPath = activeRepo;
      const requestVersion = ++branchRequestVersionRef.current;
      setIsSwitchingBranch(true);

      try {
        let current: GitCurrentBranch;

        try {
          current = await hostClient.gitSwitchBranch(repoPath, branchName);
        } catch (error) {
          if (
            branchRequestVersionRef.current === requestVersion &&
            currentWorkspaceRepoPathRef.current === repoPath
          ) {
            setActiveBranch(previousBranch);
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
          applyCurrentBranchSnapshot(repoPath, current);

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
              setBranches(allBranches);
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
          setIsSwitchingBranch(false);
          setIsLoadingBranches(false);
        }
      }
    },
    [activeBranchForCurrentRepo, activeRepo, applyCurrentBranchSnapshot, hostClient, queryClient],
  );

  const branchProbeController = useMemo<WorkspaceBranchProbeController>(
    () => ({
      currentWorkspaceRepoPathRef,
      lastKnownBranchNameRef,
      lastKnownDetachedRef,
      lastKnownRevisionRef,
      refreshBranchesForRepo,
    }),
    [refreshBranchesForRepo],
  );

  return {
    branches: hasCurrentRepoBranchData ? branches : [],
    activeBranch: activeBranchForCurrentRepo,
    isLoadingBranches: hasCurrentRepoBranchData ? isLoadingBranches : false,
    isSwitchingBranch: hasCurrentRepoBranchData ? isSwitchingBranch : false,
    refreshBranches,
    switchBranch,
    clearBranchData,
    branchProbeController,
  };
}
