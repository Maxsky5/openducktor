import { type AgentModelFavorite, isSameAgentModelFavorite } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  WorkspaceOwnershipLock,
  WorkspaceOwnershipLockError,
} from "./workspace-ownership-lock";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export type WorkspaceSettingsOwnershipMode = "acquire" | "already-held";

export const areAgentModelFavoritesEqual = (
  left: readonly AgentModelFavorite[],
  right: readonly AgentModelFavorite[],
): boolean =>
  left.length === right.length &&
  left.every((favorite, index) => isSameAgentModelFavorite(favorite, right[index] ?? null));

export const withSerializedConfigWrites = (
  service: WorkspaceSettingsService,
  ownershipLock: WorkspaceOwnershipLock,
  ownershipMode: WorkspaceSettingsOwnershipMode = "acquire",
): WorkspaceSettingsService => {
  const semaphore = Effect.unsafeMakeSemaphore(1);
  const serialize = semaphore.withPermits(1);
  const serializeOwned = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | WorkspaceOwnershipLockError, R> =>
    ownershipLock.runExclusive(serialize(effect));
  const serializeWrite = ownershipMode === "acquire" ? serializeOwned : serialize;

  return {
    ...service,
    createCustomAgentRole: (input) => serializeWrite(service.createCustomAgentRole(input)),
    updateCustomAgentRole: (id, input) => serializeWrite(service.updateCustomAgentRole(id, input)),
    deleteCustomAgentRole: (id) => serializeWrite(service.deleteCustomAgentRole(id)),
    addWorkspace: (input) => serializeWrite(service.addWorkspace(input)),
    selectWorkspace: (workspaceId) => serializeWrite(service.selectWorkspace(workspaceId)),
    closeWorkspace: (workspaceId, expectedRepoPath) =>
      serializeWrite(service.closeWorkspace(workspaceId, expectedRepoPath)),
    reopenWorkspace: (workspaceId, expectedRepoPath) =>
      serializeWrite(service.reopenWorkspace(workspaceId, expectedRepoPath)),
    removeWorkspaceRegistration: (workspaceId, expectedRepoPath) =>
      serializeWrite(service.removeWorkspaceRegistration(workspaceId, expectedRepoPath)),
    beginWorkspaceRemoval: (input) => serializeWrite(service.beginWorkspaceRemoval(input)),
    recordWorkspaceRemovalProgress: (input) =>
      serializeWrite(service.recordWorkspaceRemovalProgress(input)),
    reorderWorkspaces: (workspaceOrder) =>
      serializeWrite(service.reorderWorkspaces(workspaceOrder)),
    replaceAgentStudioState: (workspaceId, state) =>
      serializeWrite(service.replaceAgentStudioState(workspaceId, state)),
    updateRepoConfig: (workspaceId, update) =>
      serializeWrite(service.updateRepoConfig(workspaceId, update)),
    saveRepoSettings: (workspaceId, settings) =>
      serializeWrite(service.saveRepoSettings(workspaceId, settings)),
    updateRepoHooks: (workspaceId, hooks) =>
      serializeWrite(service.updateRepoHooks(workspaceId, hooks)),
    saveSettingsSnapshot: (snapshot) => serializeWrite(service.saveSettingsSnapshot(snapshot)),
    updateAgentModelFavorites: (favorites) =>
      serializeWrite(service.updateAgentModelFavorites(favorites)),
    setTheme: (theme) => serializeWrite(service.setTheme(theme)),
    updateGlobalGitConfig: (git) => serializeWrite(service.updateGlobalGitConfig(git)),
  };
};
