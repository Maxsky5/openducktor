import {
  type AgentModelFavorite,
  DEFAULT_BRANCH_PREFIX,
  type GlobalGitConfig,
  globalConfigSchema,
  type RepoConfig,
  type RepoDevServerScript,
  type RepoHooks,
  type RuntimeKind,
  repoConfigSchema,
  repoHooksSchema,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  settingsSnapshotSchema,
  type Theme,
  type WorkspaceRecord,
  type WorkspaceRepoConfigInput,
  type WorkspaceRepoHooksInput,
  type WorkspaceRepoSettingsInput,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createDefaultGlobalConfig, type LoadedGlobalConfig } from "../../config/global-config";
import { HostInvariantError, HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";

type RepoConfigDraft = Pick<
  RepoConfig,
  "defaultRuntimeKind" | "repoPath" | "workspaceId" | "workspaceName"
> &
  Partial<Omit<RepoConfig, "defaultRuntimeKind" | "repoPath" | "workspaceId" | "workspaceName">>;

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
    update: WorkspaceRepoConfigInput,
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  saveRepoSettings(
    workspaceId: string,
    settings: WorkspaceRepoSettingsInput,
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  updateRepoHooks(
    workspaceId: string,
    hooks: RepoHooks,
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  getSettingsSnapshot(): Effect.Effect<SettingsSnapshot, WorkspaceSettingsError>;
  saveSettingsSnapshot(
    snapshot: SettingsSnapshotSaveInput,
  ): Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>;
  updateAgentModelFavorites(
    favorites: AgentModelFavorite[],
  ): Effect.Effect<SettingsSnapshot, WorkspaceSettingsError>;
  setTheme(theme: Theme): Effect.Effect<void, WorkspaceSettingsError>;
  updateGlobalGitConfig(git: GlobalGitConfig): Effect.Effect<void, WorkspaceSettingsError>;
};
export type WorkspaceAddInput = {
  repoPath: string;
  workspaceId: string;
  workspaceName: string;
  defaultRuntimeKind?: RuntimeKind;
};
export const loadGlobalConfig = (settingsConfig: SettingsConfigPort) =>
  Effect.gen(function* () {
    return (yield* settingsConfig.readConfig()) ?? createDefaultGlobalConfig();
  });
const normalizeOptionalNonEmptyString = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
};
const normalizeHooks = (value: WorkspaceRepoHooksInput | RepoHooks): RepoHooks => {
  const hooks = repoHooksSchema.parse(value);
  return {
    preStart: hooks.preStart.map((command) => command.trim()).filter(Boolean),
    postComplete: hooks.postComplete.map((command) => command.trim()).filter(Boolean),
  };
};
const normalizeDevServers = (value: RepoDevServerScript[]): RepoDevServerScript[] => {
  return value
    .map((entry) => ({
      id: entry.id.trim(),
      name: entry.name.trim(),
      command: entry.command.trim(),
    }))
    .filter((entry) => entry.command.length > 0);
};
const normalizeWorktreeCopyPaths = (value: string[]): string[] =>
  value.map((entry) => entry.trim()).filter(Boolean);
const normalizeRepoConfigInput = (input: RepoConfigDraft): RepoConfig => {
  const rawWorktreeBasePath = normalizeOptionalNonEmptyString(input.worktreeBasePath);
  const rawBranchPrefix = input.branchPrefix?.trim() || DEFAULT_BRANCH_PREFIX;
  return repoConfigSchema.parse({
    ...input,
    defaultRuntimeKind: input.defaultRuntimeKind.trim(),
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
    appearance: config.appearance,
    chat: config.chat,
    reusablePrompts: config.reusablePrompts,
    kanban: config.kanban,
    autopilot: config.autopilot,
    agentRuntimes: config.agentRuntimes,
    agentModelFavorites: config.agentModelFavorites,
    workspaces: config.workspaces,
    globalPromptOverrides: config.globalPromptOverrides,
  });
const validateGitRepoPath = (settingsConfig: SettingsConfigPort, repoPath: string) =>
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
  rawRepoConfig: RepoConfigDraft,
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
const workspaceRecord = (
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
      try: () => globalConfigSchema.parse(config),
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
  repoPath: string,
) =>
  Effect.gen(function* () {
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
  update: WorkspaceRepoSettingsInput,
  includeHooks: boolean,
): RepoConfigDraft => ({
  ...existing,
  workspaceId,
  defaultRuntimeKind: update.defaultRuntimeKind ?? existing.defaultRuntimeKind,
  worktreeBasePath: update.worktreeBasePath ?? existing.worktreeBasePath,
  branchPrefix: update.branchPrefix ?? existing.branchPrefix,
  defaultTargetBranch: update.defaultTargetBranch ?? existing.defaultTargetBranch,
  git: update.git ?? existing.git,
  hooks: includeHooks && update.hooks ? normalizeHooks(update.hooks) : existing.hooks,
  devServers: update.devServers ?? existing.devServers,
  worktreeCopyPaths: update.worktreeCopyPaths ?? existing.worktreeCopyPaths,
  promptOverrides: update.promptOverrides ?? existing.promptOverrides,
  agentDefaults: update.agentDefaults ?? existing.agentDefaults,
});
export const normalizeSnapshotWorkspaces = (
  settingsConfig: SettingsConfigPort,
  config: LoadedGlobalConfig,
  snapshotWorkspaces: Record<string, RepoConfig>,
) =>
  Effect.gen(function* () {
    const nextWorkspaces = { ...config.workspaces } satisfies Record<string, RepoConfig>;
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
