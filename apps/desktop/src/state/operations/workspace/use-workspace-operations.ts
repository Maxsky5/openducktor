import { useCallback, useRef, useState } from "react";
import { host } from "../shared/host";
import { useWorkspaceBranchOperations } from "./use-workspace-branch-operations";
import { useWorkspaceBranchProbe } from "./use-workspace-branch-probe";
import { useWorkspaceSelectionOperations } from "./use-workspace-selection-operations";
import type {
  PreparedRepoSwitch,
  UseWorkspaceOperationsArgs,
  UseWorkspaceOperationsResult,
} from "./workspace-operations-types";

export function useWorkspaceOperations({
  activeRepo,
  setActiveRepo,
  clearTaskData,
  clearActiveBeadsCheck,
  hostClient = host,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const [branchSyncDegraded, setBranchSyncDegraded] = useState(false);
  const preparedRepoSwitchRef = useRef<PreparedRepoSwitch | null>(null);
  const clearBranchSyncDegraded = useCallback((): void => {
    setBranchSyncDegraded(false);
  }, []);

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
    preparedRepoSwitchRef,
    clearBranchSyncDegraded,
  });

  const {
    workspaces,
    isSwitchingWorkspace,
    refreshWorkspaces,
    addWorkspace,
    selectWorkspace,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  } = useWorkspaceSelectionOperations({
    activeRepo,
    setActiveRepo,
    clearTaskData,
    clearActiveBeadsCheck,
    clearBranchData,
    hostClient,
    preparedRepoSwitchRef,
  });

  useWorkspaceBranchProbe({
    activeRepo,
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
    refreshBranches,
    switchBranch,
    clearBranchData,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  };
}
