import { type AgentModelFavorite, isSameAgentModelFavorite } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const areAgentModelFavoritesEqual = (
  left: readonly AgentModelFavorite[],
  right: readonly AgentModelFavorite[],
): boolean =>
  left.length === right.length &&
  left.every((favorite, index) => isSameAgentModelFavorite(favorite, right[index] ?? null));

export const withSerializedConfigWrites = (
  service: WorkspaceSettingsService,
): WorkspaceSettingsService => {
  const semaphore = Effect.unsafeMakeSemaphore(1);
  const serialize = semaphore.withPermits(1);

  return {
    ...service,
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
    updateRepoConfig: (workspaceId, update) =>
      serialize(service.updateRepoConfig(workspaceId, update)),
    saveRepoSettings: (workspaceId, settings) =>
      serialize(service.saveRepoSettings(workspaceId, settings)),
    updateRepoHooks: (workspaceId, hooks) => serialize(service.updateRepoHooks(workspaceId, hooks)),
    saveSettingsSnapshot: (snapshot) => serialize(service.saveSettingsSnapshot(snapshot)),
    updateAgentModelFavorites: (favorites) =>
      serialize(service.updateAgentModelFavorites(favorites)),
    setTheme: (theme) => serialize(service.setTheme(theme)),
    updateGlobalGitConfig: (git) => serialize(service.updateGlobalGitConfig(git)),
  };
};
