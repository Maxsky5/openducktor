import type { WorkspaceRecord } from "@openducktor/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ActiveWorkspace } from "@/types/state-slices";
import { host } from "../shared/host";
import { useWorkspaceBranchOperations } from "./use-workspace-branch-operations";
import { useWorkspaceBranchProbe } from "./use-workspace-branch-probe";
import { useWorkspaceSelectionOperations } from "./use-workspace-selection-operations";
import type {
  PreparedRepoSwitch,
  UseWorkspaceOperationsResult,
  WorkspaceOperationsHostClient,
} from "./workspace-operations-types";

type UseWorkspaceOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
  clearTaskData: () => void;
  clearActiveBeadsCheck: () => void;
  hostClient?: WorkspaceOperationsHostClient;
};

export function useWorkspaceOperations({
  activeWorkspace,
  setActiveWorkspace,
  clearTaskData,
  clearActiveBeadsCheck,
  hostClient = host,
}: UseWorkspaceOperationsArgs): UseWorkspaceOperationsResult {
  const activeRepo = activeWorkspace?.repoPath ?? null;
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
    reorderWorkspaces,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  } = useWorkspaceSelectionOperations({
    activeWorkspace,
    setActiveWorkspace,
    clearTaskData,
    clearActiveBeadsCheck,
    clearBranchData,
    hostClient,
    preparedRepoSwitchRef,
  });

  const resolvedActiveWorkspace = useMemo<WorkspaceRecord | null>(
    () => workspaces.find((workspace) => workspace.repoPath === activeRepo) ?? null,
    [activeRepo, workspaces],
  );

  useWorkspaceBranchProbe({
    activeWorkspace: resolvedActiveWorkspace,
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
