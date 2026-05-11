import {
  type AgentRuntimes,
  DEFAULT_BRANCH_PREFIX,
  type GlobalConfig,
  globalConfigSchema,
  globalGitConfigSchema,
  type RepoConfig,
  type RepoDevServerScript,
  type RepoHooks,
  repoConfigSchema,
  repoHooksSchema,
  type SettingsSnapshot,
  settingsSnapshotSchema,
  themeSchema,
  type WorkspaceRecord,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import type { SettingsConfigPort } from "../ports/settings-config-port";

type LoadedGlobalConfig = GlobalConfig & {
  agentRuntimes: AgentRuntimes;
};

export type WorkspaceSettingsService = {
  listWorkspaces(): Promise<WorkspaceRecord[]>;
  addWorkspace(input: unknown): Promise<WorkspaceRecord>;
  selectWorkspace(workspaceId: unknown): Promise<WorkspaceRecord>;
  reorderWorkspaces(workspaceOrder: unknown): Promise<WorkspaceRecord[]>;
  getRepoConfig(workspaceId: unknown): Promise<RepoConfig>;
  getRepoConfigByRepoPath(repoPath: unknown): Promise<RepoConfig>;
  updateRepoConfig(workspaceId: unknown, update: unknown): Promise<WorkspaceRecord>;
  saveRepoSettings(workspaceId: unknown, settings: unknown): Promise<WorkspaceRecord>;
  updateRepoHooks(workspaceId: unknown, hooks: unknown): Promise<WorkspaceRecord>;
  getSettingsSnapshot(): Promise<SettingsSnapshot>;
  saveSettingsSnapshot(snapshot: unknown): Promise<WorkspaceRecord[]>;
  setTheme(theme: unknown): Promise<void>;
  updateGlobalGitConfig(git: unknown): Promise<void>;
};

const createDefaultGlobalConfig = (): LoadedGlobalConfig =>
  globalConfigSchema.parse({ version: 2 }) as LoadedGlobalConfig;

const migratePersistedConfigShape = (payload: unknown): unknown => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const candidate = payload as Record<string, unknown>;
  const chat = candidate.chat;
  if (
    candidate.reusablePrompts !== undefined ||
    !chat ||
    typeof chat !== "object" ||
    Array.isArray(chat) ||
    !Array.isArray((chat as Record<string, unknown>).customPrompts)
  ) {
    return payload;
  }

  return {
    ...candidate,
    reusablePrompts: (chat as Record<string, unknown>).customPrompts,
  };
};

const assertSupportedConfigVersion = (payload: unknown): void => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Config file must contain a JSON object.");
  }

  const version = (payload as Record<string, unknown>).version;
  if (version !== 2) {
    throw new Error(`Unsupported config version ${String(version)}. Expected 2.`);
  }
};

const parseGlobalConfig = (payload: unknown): LoadedGlobalConfig => {
  assertSupportedConfigVersion(payload);
  return globalConfigSchema.parse(migratePersistedConfigShape(payload)) as LoadedGlobalConfig;
};

const loadGlobalConfig = async (
  settingsConfig: SettingsConfigPort,
): Promise<LoadedGlobalConfig> => {
  const payload = await settingsConfig.readConfig();
  if (payload === null) {
    return createDefaultGlobalConfig();
  }

  return parseGlobalConfig(payload);
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
};

const requireStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value;
};

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(record, key);

const optionalUpdateValue = <T>(
  record: Record<string, unknown>,
  key: string,
  current: T,
): unknown => {
  if (!hasOwn(record, key)) {
    return current;
  }

  const value = record[key];
  return value === null || value === undefined ? current : value;
};

const normalizeOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = requireString(value, "Optional string value").trim();
  return text.length > 0 ? text : undefined;
};

const normalizeHooks = (value: unknown): RepoHooks => {
  const hooks = repoHooksSchema.parse(value);
  return {
    preStart: hooks.preStart.map((command) => command.trim()).filter(Boolean),
    postComplete: hooks.postComplete.map((command) => command.trim()).filter(Boolean),
  };
};

