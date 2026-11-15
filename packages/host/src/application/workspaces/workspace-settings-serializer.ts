import type { WorkspaceSettingsService } from "./workspace-settings-model";
import { createSerialLane } from "../../effect/serial-gate";

export const withSerializedConfigWrites = (
  service: WorkspaceSettingsService,
): WorkspaceSettingsService => {
  const serialize = createSerialLane().run;

  return {
    ...service,
    createCustomAgentRole: (input) => serialize(service.createCustomAgentRole(input)),
    updateCustomAgentRole: (id, input) => serialize(service.updateCustomAgentRole(id, input)),
    deleteCustomAgentRole: (id) => serialize(service.deleteCustomAgentRole(id)),
    addWorkspace: (input) => serialize(service.addWorkspace(input)),
    selectWorkspace: (workspaceId) => serialize(service.selectWorkspace(workspaceId)),
    closeWorkspace: (workspaceId, expectedRepoPath) =>
      serialize(service.closeWorkspace(workspaceId, expectedRepoPath)),
    reopenWorkspace: (workspaceId, expectedRepoPath) =>
      serialize(service.reopenWorkspace(workspaceId, expectedRepoPath)),
    removeWorkspaceRegistration: (workspaceId, expectedRepoPath) =>
      serialize(service.removeWorkspaceRegistration(workspaceId, expectedRepoPath)),
    beginWorkspaceRemoval: (input) => serialize(service.beginWorkspaceRemoval(input)),
    recordWorkspaceRemovalProgress: (input) =>
      serialize(service.recordWorkspaceRemovalProgress(input)),
    reorderWorkspaces: (workspaceOrder) => serialize(service.reorderWorkspaces(workspaceOrder)),
    replaceAgentStudioState: (workspaceId, state) =>
      serialize(service.replaceAgentStudioState(workspaceId, state)),
    applyAgentStudioStateAction: (workspaceId, action) =>
      serialize(service.applyAgentStudioStateAction(workspaceId, action)),
    updateRepoGitConfig: (workspaceId, git) =>
      serialize(service.updateRepoGitConfig(workspaceId, git)),
    saveSettingsSnapshotWith: (prepared, commit) =>
      serialize(service.saveSettingsSnapshotWith(prepared, commit)),
    updateAgentModelFavorites: (favorites) =>
      serialize(service.updateAgentModelFavorites(favorites)),
    updateKanbanTaskCardView: (taskCardView) =>
      serialize(service.updateKanbanTaskCardView(taskCardView)),
    updateSidebarSessionGrouping: (grouping) =>
      serialize(service.updateSidebarSessionGrouping(grouping)),
    setTheme: (theme) => serialize(service.setTheme(theme)),
    saveRemoteAccessSettings: (settings) => serialize(service.saveRemoteAccessSettings(settings)),
  };
};
