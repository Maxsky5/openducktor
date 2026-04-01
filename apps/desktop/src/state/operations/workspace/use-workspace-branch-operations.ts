import type { GitBranch, GitCurrentBranch } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import {
  gitQueryKeys,
  loadCurrentBranchFromQuery,
  loadRepoBranchesFromQuery,
} from "../../queries/git";
import {
  shouldResetBranchStateForRepoChange,
  shouldSkipBranchSwitch,
} from "./workspace-operations-model";
import type {
  PreparedRepoSwitchRef,
  WorkspaceBranchOperationsHostClient,
  WorkspaceBranchProbeController,
} from "./workspace-operations-types";

type UseWorkspaceBranchOperationsArgs = {
  activeRepo: string | null;
  hostClient: WorkspaceBranchOperationsHostClient;
  preparedRepoSwitchRef: PreparedRepoSwitchRef;
  clearBranchSyncDegraded: () => void;
};

type UseWorkspaceBranchOperationsResult = {
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: () => void;
  branchProbeController: WorkspaceBranchProbeController;
};

export function useWorkspaceBranchOperations({
  activeRepo,
  hostClient,
  preparedRepoSwitchRef,
  clearBranchSyncDegraded,
}: UseWorkspaceBranchOperationsArgs): UseWorkspaceBranchOperationsResult {
  const queryClient = useQueryClient();
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [activeBranch, setActiveBranch] = useState<GitCurrentBranch | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const branchRequestVersionRef = useRef(0);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);
  const lastKnownRevisionRef = useRef<string | null>(null);
  const activeRepoRef = useRef(activeRepo);
  const previousActiveRepoRef = useRef(activeRepo);

  activeRepoRef.current = activeRepo;

  const applyBranchState = useCallback(
    (current: GitCurrentBranch, allBranches: GitBranch[]): void => {
      setActiveBranch(current);
      setBranches(allBranches);
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
      lastKnownRevisionRef.current = current.revision ?? null;
      clearBranchSyncDegraded();
    },
    [clearBranchSyncDegraded],
  );

  const applyCurrentBranchSnapshot = useCallback(
    (current: GitCurrentBranch): void => {
      setActiveBranch(current);
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
      lastKnownRevisionRef.current = current.revision ?? null;
      clearBranchSyncDegraded();
    },
    [clearBranchSyncDegraded],
  );

  const clearBranchData = useCallback((): void => {
    branchRequestVersionRef.current += 1;
    lastKnownBranchNameRef.current = null;
    lastKnownDetachedRef.current = null;
    lastKnownRevisionRef.current = null;
    setBranches([]);
    setActiveBranch(null);
    setIsLoadingBranches(false);
    setIsSwitchingBranch(false);
    clearBranchSyncDegraded();
  }, [clearBranchSyncDegraded]);

  useEffect(() => {
    const previousActiveRepo = previousActiveRepoRef.current;
    const preparedRepoSwitch = preparedRepoSwitchRef.current;
    const shouldSkipPreparedRepoReset =
      preparedRepoSwitch?.previousRepo === previousActiveRepo &&
      preparedRepoSwitch.nextRepo === activeRepo;

    preparedRepoSwitchRef.current = null;
    previousActiveRepoRef.current = activeRepo;

    if (
      !shouldSkipPreparedRepoReset &&
      shouldResetBranchStateForRepoChange(previousActiveRepo, activeRepo)
    ) {
      clearBranchData();
    }
  }, [activeRepo, clearBranchData, preparedRepoSwitchRef]);

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;
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
          branchRequestVersionRef.current !== requestVersion ||
          activeRepoRef.current !== repoPath
        ) {
          return;
        }

        applyBranchState(current, allBranches);
      } finally {
        if (
          branchRequestVersionRef.current === requestVersion &&
          activeRepoRef.current === repoPath
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

  const switchBranch = useCallback(
    async (branchName: string): Promise<void> => {
      if (!activeRepo || !branchName) {
        return;
      }

      if (shouldSkipBranchSwitch(activeBranch, branchName)) {
        return;
      }

      const previousBranch = activeBranch;
      const repoPath = activeRepo;
      const requestVersion = ++branchRequestVersionRef.current;
      setIsSwitchingBranch(true);

      try {
        const current = await hostClient.gitSwitchBranch(repoPath, branchName);

        if (
          branchRequestVersionRef.current !== requestVersion ||
          activeRepoRef.current !== repoPath
        ) {
          return;
        }

        queryClient.setQueryData(gitQueryKeys.currentBranch(repoPath), current);
        applyCurrentBranchSnapshot(current);

        try {
          const allBranches = await hostClient.gitGetBranches(repoPath);

          if (
            branchRequestVersionRef.current !== requestVersion ||
            activeRepoRef.current !== repoPath
          ) {
            return;
          }

          queryClient.setQueryData(gitQueryKeys.branches(repoPath), allBranches);
          setBranches(allBranches);
        } catch (error) {
          if (
            branchRequestVersionRef.current !== requestVersion ||
            activeRepoRef.current !== repoPath
          ) {
            return;
          }

          await queryClient.invalidateQueries({
            queryKey: gitQueryKeys.branches(repoPath),
            exact: true,
            refetchType: "none",
          });

          toast.error("Branch switched, but failed to refresh branch list", {
            description: errorMessage(error),
          });
        }
      } catch (error) {
        if (
          branchRequestVersionRef.current !== requestVersion ||
          activeRepoRef.current !== repoPath
        ) {
          return;
        }

        setActiveBranch(previousBranch);
        lastKnownBranchNameRef.current = previousBranch?.name ?? null;
        lastKnownDetachedRef.current = previousBranch?.detached ?? null;
        lastKnownRevisionRef.current = previousBranch?.revision ?? null;

        toast.error("Failed to switch branch", {
          description: errorMessage(error),
        });
      } finally {
        if (branchRequestVersionRef.current === requestVersion) {
          setIsSwitchingBranch(false);
          setIsLoadingBranches(false);
        }
      }
    },
    [activeBranch, activeRepo, applyCurrentBranchSnapshot, hostClient, queryClient],
  );

  const branchProbeController = useMemo<WorkspaceBranchProbeController>(
    () => ({
      activeRepoRef,
      lastKnownBranchNameRef,
      lastKnownDetachedRef,
      lastKnownRevisionRef,
      refreshBranchesForRepo,
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
