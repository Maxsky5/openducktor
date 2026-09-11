import {
  agentModelFavoritesSchema,
  globalConfigSchema,
  globalGitConfigSchema,
  repoConfigSchema,
  settingsSnapshotSaveInputSchema,
  themeSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import { buildAgentStudioStateUpdate } from "./workspace-agent-studio-state";
import { createWorkspaceLifecycleSettingsMethods } from "./workspace-lifecycle-settings";
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
  openWorkspaceRecordsInEffectiveOrder,
  requireConfiguredWorkspace,
  saveAndReturnWorkspaceRecord,
  toSettingsSnapshot,
  touchRecentWorkspace,
  validateAndNormalizeRepoConfig,
  type WorkspaceSettingsService,
  workspaceRecordsInEffectiveOrder,
} from "./workspace-settings-model";

export type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

const createUnserializedWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
): WorkspaceSettingsService => ({
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
        defaultRuntimeKind: input.defaultRuntimeKind ?? "opencode",
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
      const parsed = yield* Effect.try({
        try: () => globalConfigSchema.parse(config),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
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

      return yield* Effect.try({
        try: () => repoConfigSchema.parse(repoConfig),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
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
            message: cause instanceof Error ? cause.message : String(cause),
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

      config.workspaces[workspaceId] = yield* Effect.try({
        try: () =>
          repoConfigSchema.parse({
            ...existing,
            hooks,
          }),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
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
      const snapshot = yield* Effect.try({
        try: () => settingsSnapshotSaveInputSchema.parse(rawSnapshot),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
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
      const nextConfig = yield* Effect.try({
        try: () =>
          globalConfigSchema.parse({
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
          }),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

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
      const favorites = yield* Effect.try({
        try: () => agentModelFavoritesSchema.parse(rawFavorites),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      const nextConfig = yield* Effect.try({
        try: () =>
          globalConfigSchema.parse({
            ...config,
            agentModelFavorites: favorites,
          }),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

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
      const nextConfig = yield* Effect.try({
        try: () =>
          globalConfigSchema.parse({
            ...config,
            theme: themeSchema.parse(theme),
          }),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* settingsConfig.writeConfig(nextConfig);
    });
  },
  updateGlobalGitConfig(git) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      const nextConfig = yield* Effect.try({
        try: () =>
          globalConfigSchema.parse({
            ...config,
            git: globalGitConfigSchema.parse(git),
          }),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* settingsConfig.writeConfig(nextConfig);
    });
  },
});

export const createWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
): WorkspaceSettingsService =>
  withSerializedConfigWrites(createUnserializedWorkspaceSettingsService(settingsConfig));