const normalizeDevServers = (value: unknown): RepoDevServerScript[] => {
  if (!Array.isArray(value)) {
    throw new Error("devServers must be an array.");
  }

  return value
    .map((entry) => requireRecord(entry, "Dev server"))
    .map((entry) => ({
      id: requireString(entry.id, "Dev server id").trim(),
      name: requireString(entry.name, "Dev server name").trim(),
      command: requireString(entry.command, "Dev server command").trim(),
    }))
    .filter((entry) => entry.command.length > 0);
};

const normalizeWorktreeCopyPaths = (value: unknown): string[] =>
  requireStringArray(value, "worktreeCopyPaths")
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeRepoConfigInput = (input: Record<string, unknown>): RepoConfig => {
  const rawWorktreeBasePath = normalizeOptionalNonEmptyString(input.worktreeBasePath);
  const rawBranchPrefix =
    typeof input.branchPrefix === "string"
      ? input.branchPrefix.trim() || DEFAULT_BRANCH_PREFIX
      : input.branchPrefix;
  const rawDefaultRuntimeKind =
    typeof input.defaultRuntimeKind === "string"
      ? input.defaultRuntimeKind.trim()
      : input.defaultRuntimeKind;

  return repoConfigSchema.parse({
    ...input,
    defaultRuntimeKind: rawDefaultRuntimeKind,
    worktreeBasePath: rawWorktreeBasePath,
    branchPrefix: rawBranchPrefix,
    hooks: input.hooks === undefined ? undefined : normalizeHooks(input.hooks),
    devServers: input.devServers === undefined ? undefined : normalizeDevServers(input.devServers),
    worktreeCopyPaths:
      input.worktreeCopyPaths === undefined
        ? undefined
        : normalizeWorktreeCopyPaths(input.worktreeCopyPaths),
  });
};

const touchRecentWorkspace = (config: LoadedGlobalConfig, workspaceId: string): void => {
  config.recentWorkspaces = [
    workspaceId,
    ...config.recentWorkspaces.filter((entry) => entry !== workspaceId),
  ].slice(0, 20);
};

const sortedWorkspaceIds = (config: LoadedGlobalConfig): string[] => {
  const orderedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const workspaceId of config.workspaceOrder) {
    if (config.workspaces[workspaceId] && !seenIds.has(workspaceId)) {
      seenIds.add(workspaceId);
      orderedIds.push(workspaceId);
    }
  }

  const remaining = Object.entries(config.workspaces).sort(
    ([leftId, leftRepo], [rightId, rightRepo]) => {
      const nameComparison = leftRepo.workspaceName.localeCompare(rightRepo.workspaceName);
      return nameComparison === 0 ? leftId.localeCompare(rightId) : nameComparison;
    },
  );

  for (const [workspaceId] of remaining) {
    if (!seenIds.has(workspaceId)) {
      seenIds.add(workspaceId);
      orderedIds.push(workspaceId);
    }
  }

  return orderedIds;
};

const workspaceRecordFromRepo = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
  repo: RepoConfig,
): WorkspaceRecord => {
  const defaultWorktreeBasePath = settingsConfig.defaultWorktreeBasePath(workspaceId);
  const effectiveWorktreeBasePath =
    repo.worktreeBasePath !== undefined
      ? settingsConfig.resolveConfiguredPath(repo.worktreeBasePath)
      : defaultWorktreeBasePath;

  return workspaceRecordSchema.parse({
    workspaceId: repo.workspaceId,
    workspaceName: repo.workspaceName,
    repoPath: repo.repoPath,
    iconDataUrl: null,
    isActive: config.activeWorkspace === workspaceId,
    hasConfig: true,
    configuredWorktreeBasePath: repo.worktreeBasePath ?? null,
    defaultWorktreeBasePath,
    effectiveWorktreeBasePath,
  });
};

const workspaceRecordsInEffectiveOrder = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
): WorkspaceRecord[] =>
  sortedWorkspaceIds(config).map((workspaceId) => {
    const repo = config.workspaces[workspaceId];
    if (!repo) {
      throw new Error("Workspace disappeared from config.");
    }

    return workspaceRecordFromRepo(settingsConfig, config, workspaceId, repo);
  });

