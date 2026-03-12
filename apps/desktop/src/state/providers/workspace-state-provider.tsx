import { type PropsWithChildren, type ReactElement, useMemo } from "react";
import { buildWorkspaceStateValue, findActiveWorkspace } from "../app-state-context-values";
import {
  useActiveRepoContext,
  useChecksOperationsContext,
  useTaskControlContext,
  WorkspaceOperationsContext,
  type WorkspaceOperationsContextValue,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useRepoSettingsOperations, useWorkspaceOperations } from "../operations";

export function WorkspaceStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeRepo, setActiveRepo } = useActiveRepoContext();
  const { clearTaskData } = useTaskControlContext();
  const { clearActiveBeadsCheck } = useChecksOperationsContext();

  const {
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
  } = useWorkspaceOperations({
    activeRepo,
    setActiveRepo,
    clearTaskData,
    clearActiveBeadsCheck,
  });

  const {
    loadRepoSettings,
    saveRepoSettings,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  } =
    useRepoSettingsOperations({
      activeRepo,
      applyWorkspaceRecords,
      applyWorkspaceRecord,
    });

  const activeWorkspace = useMemo(
    () => findActiveWorkspace(workspaces, activeRepo),
    [activeRepo, workspaces],
  );

  const workspaceStateValue = useMemo(
    () =>
      buildWorkspaceStateValue({
        isSwitchingWorkspace,
        isLoadingBranches,
        isSwitchingBranch,
        branchSyncDegraded,
        workspaces,
        activeRepo,
        activeWorkspace,
        branches,
        activeBranch,
        addWorkspace,
        selectWorkspace,
        refreshBranches,
        switchBranch,
        loadRepoSettings,
        saveRepoSettings,
        loadSettingsSnapshot,
        detectGithubRepository,
        saveGlobalGitConfig,
        saveSettingsSnapshot,
      }),
    [
      activeRepo,
      activeBranch,
      activeWorkspace,
      addWorkspace,
      branches,
      isLoadingBranches,
      isSwitchingBranch,
      isSwitchingWorkspace,
      branchSyncDegraded,
      loadRepoSettings,
      loadSettingsSnapshot,
      detectGithubRepository,
      saveGlobalGitConfig,
      refreshBranches,
      saveRepoSettings,
      saveSettingsSnapshot,
      selectWorkspace,
      switchBranch,
      workspaces,
    ],
  );

  const workspaceOperationsValue = useMemo<WorkspaceOperationsContextValue>(
    () => ({
      refreshWorkspaces,
      refreshBranches,
      clearBranchData,
    }),
    [clearBranchData, refreshBranches, refreshWorkspaces],
  );

  return (
    <WorkspaceOperationsContext.Provider value={workspaceOperationsValue}>
      <WorkspaceStateContext.Provider value={workspaceStateValue}>
        {children}
      </WorkspaceStateContext.Provider>
    </WorkspaceOperationsContext.Provider>
  );
}
