import { type AgentModelFavorite, isSameAgentModelFavorite } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceOwnershipLock } from "./workspace-ownership-lock";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const areAgentModelFavoritesEqual = (
  left: readonly AgentModelFavorite[],
  right: readonly AgentModelFavorite[],
): boolean =>
  left.length === right.length &&
  left.every((favorite, index) => isSameAgentModelFavorite(favorite, right[index] ?? null));

export const withSerializedConfigWrites = (
  service: WorkspaceSettingsService,
  ownershipLock: WorkspaceOwnershipLock,
): WorkspaceSettingsService => {
  const semaphore = Effect.unsafeMakeSemaphore(1);
  const serialize = semaphore.withPermits(1);
  const serializeOwned = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    ownershipLock.runExclusive(serialize(effect));

  return {
    ...service,
    createCustomAgentRole: (input) => serialize(service.createCustomAgentRole(input)),
    updateCustomAgentRole: (id, input) => serialize(service.updateCustomAgentRole(id, input)),
    deleteCustomAgentRole: (id) => serialize(service.deleteCustomAgentRole(id)),
    addWorkspace: (input) => serializeOwned(service.addWorkspace(input)),
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
    saveSettingsSnapshot: (snapshot) => serializeOwned(service.saveSettingsSnapshot(snapshot)),
    updateAgentModelFavorites: (favorites) =>
      serialize(service.updateAgentModelFavorites(favorites)),
    setTheme: (theme) => serialize(service.setTheme(theme)),
    updateGlobalGitConfig: (git) => serialize(service.updateGlobalGitConfig(git)),
  };
};
