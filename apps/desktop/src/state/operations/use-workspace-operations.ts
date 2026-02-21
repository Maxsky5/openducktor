import { errorMessage } from "@/lib/errors";
import type { GitBranch, GitCurrentBranch, WorkspaceRecord } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { host } from "./host";

const BRANCH_SYNC_INTERVAL_MS = 30000;

type UseWorkspaceOperationsArgs = {
  activeRepo: string | null;
  setActiveRepo: (repoPath: string | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
};

type UseWorkspaceOperationsResult = {
  workspaces: WorkspaceRecord[];
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  refreshWorkspaces: () => Promise<void>;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  clearBranchData: () => void;
};

export function useWorkspaceOperations({
  activeRepo,
  setActiveRepo,
  clearTaskData,
  clearActiveBeadsCheck,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [activeBranch, setActiveBranch] = useState<GitCurrentBranch | null>(null);
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isSwitchingBranch, setIsSwitchingBranch] = useState(false);
  const workspaceSwitchVersionRef = useRef(0);
  const branchRequestVersionRef = useRef(0);
  const branchSyncInFlightRef = useRef(false);
  const lastKnownBranchNameRef = useRef<string | null>(null);
  const lastKnownDetachedRef = useRef<boolean | null>(null);

  const applyBranchState = useCallback(
    (current: GitCurrentBranch, allBranches: GitBranch[]): void => {
      setActiveBranch(current);
      setBranches(allBranches);
      lastKnownBranchNameRef.current = current.name ?? null;
      lastKnownDetachedRef.current = current.detached;
    },
    [],
  );

  const clearBranchData = useCallback((): void => {
    branchRequestVersionRef.current += 1;
    branchSyncInFlightRef.current = false;
    lastKnownBranchNameRef.current = null;
    lastKnownDetachedRef.current = null;
    setBranches([]);
    setActiveBranch(null);
    setIsLoadingBranches(false);
    setIsSwitchingBranch(false);
  }, []);

  const refreshBranchesForRepo = useCallback(
    async (repoPath: string): Promise<void> => {
      const requestVersion = ++branchRequestVersionRef.current;
      setIsLoadingBranches(true);

      try {
        const [current, allBranches] = await Promise.all([
          host.gitGetCurrentBranch(repoPath),
          host.gitGetBranches(repoPath),
        ]);

        if (branchRequestVersionRef.current !== requestVersion) {
          return;
        }

        applyBranchState(current, allBranches);
      } finally {
        if (branchRequestVersionRef.current === requestVersion) {
          setIsLoadingBranches(false);
        }
      }
    },
    [applyBranchState],
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

      if (activeBranch?.name === branchName && !activeBranch.detached) {
        return;
      }

      const previousBranch = activeBranch;
      const requestVersion = ++branchRequestVersionRef.current;
      setIsSwitchingBranch(true);

      try {
        const current = await host.gitSwitchBranch(activeRepo, branchName);
        const allBranches = await host.gitGetBranches(activeRepo);

        if (branchRequestVersionRef.current !== requestVersion) {
          return;
        }

        applyBranchState(current, allBranches);
      } catch (error) {
        if (branchRequestVersionRef.current !== requestVersion) {
          return;
        }

        setActiveBranch(previousBranch);
        lastKnownBranchNameRef.current = previousBranch?.name ?? null;
        lastKnownDetachedRef.current = previousBranch?.detached ?? null;

        toast.error("Failed to switch branch", {
          description: errorMessage(error),
        });
        throw error;
      } finally {
        if (branchRequestVersionRef.current === requestVersion) {
          setIsSwitchingBranch(false);
          setIsLoadingBranches(false);
        }
      }
    },
    [activeBranch, activeRepo, applyBranchState],
  );

  const probeExternalBranchChange = useCallback(async (): Promise<void> => {
    if (
      !activeRepo ||
      isSwitchingWorkspace ||
      isSwitchingBranch ||
      isLoadingBranches ||
      branchSyncInFlightRef.current
    ) {
      return;
    }

    branchSyncInFlightRef.current = true;

    try {
      const current = await host.gitGetCurrentBranch(activeRepo);
      const currentName = current.name ?? null;
      const hasChanged =
        currentName !== lastKnownBranchNameRef.current ||
        current.detached !== lastKnownDetachedRef.current;

      if (hasChanged) {
        try {
          await refreshBranches(false);
        } catch (error) {
          void error;
        }
      }
    } catch (error) {
      void error;
    } finally {
      branchSyncInFlightRef.current = false;
    }
  }, [activeRepo, isLoadingBranches, isSwitchingBranch, isSwitchingWorkspace, refreshBranches]);

  useEffect(() => {
    if (!activeRepo) {
      clearBranchData();
    }
  }, [activeRepo, clearBranchData]);

  useEffect(() => {
    if (!activeRepo || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleFocus = (): void => {
      void probeExternalBranchChange();
    };

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        void probeExternalBranchChange();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void probeExternalBranchChange();
      }
    }, BRANCH_SYNC_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [activeRepo, probeExternalBranchChange]);

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    const data = await host.workspaceList();
    setWorkspaces(data);
    const active = data.find((entry) => entry.isActive);
    setActiveRepo(active?.path ?? null);
  }, [setActiveRepo]);

  const addWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      if (!repoPath.trim()) {
        return;
      }

      const workspace = await host.workspaceAdd(repoPath.trim());
      await refreshWorkspaces();
      toast.success("Repository added", {
        description: workspace.path,
      });
    },
    [refreshWorkspaces],
  );

  const selectWorkspace = useCallback(
    async (repoPath: string): Promise<void> => {
      const previousRepo = activeRepo;
      const switchVersion = ++workspaceSwitchVersionRef.current;

      setActiveRepo(repoPath);
      clearTaskData();
      clearActiveBeadsCheck();
      clearBranchData();
      setIsSwitchingWorkspace(true);

      try {
        await host.workspaceSelect(repoPath);
        await host.opencodeRepoRuntimeEnsure(repoPath).catch((error) => {
          toast.error("OpenCode server unavailable", {
            description: errorMessage(error),
          });
        });
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        await refreshWorkspaces();
      } catch (error) {
        if (workspaceSwitchVersionRef.current !== switchVersion) {
          return;
        }
        toast.error("Failed to switch repository", {
          description: errorMessage(error),
        });
        setIsSwitchingWorkspace(false);
        setActiveRepo(previousRepo ?? null);
        throw error;
      } finally {
        if (workspaceSwitchVersionRef.current === switchVersion) {
          setIsSwitchingWorkspace(false);
        }
      }
    },
    [
      activeRepo,
      clearBranchData,
      clearTaskData,
      clearActiveBeadsCheck,
      refreshWorkspaces,
      setActiveRepo,
    ],
  );

  return {
    workspaces,
    branches,
    activeBranch,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    refreshBranches,
    switchBranch,
    clearBranchData,
  };
}
