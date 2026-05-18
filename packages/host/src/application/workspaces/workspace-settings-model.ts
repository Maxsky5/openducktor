import {
  DEFAULT_BRANCH_PREFIX,
  type GlobalGitConfig,
  globalConfigSchema,
  type RepoConfig,
  type RepoDevServerScript,
  type RepoHooks,
  repoConfigSchema,
  repoHooksSchema,
  type SettingsSnapshot,
  settingsSnapshotSchema,
  type Theme,
  type WorkspaceRecord,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig, type LoadedGlobalConfig } from "../../config/global-config";
import { HostInvariantError, HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";

export type WorkspaceSettingsError = HostInvariantError | HostValidationError | SettingsConfigError;

export type WorkspaceSettingsService = {
  listWorkspaces(): Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>;
  addWorkspace(input: WorkspaceAddInput): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  selectWorkspace(workspaceId: string): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  reorderWorkspaces(
    workspaceOrder: string[],
  ): Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>;
  getRepoConfig(workspaceId: string): Effect.Effect<RepoConfig, WorkspaceSettingsError>;
  getRepoConfigByRepoPath(repoPath: string): Effect.Effect<RepoConfig, WorkspaceSettingsError>;
  updateRepoConfig(
    workspaceId: string,
    update: Record<string, unknown>,
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  saveRepoSettings(
    workspaceId: string,
    settings: Record<string, unknown>,
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  updateRepoHooks(
    workspaceId: string,
    hooks: RepoHooks,
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  getSettingsSnapshot(): Effect.Effect<SettingsSnapshot, WorkspaceSettingsError>;
  saveSettingsSnapshot(
    snapshot: SettingsSnapshot,
  ): Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>;
  setTheme(theme: Theme): Effect.Effect<void, WorkspaceSettingsError>;
  updateGlobalGitConfig(git: GlobalGitConfig): Effect.Effect<void, WorkspaceSettingsError>;
};
export type WorkspaceAddInput = {
  repoPath: string;
  workspaceId: string;
  workspaceName: string;
};
export const loadGlobalConfig = (settingsConfig: SettingsConfigPort) =>
  Effect.gen(function* () {
    return (yield* settingsConfig.readConfig()) ?? createDefaultGlobalConfig();
  });
export const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HostValidationError({ message: `${label} must be an object.` });
  }
  return value as Record<string, unknown>;
};
export const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string") {
    throw new HostValidationError({ message: `${label} must be a string.` });
  }
  return value;
};
export const requireStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new HostValidationError({ message: `${label} must be an array of strings.` });
  }
  return value;
};
export const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(record, key);
export const optionalUpdateValue = <T>(
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
export const normalizeOptionalNonEmptyString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = requireString(value, "Optional string value").trim();
  return text.length > 0 ? text : undefined;
};
export const normalizeHooks = (value: unknown): RepoHooks => {
  const hooks = repoHooksSchema.parse(value);
  return {
    preStart: hooks.preStart.map((command) => command.trim()).filter(Boolean),
    postComplete: hooks.postComplete.map((command) => command.trim()).filter(Boolean),
  };
};
export const normalizeDevServers = (value: unknown): RepoDevServerScript[] => {
  if (!Array.isArray(value)) {
    throw new HostValidationError({ message: "devServers must be an array." });
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
export const normalizeWorktreeCopyPaths = (value: unknown): string[] =>
  requireStringArray(value, "worktreeCopyPaths")
    .map((entry) => entry.trim())
    .filter(Boolean);
export const normalizeRepoConfigInput = (input: Record<string, unknown>): RepoConfig => {
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
export const touchRecentWorkspace = (config: LoadedGlobalConfig, workspaceId: string): void => {
  config.recentWorkspaces = [
    workspaceId,
    ...config.recentWorkspaces.filter((entry) => entry !== workspaceId),
  ].slice(0, 20);
};
export const sortedWorkspaceIds = (config: LoadedGlobalConfig): string[] => {
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
export const workspaceRecordFromRepo = (
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
export const workspaceRecordsInEffectiveOrder = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
): WorkspaceRecord[] =>
  sortedWorkspaceIds(config).map((workspaceId) => {
    const repo = config.workspaces[workspaceId];
    if (!repo) {
      throw new HostInvariantError({
        invariant: "workspace_order_matches_config",
        message: "Workspace disappeared from config.",
      });
    }
    return workspaceRecordFromRepo(settingsConfig, config, workspaceId, repo);
  });
export const toSettingsSnapshot = (config: LoadedGlobalConfig): SettingsSnapshot =>
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
export const validateGitRepoPath = (settingsConfig: SettingsConfigPort, repoPath: string) =>
  Effect.gen(function* () {
    if (!(yield* settingsConfig.pathExists(repoPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Workspace path does not exist: ${repoPath}`,
          field: "repoPath",
        }),
      );
    }
    if (!(yield* settingsConfig.pathExists(settingsConfig.join(repoPath, ".git")))) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Workspace is not a git repository: ${repoPath}`,
          field: "repoPath",
        }),
      );
    }
    return yield* settingsConfig.canonicalizePath(repoPath).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            message: `Failed canonicalizing workspace path ${repoPath}: ${String(error)}`,
            field: "repoPath",
            cause: error,
          }),
      ),
    );
  });
