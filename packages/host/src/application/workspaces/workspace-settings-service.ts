import {
  globalConfigSchema,
  globalGitConfigSchema,
  repoConfigSchema,
  settingsSnapshotUpdateSchema,
  themeSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { LoadedGlobalConfig } from "../../config/global-config";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
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
  workspaceRecordsInEffectiveOrder,
} from "./workspace-settings-model";

export type { WorkspaceSettingsError, WorkspaceSettingsService } from "./workspace-settings-model";

const withSerializedConfigWrites = (
  service: WorkspaceSettingsService,
): WorkspaceSettingsService => {
  const semaphore = Effect.unsafeMakeSemaphore(1);
  const serialize = semaphore.withPermits(1);

  return {
    ...service,
    addWorkspace: (input) => serialize(service.addWorkspace(input)),
    selectWorkspace: (workspaceId) => serialize(service.selectWorkspace(workspaceId)),
    reorderWorkspaces: (workspaceOrder) => serialize(service.reorderWorkspaces(workspaceOrder)),
    updateRepoConfig: (workspaceId, update) =>
      serialize(service.updateRepoConfig(workspaceId, update)),
    saveRepoSettings: (workspaceId, settings) =>
      serialize(service.saveRepoSettings(workspaceId, settings)),
    updateRepoHooks: (workspaceId, hooks) => serialize(service.updateRepoHooks(workspaceId, hooks)),
    saveSettingsSnapshot: (snapshot) => serialize(service.saveSettingsSnapshot(snapshot)),
    setTheme: (theme) => serialize(service.setTheme(theme)),
    updateGlobalGitConfig: (git) => serialize(service.updateGlobalGitConfig(git)),
  };
};

const createUnserializedWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
): WorkspaceSettingsService => ({
  listWorkspaces() {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      return yield* Effect.try({
        try: () => workspaceRecordsInEffectiveOrder(settingsConfig, config),
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
        defaultRuntimeKind: "opencode",
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
      touchRecentWorkspace(config, repoConfig.workspaceId);

      return yield* saveAndReturnWorkspaceRecord(settingsConfig, config, repoConfig.workspaceId);
    });
  },
  selectWorkspace(workspaceId) {
    return Effect.gen(function* () {
      const config = yield* loadGlobalConfig(settingsConfig);
      if (!config.workspaces[workspaceId]) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace not found in config: ${workspaceId}`,
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
      if (workspaceOrder.length !== Object.keys(config.workspaces).length) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace reorder must include exactly ${Object.keys(config.workspaces).length} configured workspaces.`,
            field: "workspaceOrder",
          }),
        );
      }

      const seenWorkspaceIds = new Set<string>();
      for (const workspaceId of workspaceOrder) {
        if (!config.workspaces[workspaceId]) {
          return yield* Effect.fail(
            new HostValidationError({
              message: `Workspace reorder included unknown workspace id: ${workspaceId}`,
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

      config.workspaceOrder = workspaceOrder;
      const parsed = yield* Effect.try({
        try: () => globalConfigSchema.parse(config) as LoadedGlobalConfig,
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
      yield* settingsConfig.writeConfig(parsed);
      return yield* Effect.try({
        try: () => workspaceRecordsInEffectiveOrder(settingsConfig, config),
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
        try: () => settingsSnapshotUpdateSchema.parse(rawSnapshot),
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });
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
            appearance: snapshot.appearance,
            chat: snapshot.chat,
            reusablePrompts: snapshot.reusablePrompts,
            kanban: snapshot.kanban,
            autopilot: snapshot.autopilot,
            agentRuntimes: snapshot.agentRuntimes,
            workspaces,
            globalPromptOverrides: snapshot.globalPromptOverrides,
          }) as LoadedGlobalConfig,
        catch: (cause) =>
          new HostValidationError({
            message: cause instanceof Error ? cause.message : String(cause),
            cause,
          }),
      });

      yield* settingsConfig.writeConfig(nextConfig);
      return yield* Effect.try({
        try: () => workspaceRecordsInEffectiveOrder(settingsConfig, nextConfig),
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
          }) as LoadedGlobalConfig,
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
          }) as LoadedGlobalConfig,
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