const toSettingsSnapshot = (config: LoadedGlobalConfig): SettingsSnapshot =>
  settingsSnapshotSchema.parse({
    theme: config.theme,
    git: config.git,
    general: config.general,
    chat: config.chat,
    reusablePrompts: config.reusablePrompts,
    kanban: config.kanban,
    autopilot: config.autopilot,
    agentRuntimes: config.agentRuntimes,
    workspaces: config.workspaces,
    globalPromptOverrides: config.globalPromptOverrides,
  });

const validateGitRepoPath = async (
  settingsConfig: SettingsConfigPort,
  repoPath: string,
): Promise<string> => {
  if (!(await settingsConfig.pathExists(repoPath))) {
    throw new Error(`Workspace path does not exist: ${repoPath}`);
  }

  if (!(await settingsConfig.pathExists(settingsConfig.join(repoPath, ".git")))) {
    throw new Error(`Workspace is not a git repository: ${repoPath}`);
  }

  try {
    return await settingsConfig.canonicalizePath(repoPath);
  } catch (error) {
    throw new Error(`Failed canonicalizing workspace path ${repoPath}: ${String(error)}`, {
      cause: error,
    });
  }
};

const validateAndNormalizeRepoConfig = async (
  settingsConfig: SettingsConfigPort,
  rawRepoConfig: Record<string, unknown>,
): Promise<RepoConfig> => {
  const parsed = normalizeRepoConfigInput(rawRepoConfig);
  const canonicalRepoPath = await validateGitRepoPath(settingsConfig, parsed.repoPath);
  return normalizeRepoConfigInput({
    ...parsed,
    repoPath: canonicalRepoPath,
  });
};

const ensureRepoPathAvailable = (
  config: LoadedGlobalConfig,
  repoPath: string,
  currentWorkspaceId?: string,
): void => {
  const conflict = Object.entries(config.workspaces).find(
    ([workspaceId, workspace]) =>
      workspace.repoPath === repoPath && workspaceId !== currentWorkspaceId,
  );

  if (conflict) {
    throw new Error(
      `Repository path is already registered to workspace ${conflict[0]}: ${repoPath}`,
    );
  }
};

const workspaceRecord = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
): WorkspaceRecord => {
  const repo = config.workspaces[workspaceId];
  if (!repo) {
    throw new Error("Workspace disappeared from config.");
  }

  return workspaceRecordFromRepo(settingsConfig, config, workspaceId, repo);
};

const saveAndReturnWorkspaceRecord = async (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
): Promise<WorkspaceRecord> => {
  await settingsConfig.writeConfig(globalConfigSchema.parse(config) as LoadedGlobalConfig);
  return workspaceRecord(settingsConfig, config, workspaceId);
};

