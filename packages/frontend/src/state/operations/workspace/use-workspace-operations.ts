import { useCallback, useState } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { host } from "../shared/host";
import { useWorkspaceBranchOperations } from "./use-workspace-branch-operations";
import { useWorkspaceBranchProbe } from "./use-workspace-branch-probe";
import { useWorkspaceSelectionOperations } from "./use-workspace-selection-operations";
import type {
  UseWorkspaceOperationsResult,
  WorkspaceOperationsHostClient,
} from "./workspace-operations-types";

type UseWorkspaceOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
  clearTaskData: () => void;
  clearActiveTaskStoreCheck: () => void;
  hostClient?: WorkspaceOperationsHostClient;
};

export function useWorkspaceOperations({
  activeWorkspace,
  setActiveWorkspace,
  clearTaskData,
  clearActiveTaskStoreCheck,
  hostClient = host,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const activeRepo = activeWorkspace?.repoPath ?? null;
  const [branchSyncDegradedState, setBranchSyncDegradedState] = useState<{
    repoPath: string | null;
    value: boolean;
  }>({
    repoPath: activeRepo,
    value: false,
  });
  const setBranchSyncDegraded = useCallback((repoPath: string | null, value: boolean): void => {
    setBranchSyncDegradedState((current) =>
      current.repoPath === repoPath && current.value === value ? current : { repoPath, value },
    );
  }, []);
  const clearBranchSyncDegraded = useCallback(
    (repoPath: string | null): void => {
      setBranchSyncDegraded(repoPath, false);
    },
    [setBranchSyncDegraded],
  );

  const {
    branches,
    activeBranch,
    isLoadingBranches,
    isSwitchingBranch,
    refreshBranches,
    switchBranch,
    clearBranchData,
    branchProbeController,
  } = useWorkspaceBranchOperations({
    activeRepo,
    hostClient,
    clearBranchSyncDegraded,
  });

  const {
    workspaces,
    isSwitchingWorkspace,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    reorderWorkspaces,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  } = useWorkspaceSelectionOperations({
    activeWorkspace,
    setActiveWorkspace,
    clearTaskData,
    clearActiveTaskStoreCheck,
    clearBranchData,
    hostClient,
  });

  const branchSyncDegraded =
    branchSyncDegradedState.repoPath === activeRepo ? branchSyncDegradedState.value : false;

  useWorkspaceBranchProbe({
    activeRepoPath: activeRepo,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    hostClient,
    branchProbeController,
    setBranchSyncDegraded,
  });

  return {
    workspaces,
    branches,
    activeBranch,
    isSwitchingWorkspace,
    isLoadingBranches,
    isSwitchingBranch,
    branchSyncDegraded,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    reorderWorkspaces,
    refreshBranches,
    switchBranch,
    clearBranchData,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  };
}
