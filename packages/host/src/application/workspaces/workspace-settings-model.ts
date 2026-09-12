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
  type WorkspaceCatalog,
  type WorkspacePathResolution,
  type WorkspaceRecord,
  type WorkspaceRemovalPhase,
  type WorkspaceRemovalRecord,
  type WorkspaceRepoConfigInput,
  type WorkspaceRepoHooksInput,
  type WorkspaceRepoSettingsInput,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createDefaultGlobalConfig,
  type LoadedGlobalConfig,
  withInferredOnboardingCompletion,
} from "../../config/global-config";
import { workspaceRecordForId } from "./workspace-catalog-model";
import {
  type HostInvariantErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { SettingsConfigError, SettingsConfigPort } from "../../ports/settings-config-port";

type RepoConfigDraft = Pick<
  RepoConfig,
  "defaultRuntimeKind" | "repoPath" | "workspaceId" | "workspaceName"
> &
  Partial<Omit<RepoConfig, "defaultRuntimeKind" | "repoPath" | "workspaceId" | "workspaceName">>;

export type WorkspaceSettingsError =
  | HostInvariantErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError;

export type WorkspaceSettingsService = {
  listWorkspaces(): Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>;
  getWorkspaceCatalog(): Effect.Effect<WorkspaceCatalog, WorkspaceSettingsError>;
  addWorkspace(input: WorkspaceAddInput): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  selectWorkspace(workspaceId: string): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  closeWorkspace(
    workspaceId: string,
    expectedRepoPath: string,
  ): Effect.Effect<WorkspaceCatalog, WorkspaceSettingsError>;
  reopenWorkspace(
    workspaceId: string,
    expectedRepoPath: string,
  ): Effect.Effect<WorkspaceCatalog, WorkspaceSettingsError>;
  resolveWorkspacePath(
    repoPath: string,
  ): Effect.Effect<WorkspacePathResolution, WorkspaceSettingsError>;
  removeWorkspaceRegistration(
    workspaceId: string,
    expectedRepoPath: string,
  ): Effect.Effect<WorkspaceCatalog, WorkspaceSettingsError>;
  beginWorkspaceRemoval(input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }): Effect.Effect<
    { record: WorkspaceRemovalRecord; repoConfig: RepoConfig },
    WorkspaceSettingsError
  >;
  recordWorkspaceRemovalProgress(input: {
    workspaceId: string;
    phase: WorkspaceRemovalPhase;
    removedWorktrees: string[];
    lastFailure: string | null;
    pendingWorktreePath: string | null | undefined;
  }): Effect.Effect<void, WorkspaceSettingsError>;
  reorderWorkspaces(
    workspaceOrder: string[],
  ): Effect.Effect<WorkspaceRecord[], WorkspaceSettingsError>;
  getRepoConfig(workspaceId: string): Effect.Effect<RepoConfig, WorkspaceSettingsError>;
  getRepoConfigByRepoPath(repoPath: string): Effect.Effect<RepoConfig, WorkspaceSettingsError>;
  replaceAgentStudioState(
    workspaceId: string,
    state: RepoConfig["agentStudioState"],
  ): Effect.Effect<RepoConfig, WorkspaceSettingsError>;
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
    const config = (yield* settingsConfig.readConfig()) ?? createDefaultGlobalConfig();
    return withInferredOnboardingCompletion(config);
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
export const toSettingsSnapshot = (config: LoadedGlobalConfig): SettingsSnapshot =>
  settingsSnapshotSchema.parse({
    theme: config.theme,
    system: config.system,
    git: config.git,
    general: config.general,
    appearance: config.appearance,
    chat: config.chat,
    reusablePrompts: config.reusablePrompts,
    kanban: config.kanban,
    autopilot: config.autopilot,
    notifications: config.notifications,
    agentRuntimes: config.agentRuntimes,
    agentModelFavorites: config.agentModelFavorites,
    workspaces: Object.fromEntries(
      Object.entries(config.workspaces).filter(
        ([, repoConfig]) => !repoConfig.closed && repoConfig.removal === undefined,
      ),
    ),
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
      try: () => workspaceRecordForId(settingsConfig, config, workspaceId),
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
  snapshotWorkspaces: SettingsSnapshotSaveInput["workspaces"],
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
      const existingRepoConfig = config.workspaces[workspaceId];
      if (!existingRepoConfig) {
        return yield* Effect.fail(
          new HostValidationError({
            message: `Workspace not found in config: ${workspaceId}. Add/select the workspace before updating configuration.`,
            field: "workspaceId",
          }),
        );
      }
      const normalizedRepoConfig = yield* validateAndNormalizeRepoConfig(settingsConfig, {
        ...repoConfig,
        workspaceId,
        agentStudioState: existingRepoConfig.agentStudioState,
        closed: existingRepoConfig.closed,
        removal: existingRepoConfig.removal,
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