export const validateAndNormalizeRepoConfig = (
  settingsConfig: SettingsConfigPort,
  rawRepoConfig: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => normalizeRepoConfigInput(rawRepoConfig),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const canonicalRepoPath = yield* validateGitRepoPath(settingsConfig, parsed.repoPath);
    return yield* Effect.try({
      try: () =>
        normalizeRepoConfigInput({
          ...parsed,
          repoPath: canonicalRepoPath,
        }),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });
export const ensureRepoPathAvailable = (
  config: LoadedGlobalConfig,
  repoPath: string,
  currentWorkspaceId?: string,
): void => {
  const conflict = Object.entries(config.workspaces).find(
    ([workspaceId, workspace]) =>
      workspace.repoPath === repoPath && workspaceId !== currentWorkspaceId,
  );
  if (conflict) {
    throw new HostValidationError({
      field: "repoPath",
      message: `Repository path is already registered to workspace ${conflict[0]}: ${repoPath}`,
    });
  }
};
export const workspaceRecord = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
): WorkspaceRecord => {
  const repo = config.workspaces[workspaceId];
  if (!repo) {
    throw new HostInvariantError({
      invariant: "workspace_record_exists",
      message: "Workspace disappeared from config.",
    });
  }
  return workspaceRecordFromRepo(settingsConfig, config, workspaceId, repo);
};
export const saveAndReturnWorkspaceRecord = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  workspaceId: string,
) =>
  Effect.gen(function* () {
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
      try: () => workspaceRecord(settingsConfig, config, workspaceId),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
  });
export const requireConfiguredWorkspace = (
  config: LoadedGlobalConfig,
  workspaceId: string,
): RepoConfig => {
  const existing = config.workspaces[workspaceId];
  if (!existing) {
    throw new HostValidationError({
      field: "workspaceId",
      message: `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
    });
  }
  return existing;
};
export const findRepoConfigByRepoPath = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  rawRepoPath: unknown,
) =>
  Effect.gen(function* () {
    const repoPath = yield* Effect.try({
      try: () => requireString(rawRepoPath, "repoPath"),
      catch: (cause) =>
        new HostValidationError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    const canonicalRepoPath = yield* settingsConfig.canonicalizePath(repoPath);
    const repoConfig = Object.values(config.workspaces).find(
      (workspace) => workspace.repoPath === canonicalRepoPath,
    );
    if (!repoConfig) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Workspace is not configured for repository: ${canonicalRepoPath}`,
          field: "repoPath",
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
export const buildMergedRepoConfig = (
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
export const normalizeSnapshotWorkspaces = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  snapshotWorkspaces: Record<string, RepoConfig>,
) =>
  Effect.gen(function* () {
    const nextWorkspaces: Record<string, RepoConfig> = { ...config.workspaces };
    for (const workspaceId of Object.keys(snapshotWorkspaces)) {
      if (!config.workspaces[workspaceId]) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
            field: "workspaceId",
          }),
        );
      }
      delete nextWorkspaces[workspaceId];
    }
    for (const [workspaceId, repoConfig] of Object.entries(snapshotWorkspaces)) {
      const normalizedRepoConfig = yield* validateAndNormalizeRepoConfig(settingsConfig, {
        ...repoConfig,
        workspaceId,
      });
      const conflictingWorkspaceId = Object.entries(nextWorkspaces).find(
        ([, workspace]) => workspace.repoPath === normalizedRepoConfig.repoPath,
      )?.[0];
      if (conflictingWorkspaceId) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Repository path is already registered to workspace ${conflictingWorkspaceId}: ${normalizedRepoConfig.repoPath}`,
            field: "repoPath",
          }),
        );
      }
      nextWorkspaces[workspaceId] = normalizedRepoConfig;
    }
    return nextWorkspaces;
  });
