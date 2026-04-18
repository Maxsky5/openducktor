import type { WorkspaceRecord } from "@openducktor/contracts";
import { type PropsWithChildren, type ReactElement, useEffect, useMemo, useRef } from "react";
import { buildWorkspaceStateValue } from "../app-state-context-values";
import {
  useActiveWorkspaceContext,
  useChecksOperationsContext,
  useTaskControlContext,
  WorkspaceOperationsContext,
  type WorkspaceOperationsContextValue,
  WorkspaceStateContext,
} from "../app-state-contexts";
import { useRepoSettingsOperations, useWorkspaceOperations } from "../operations";

export function WorkspaceStateProvider({ children }: PropsWithChildren): ReactElement {
  const { activeWorkspace, setActiveWorkspace } = useActiveWorkspaceContext();
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
    reorderWorkspaces,
    refreshBranches,
    switchBranch,
    clearBranchData,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  } = useWorkspaceOperations({
    activeWorkspace,
    setActiveWorkspace,
    clearTaskData,
    clearActiveBeadsCheck,
  });

  const lastResolvedActiveWorkspaceRef = useRef<WorkspaceRecord | null>(null);

  const matchedActiveWorkspace = useMemo(
    () =>
      activeWorkspace
        ? (workspaces.find((workspace) => workspace.workspaceId === activeWorkspace.workspaceId) ??
          workspaces.find((workspace) => workspace.repoPath === activeWorkspace.repoPath) ??
          null)
        : null,
    [activeWorkspace, workspaces],
  );

  const resolvedActiveWorkspace = useMemo(() => {
    if (matchedActiveWorkspace) {
      return matchedActiveWorkspace;
    }

    if (!activeWorkspace) {
      return null;
    }

    const previous = lastResolvedActiveWorkspaceRef.current;
    if (
      previous &&
      (previous.workspaceId === activeWorkspace.workspaceId ||
        previous.repoPath === activeWorkspace.repoPath)
    ) {
      return previous;
    }

    return null;
  }, [activeWorkspace, matchedActiveWorkspace]);

  useEffect(() => {
    if (matchedActiveWorkspace) {
      lastResolvedActiveWorkspaceRef.current = matchedActiveWorkspace;
      return;
    }

    if (!activeWorkspace) {
      lastResolvedActiveWorkspaceRef.current = null;
    }
  }, [activeWorkspace, matchedActiveWorkspace]);

  const {
    loadRepoSettings,
    saveRepoSettings,
    loadSettingsSnapshot,
    detectGithubRepository,
    saveGlobalGitConfig,
    saveSettingsSnapshot,
  } = useRepoSettingsOperations({
    activeWorkspace: resolvedActiveWorkspace,
    applyWorkspaceRecords,
    applyWorkspaceRecord,
  });

  const workspaceStateValue = useMemo(
    () =>
      buildWorkspaceStateValue({
        isSwitchingWorkspace,
        isLoadingBranches,
        isSwitchingBranch,
        branchSyncDegraded,
        workspaces,
        activeWorkspace: resolvedActiveWorkspace,
        branches,
        activeBranch,
        addWorkspace,
        selectWorkspace,
        reorderWorkspaces,
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
      activeBranch,
      resolvedActiveWorkspace,
      addWorkspace,
      branches,
      isLoadingBranches,
      isSwitchingBranch,
      isSwitchingWorkspace,
      branchSyncDegraded,
      loadRepoSettings,
      loadSettingsSnapshot,
      detectGithubRepository,
      reorderWorkspaces,
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
