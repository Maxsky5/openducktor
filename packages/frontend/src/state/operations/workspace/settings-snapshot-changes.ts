import {
  workspaceScopeKey,
  workspaceScopeValue,
} from "@openducktor/frontend-core/queries/workspace-scope";
import { jsonValuesEqual, type SettingsSnapshot, type WorkspaceRef } from "@openducktor/contracts";

export type SettingsSnapshotChanges = {
  workspacesChanged: boolean;
  agentRuntimesChanged: boolean;
  customAgentRolesChanged: boolean;
  kanbanDoneVisibleDaysChanged: boolean;
  changedGitProviderWorkspaces: WorkspaceRef[];
};

export const diffSettingsSnapshots = (
  previous: SettingsSnapshot | undefined,
  next: SettingsSnapshot,
): SettingsSnapshotChanges => ({
  workspacesChanged:
    previous === undefined || !jsonValuesEqual(previous.workspaces, next.workspaces),
  agentRuntimesChanged:
    previous === undefined || !jsonValuesEqual(previous.agentRuntimes, next.agentRuntimes),
  customAgentRolesChanged:
    previous === undefined || !jsonValuesEqual(previous.customAgentRoles, next.customAgentRoles),
  kanbanDoneVisibleDaysChanged:
    previous !== undefined && previous.kanban.doneVisibleDays !== next.kanban.doneVisibleDays,
  changedGitProviderWorkspaces: changedGitProviderWorkspaces(previous?.workspaces, next.workspaces),
});

const changedGitProviderWorkspaces = (
  previous: SettingsSnapshot["workspaces"] | undefined,
  next: SettingsSnapshot["workspaces"],
): WorkspaceRef[] => {
  if (previous === undefined) {
    return Object.values(next).map(workspaceScopeValue);
  }

  const scopes = new Map<string, WorkspaceRef>();
  const add = (workspace: WorkspaceRef) =>
    scopes.set(workspaceScopeKey(workspace), workspaceScopeValue(workspace));
  for (const [workspaceId, nextWorkspace] of Object.entries(next)) {
    const previousWorkspace = previous[workspaceId];
    if (previousWorkspace === undefined) {
      add(nextWorkspace);
      continue;
    }
    if (!jsonValuesEqual(previousWorkspace.git, nextWorkspace.git)) {
      add(nextWorkspace);
    }
    if (previousWorkspace.repoPath !== nextWorkspace.repoPath) {
      add(nextWorkspace);
      add(previousWorkspace);
    }
  }
  return [...scopes.values()];
};
