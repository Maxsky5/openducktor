import {
  globalConfigSchema,
  globalGitConfigSchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  themeSchema,
} from "@openducktor/contracts";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import {
  buildMergedRepoConfig,
  ensureRepoPathAvailable,
  findRepoConfigByRepoPath,
  type LoadedGlobalConfig,
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

export type { WorkspaceSettingsService } from "./workspace-settings-model";

export const createWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
): WorkspaceSettingsService => ({
  async listWorkspaces() {
    const config = await loadGlobalConfig(settingsConfig);
    return workspaceRecordsInEffectiveOrder(settingsConfig, config);
  },
  async addWorkspace(input) {
    const repoConfig = await validateAndNormalizeRepoConfig(settingsConfig, {
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      repoPath: input.repoPath,
      defaultRuntimeKind: "opencode",
    });
    const config = await loadGlobalConfig(settingsConfig);

    if (config.workspaces[repoConfig.workspaceId]) {
      throw new Error(`Workspace already exists in config: ${repoConfig.workspaceId}`);
    }
    ensureRepoPathAvailable(config, repoConfig.repoPath);

    config.workspaces[repoConfig.workspaceId] = repoConfig;
    config.workspaceOrder = [...config.workspaceOrder, repoConfig.workspaceId];
    config.activeWorkspace = repoConfig.workspaceId;
    touchRecentWorkspace(config, repoConfig.workspaceId);

    return saveAndReturnWorkspaceRecord(settingsConfig, config, repoConfig.workspaceId);
  },
  async selectWorkspace(workspaceId) {
    const config = await loadGlobalConfig(settingsConfig);
    if (!config.workspaces[workspaceId]) {
      throw new Error(`Workspace not found in config: ${workspaceId}`);
    }

    config.activeWorkspace = workspaceId;
    touchRecentWorkspace(config, workspaceId);
    return saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
  },
  async reorderWorkspaces(workspaceOrder) {
    const config = await loadGlobalConfig(settingsConfig);
    if (workspaceOrder.length !== Object.keys(config.workspaces).length) {
      throw new Error(
        `Workspace reorder must include exactly ${Object.keys(config.workspaces).length} configured workspaces.`,
      );
    }

    const seenWorkspaceIds = new Set<string>();
    for (const workspaceId of workspaceOrder) {
      if (!config.workspaces[workspaceId]) {
        throw new Error(`Workspace reorder included unknown workspace id: ${workspaceId}`);
      }
      if (seenWorkspaceIds.has(workspaceId)) {
        throw new Error(`Workspace reorder included duplicate workspace id: ${workspaceId}`);
      }
      seenWorkspaceIds.add(workspaceId);
    }

    config.workspaceOrder = workspaceOrder;
    await settingsConfig.writeConfig(globalConfigSchema.parse(config) as LoadedGlobalConfig);
    return workspaceRecordsInEffectiveOrder(settingsConfig, config);
  },
  async getRepoConfig(workspaceId) {
    const config = await loadGlobalConfig(settingsConfig);
    const repoConfig = config.workspaces[workspaceId];
    if (!repoConfig) {
      throw new Error(`Workspace is not configured: ${workspaceId}`);
    }

    return repoConfigSchema.parse(repoConfig);
  },
  async getRepoConfigByRepoPath(rawRepoPath) {
    const config = await loadGlobalConfig(settingsConfig);
    return findRepoConfigByRepoPath(settingsConfig, config, rawRepoPath);
  },
  async updateRepoConfig(workspaceId, update) {
    const config = await loadGlobalConfig(settingsConfig);
    const existing = requireConfiguredWorkspace(config, workspaceId);
    const nextRepoConfig = await validateAndNormalizeRepoConfig(
      settingsConfig,
      buildMergedRepoConfig(workspaceId, existing, update, false),
    );
    ensureRepoPathAvailable(config, nextRepoConfig.repoPath, workspaceId);

    config.workspaces[workspaceId] = nextRepoConfig;
    if (config.activeWorkspace === undefined) {
      config.activeWorkspace = workspaceId;
    }
    touchRecentWorkspace(config, workspaceId);
    return saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
  },
  async saveRepoSettings(workspaceId, settings) {
    const config = await loadGlobalConfig(settingsConfig);
    const existing = requireConfiguredWorkspace(config, workspaceId);
    const nextRepoConfig = await validateAndNormalizeRepoConfig(
      settingsConfig,
      buildMergedRepoConfig(workspaceId, existing, settings, true),
    );
    ensureRepoPathAvailable(config, nextRepoConfig.repoPath, workspaceId);

    config.workspaces[workspaceId] = nextRepoConfig;
    touchRecentWorkspace(config, workspaceId);
    return saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
  },
  async updateRepoHooks(workspaceId, hooks) {
    const config = await loadGlobalConfig(settingsConfig);
    const existing = requireConfiguredWorkspace(config, workspaceId);

    config.workspaces[workspaceId] = repoConfigSchema.parse({
      ...existing,
      hooks,
    });
    touchRecentWorkspace(config, workspaceId);
    return saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
  },
  async getSettingsSnapshot() {
    const config = await loadGlobalConfig(settingsConfig);
    return toSettingsSnapshot(config);
  },
  async saveSettingsSnapshot(rawSnapshot) {
    const config = await loadGlobalConfig(settingsConfig);
    const snapshot = settingsSnapshotSchema.parse(rawSnapshot);
    const workspaces = await normalizeSnapshotWorkspaces(
      settingsConfig,
      config,
      snapshot.workspaces,
    );
    const nextConfig = globalConfigSchema.parse({
      ...config,
      theme: snapshot.theme,
      git: snapshot.git,
      general: snapshot.general,
      chat: snapshot.chat,
      reusablePrompts: snapshot.reusablePrompts,
      kanban: snapshot.kanban,
      autopilot: snapshot.autopilot,
      agentRuntimes: snapshot.agentRuntimes,
      workspaces,
      globalPromptOverrides: snapshot.globalPromptOverrides,
    }) as LoadedGlobalConfig;

    await settingsConfig.writeConfig(nextConfig);
    return workspaceRecordsInEffectiveOrder(settingsConfig, nextConfig);
  },
  async setTheme(theme) {
    const config = await loadGlobalConfig(settingsConfig);
    const nextConfig = globalConfigSchema.parse({
      ...config,
      theme: themeSchema.parse(theme),
    }) as LoadedGlobalConfig;
    await settingsConfig.writeConfig(nextConfig);
  },
  async updateGlobalGitConfig(git) {
    const config = await loadGlobalConfig(settingsConfig);
    const nextConfig = globalConfigSchema.parse({
      ...config,
      git: globalGitConfigSchema.parse(git),
    }) as LoadedGlobalConfig;
    await settingsConfig.writeConfig(nextConfig);
  },
});