const requireConfiguredWorkspace = (
  config: LoadedGlobalConfig,
  workspaceId: string,
): RepoConfig => {
  const existing = config.workspaces[workspaceId];
  if (!existing) {
    throw new Error(
      `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
    );
  }

  return existing;
};

const findRepoConfigByRepoPath = async (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  rawRepoPath: unknown,
): Promise<RepoConfig> => {
  const repoPath = requireString(rawRepoPath, "repoPath");
  const canonicalRepoPath = await settingsConfig.canonicalizePath(repoPath);
  const repoConfig = Object.values(config.workspaces).find(
    (workspace) => workspace.repoPath === canonicalRepoPath,
  );

  if (!repoConfig) {
    throw new Error(`Workspace is not configured for repository: ${canonicalRepoPath}`);
  }

  return repoConfigSchema.parse(repoConfig);
};

const buildMergedRepoConfig = (
  workspaceId: string,
  existing: RepoConfig,
  update: Record<string, unknown>,
  includeHooks: boolean,
): Record<string, unknown> => ({
  ...existing,
  workspaceId,
  defaultRuntimeKind: optionalUpdateValue(
    update,
    "defaultRuntimeKind",
    existing.defaultRuntimeKind,
  ),
  worktreeBasePath: optionalUpdateValue(update, "worktreeBasePath", existing.worktreeBasePath),
  branchPrefix: optionalUpdateValue(update, "branchPrefix", existing.branchPrefix),
  defaultTargetBranch: optionalUpdateValue(
    update,
    "defaultTargetBranch",
    existing.defaultTargetBranch,
  ),
  git: optionalUpdateValue(update, "git", existing.git),
  hooks: includeHooks ? optionalUpdateValue(update, "hooks", existing.hooks) : existing.hooks,
  devServers: optionalUpdateValue(update, "devServers", existing.devServers),
  worktreeCopyPaths: optionalUpdateValue(update, "worktreeCopyPaths", existing.worktreeCopyPaths),
  promptOverrides: optionalUpdateValue(update, "promptOverrides", existing.promptOverrides),
  agentDefaults: optionalUpdateValue(update, "agentDefaults", existing.agentDefaults),
});

const normalizeSnapshotWorkspaces = async (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  snapshotWorkspaces: Record<string, RepoConfig>,
): Promise<Record<string, RepoConfig>> => {
  const nextWorkspaces: Record<string, RepoConfig> = { ...config.workspaces };

  for (const workspaceId of Object.keys(snapshotWorkspaces)) {
    if (!config.workspaces[workspaceId]) {
      throw new Error(
        `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
      );
    }
    delete nextWorkspaces[workspaceId];
  }

  for (const [workspaceId, repoConfig] of Object.entries(snapshotWorkspaces)) {
    const normalizedRepoConfig = await validateAndNormalizeRepoConfig(settingsConfig, {
      ...repoConfig,
      workspaceId,
    });

    const conflictingWorkspaceId = Object.entries(nextWorkspaces).find(
      ([, workspace]) => workspace.repoPath === normalizedRepoConfig.repoPath,
    )?.[0];

    if (conflictingWorkspaceId) {
      throw new Error(
        `Repository path is already registered to workspace ${conflictingWorkspaceId}: ${normalizedRepoConfig.repoPath}`,
      );
    }

    nextWorkspaces[workspaceId] = normalizedRepoConfig;
  }

  return nextWorkspaces;
};

export const createWorkspaceSettingsService = (
  settingsConfig: SettingsConfigPort,
): WorkspaceSettingsService => ({
  async listWorkspaces() {
    const config = await loadGlobalConfig(settingsConfig);
    return workspaceRecordsInEffectiveOrder(settingsConfig, config);
  },
  async addWorkspace(input) {
    const record = requireRecord(input, "workspace_add input");
    const workspaceId = requireString(record.workspaceId, "workspaceId");
    const repoConfig = await validateAndNormalizeRepoConfig(settingsConfig, {
      workspaceId,
      workspaceName: requireString(record.workspaceName, "workspaceName"),
      repoPath: requireString(record.repoPath, "repoPath"),
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
  async selectWorkspace(rawWorkspaceId) {
    const workspaceId = requireString(rawWorkspaceId, "workspaceId");
    const config = await loadGlobalConfig(settingsConfig);
    if (!config.workspaces[workspaceId]) {
      throw new Error(`Workspace not found in config: ${workspaceId}`);
    }

    config.activeWorkspace = workspaceId;
    touchRecentWorkspace(config, workspaceId);
    return saveAndReturnWorkspaceRecord(settingsConfig, config, workspaceId);
  },
  async reorderWorkspaces(rawWorkspaceOrder) {
    const workspaceOrder = requireStringArray(rawWorkspaceOrder, "workspaceOrder");
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
  async getRepoConfig(rawWorkspaceId) {
    const workspaceId = requireString(rawWorkspaceId, "workspaceId");
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
  async updateRepoConfig(rawWorkspaceId, rawUpdate) {
    const workspaceId = requireString(rawWorkspaceId, "workspaceId");
    const update = requireRecord(rawUpdate, "workspace_update_repo_config config");
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
  async saveRepoSettings(rawWorkspaceId, rawSettings) {
    const workspaceId = requireString(rawWorkspaceId, "workspaceId");
    const settings = requireRecord(rawSettings, "workspace_save_repo_settings settings");
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
  async updateRepoHooks(rawWorkspaceId, rawHooks) {
    const workspaceId = requireString(rawWorkspaceId, "workspaceId");
    const hooks = normalizeHooks(rawHooks);
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
