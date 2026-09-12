import {
  agentModelFavoritesSchema,
  globalConfigSchema,
  repoConfigSchema,
  settingsSnapshotSaveInputSchema,
  type RepoConfig,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { configValidationMessage } from "../../config/config-validation-message";
import { parseConfig } from "../../config/parse-config";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { buildAgentStudioStateUpdate } from "./workspace-agent-studio-state";
import { createCustomAgentRoleOperations } from "./custom-agent-role-operations";
import {
  openWorkspaceRecordsInEffectiveOrder,
  workspaceRecordsInEffectiveOrder,
} from "./workspace-catalog-model";
import { createWorkspaceLifecycleSettingsMethods } from "./workspace-lifecycle-settings";
import type { WorkspaceOwnershipLock } from "./workspace-ownership-lock";
import {
  areAgentModelFavoritesEqual,
  withSerializedConfigWrites,
} from "./workspace-settings-serializer";
import {
  buildMergedRepoConfig,
  ensureRepoPathAvailable,
  findRepoConfigByRepoPath,
  loadGlobalConfig,
  normalizeSnapshotWorkspaces,
  requireConfiguredWorkspace,
  saveAndReturnWorkspaceRecord,
  toSettingsSnapshot,
  touchRecentWorkspace,
  validateAndNormalizeRepoConfig,
  type WorkspaceSettingsService,
} from "./workspace-settings-model";

export type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

const assertNoIncompleteRemoval = (workspaceId: string, repoConfig: RepoConfig) =>
  repoConfig.removal
    ? Effect.fail(
        new HostValidationError({
          message: `Workspace removal is incomplete for ${workspaceId}. Finish the removal before changing repository settings.`,
          field: "workspaceId",
        }),
      )
    : Effect.void;

const createUnserializedWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
): WorkspaceSettingsService => ({
  ...createCustomAgentRoleOperations(settingsConfig),
  ...createWorkspaceLifecycleSettingsMethods(settingsConfig),
  listWorkspaces() {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      return yield* Effect.try({
        try: () => openWorkspaceRecordsInEffectiveOrder(settingsConfig, config),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  addWorkspace(input) {
    return Effect.gen(function* () {
      const repoConfig = yield* validateAndNormalizeRepoConfig(settingsConfig, {
        workspaceId: input.workspaceId,
        workspaceName: input.workspaceName,
        repoPath: input.repoPath,
        abbreviation: input.abbreviation,
        tileColor: input.tileColor,
      });
      const config = yield* loadGlobalConfig(settingsConfig);

      if (config.workspaces[repoConfig.workspaceId]) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace already exists in config: ${repoConfig.workspaceId}`,
            field: "workspaceId",
          }),
        );
      }
      yield* Effect.try({
        try: () => ensureRepoPathAvailable(config, repoConfig.repoPath),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      config.workspaces[repoConfig.workspaceId] = repoConfig;
      config.workspaceOrder = [...config.workspaceOrder, repoConfig.workspaceId];
      config.activeWorkspace = repoConfig.workspaceId;
      config.onboardingCompleted = true;
      touchRecentWorkspace(config, repoConfig.workspaceId);

      return yield* saveAndReturnWorkspaceRecord(settingsConfig, config, repoConfig.workspaceId);
    });
  },
  selectWorkspace(workspaceId) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = config.workspaces[workspaceId];
      if (!repoConfig) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace not found in config: ${workspaceId}`,
            field: "workspaceId",
          }),
        );
      }
      if (repoConfig.closed) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace is closed: ${workspaceId}. Reopen it before selecting it.`,
            field: "workspaceId",
          }),
        );
      }
      if (repoConfig.removal) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace removal is incomplete for ${workspaceId}. Retry removal from the workspace rail before using it.`,
            field: "workspaceId",
          }),
        );
      }

      config.activeWorkspace = workspaceId;
      touchRecentWorkspace(config, workspaceId);
      return yield* saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
    });
  },
  reorderWorkspaces(workspaceOrder) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const openWorkspaceIds = openWorkspaceRecordsInEffectiveOrder(settingsConfig, config).map(
        (record) => record.workspaceId,
      );
      if (workspaceOrder.length !== openWorkspaceIds.length) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace reorder must include exactly ${openWorkspaceIds.length} open workspaces.`,
            field: "workspaceOrder",
          }),
        );
      }

      const openWorkspaceIdSet = new Set(openWorkspaceIds);
      const seenWorkspaceIds = new Set<string>();
      for (const workspaceId of workspaceOrder) {
        if (!openWorkspaceIdSet.has(workspaceId)) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Workspace reorder included unknown or closed workspace id: ${workspaceId}`,
              field: "workspaceOrder",
            }),
          );
        }
        if (seenWorkspaceIds.has(workspaceId)) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Workspace reorder included duplicate workspace id: ${workspaceId}`,
              field: "workspaceOrder",
            }),
          );
        }
        seenWorkspaceIds.add(workspaceId);
      }

      let openIndex = 0;
      config.workspaceOrder = workspaceRecordsInEffectiveOrder(settingsConfig, config).map(
        (record) => {
          if (!openWorkspaceIdSet.has(record.workspaceId)) {
            return record.workspaceId;
          }
          const nextWorkspaceId = workspaceOrder[openIndex];
          openIndex += 1;
          return nextWorkspaceId ?? record.workspaceId;
        },
      );
      const parsed = yield* parseConfig(globalConfigSchema, config);
      yield* settingsConfig.writeConfig(parsed);
      return yield* Effect.try({
        try: () => openWorkspaceRecordsInEffectiveOrder(settingsConfig, config),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  getRepoConfig(workspaceId) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const repoConfig = config.workspaces[workspaceId];
      if (!repoConfig) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace is not configured: ${workspaceId}`,
            field: "workspaceId",
          }),
        );
      }

      return yield* parseConfig(repoConfigSchema, repoConfig);
    });
  },
  getRepoConfigByRepoPath(rawRepoPath) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      return yield* findRepoConfigByRepoPath(settingsConfig, config, rawRepoPath);
    });
  },
  replaceAgentStudioState(workspaceId, rawState) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const update = yield* Effect.try({
        try: () => buildAgentStudioStateUpdate(config, workspaceId, rawState),
        catch: (cause) =>
          new HostValidationError({
            message: configValidationMessage(cause, rawState),
            cause,
          }),
      });

      yield* settingsConfig.writeConfig(update.config);
      return update.repoConfig;
    });
  },
  updateRepoConfig(workspaceId, update) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const existing = yield* Effect.try({
        try: () => requireConfiguredWorkspace(config, workspaceId),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* assertNoIncompleteRemoval(workspaceId, existing);
      const nextRepoConfig = yield* validateAndNormalizeRepoConfig(
        settingsConfig,
        buildMergedRepoConfig(workspaceId, existing, update, false),
      );
      yield* Effect.try({
        try: () => ensureRepoPathAvailable(config, nextRepoConfig.repoPath, workspaceId),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      config.workspaces[workspaceId] = nextRepoConfig;
      if (config.activeWorkspace === undefined) {
        config.activeWorkspace = workspaceId;
      }
      touchRecentWorkspace(config, workspaceId);
      return yield* saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
    });
  },
  saveRepoSettings(workspaceId, settings) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const existing = yield* Effect.try({
        try: () => requireConfiguredWorkspace(config, workspaceId),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* assertNoIncompleteRemoval(workspaceId, existing);
      const nextRepoConfig = yield* validateAndNormalizeRepoConfig(
        settingsConfig,
        buildMergedRepoConfig(workspaceId, existing, settings, true),
      );
      yield* Effect.try({
        try: () => ensureRepoPathAvailable(config, nextRepoConfig.repoPath, workspaceId),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      config.workspaces[workspaceId] = nextRepoConfig;
      touchRecentWorkspace(config, workspaceId);
      return yield* saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
    });
  },
  updateRepoHooks(workspaceId, hooks) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const existing = yield* Effect.try({
        try: () => requireConfiguredWorkspace(config, workspaceId),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      const payload = { ...existing, hooks };
      config.workspaces[workspaceId] = yield* parseConfig(repoConfigSchema, payload);
      touchRecentWorkspace(config, workspaceId);
      return yield* saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
    });
  },
  getSettingsSnapshot() {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      return yield* Effect.try({
        try: () => toSettingsSnapshot(config),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  saveSettingsSnapshot(rawSnapshot) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const snapshot = yield* parseConfig(settingsSnapshotSaveInputSchema, rawSnapshot);
      if (!areAgentModelFavoritesEqual(snapshot.agentModelFavorites, config.agentModelFavorites)) {
        return yield* Effect.fail(
          new HostValidationError({
            message:
              "Model favorites changed since settings were loaded. Reload settings and retry.",
            field: "agentModelFavorites",
          }),
        );
      }
      const workspaces = yield* normalizeSnapshotWorkspaces(
        settingsConfig,
        config,
        snapshot.workspaces,
      );
      const payload = {
        ...config,
        git: snapshot.git,
        general: snapshot.general,
        system: snapshot.system,
        appearance: snapshot.appearance,
        chat: snapshot.chat,
        reusablePrompts: snapshot.reusablePrompts,
        kanban: snapshot.kanban,
        autopilot: snapshot.autopilot,
        notifications: snapshot.notifications,
        agentRuntimes: snapshot.agentRuntimes,
        agentModelFavorites: config.agentModelFavorites,
        workspaces,
        globalPromptOverrides: snapshot.globalPromptOverrides,
      };
      if (snapshot.customAgentRoles !== undefined)
        payload.customAgentRoles = snapshot.customAgentRoles;
      const nextConfig = yield* parseConfig(globalConfigSchema, payload);

      yield* settingsConfig.writeConfig(nextConfig);
      return yield* Effect.try({
        try: () => openWorkspaceRecordsInEffectiveOrder(settingsConfig, nextConfig),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  updateAgentModelFavorites(rawFavorites) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const favorites = yield* parseConfig(agentModelFavoritesSchema, rawFavorites);
      const payload = { ...config, agentModelFavorites: favorites };
      const nextConfig = yield* parseConfig(globalConfigSchema, payload);

      yield* settingsConfig.writeConfig(nextConfig);
      return yield* Effect.try({
        try: () => toSettingsSnapshot(nextConfig),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
    });
  },
  setTheme(theme) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const nextConfig = yield* parseConfig(globalConfigSchema, { ...config, theme });
      yield* settingsConfig.writeConfig(nextConfig);
    });
  },
  updateGlobalGitConfig(git) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const nextConfig = yield* parseConfig(globalConfigSchema, { ...config, git });
      yield* settingsConfig.writeConfig(nextConfig);
    });
  },
});

export const createWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
  ownershipLock?: WorkspaceOwnershipLock,
): WorkspaceSettingsService =>
  withSerializedConfigWrites(
    createUnserializedWorkspaceSettingsService(settingsConfig),
    ownershipLock,
  );
