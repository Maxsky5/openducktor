import {
  type AgentModelFavorite,
  type CustomAgentRole,
  type CustomAgentRoleInput,
  DEFAULT_BRANCH_PREFIX,
  type GlobalConfig,
  type KanbanTaskCardView,
  globalConfigSchema,
  type RepoConfig,
  type RemoteAccessSettings,
  type RepoHooks,
  repoConfigSchema,
  repoHooksSchema,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  type SidebarSessionGrouping,
  settingsSnapshotSchema,
  type ThemePreference,
  type WorkspaceCatalog,
  type WorkspacePathResolution,
  type WorkspaceRecord,
  type WorkspaceAgentStudioStateAction,
  type WorkspaceRemovalPhase,
  type WorkspaceRemovalRecord,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { LoadedGlobalConfig } from "../../config/global-config";
import { workspaceRecordForId } from "./workspace-catalog-model";
import {
  type HostInvariantErrorAggregate,
  HostValidationError,
  type HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type {
  SettingsConfigError,
  SettingsConfigPort,
  SettingsConfigChange,
  SettingsConfigPersistence,
} from "../../ports/settings-config-port";

export type RepoConfigDraft = Pick<
  RepoConfig,
  "defaultModel" | "repoPath" | "workspaceId" | "workspaceName"
> &
  Partial<Omit<RepoConfig, "defaultModel" | "repoPath" | "workspaceId" | "workspaceName">>;

export type WorkspaceSettingsError =
  | HostInvariantErrorAggregate
  | HostValidationErrorAggregate
  | SettingsConfigError;

export type WorkspaceSettingsService = {
  readRemoteAccessSettings(): Effect.Effect<RemoteAccessSettings, WorkspaceSettingsError>;
  saveRemoteAccessSettings(
    settings: RemoteAccessSettings,
  ): Effect.Effect<void, WorkspaceSettingsError>;
  listCustomAgentRoles(): Effect.Effect<CustomAgentRole[], WorkspaceSettingsError>;
  createCustomAgentRole(
    input: CustomAgentRoleInput,
  ): Effect.Effect<CustomAgentRole, WorkspaceSettingsError>;
  updateCustomAgentRole(
    id: string,
    input: CustomAgentRoleInput,
  ): Effect.Effect<CustomAgentRole, WorkspaceSettingsError>;
  deleteCustomAgentRole(id: string): Effect.Effect<void, WorkspaceSettingsError>;
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
  }): Effect.Effect<WorkspaceRemovalRecord, WorkspaceSettingsError>;
  recordWorkspaceRemovalProgress(input: {
    workspaceId: string;
    phase: WorkspaceRemovalPhase;
    pendingWorktreePath: string | null;
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
  applyAgentStudioStateAction(
    workspaceId: string,
    action: WorkspaceAgentStudioStateAction,
  ): Effect.Effect<RepoConfig, WorkspaceSettingsError>;
  /** Replaces the git provider settings of a workspace, for workspace provider setup. */
  updateRepoGitConfig(
    workspaceId: string,
    git: RepoConfig["git"],
  ): Effect.Effect<WorkspaceRecord, WorkspaceSettingsError>;
  getSettingsSnapshot(): Effect.Effect<SettingsSnapshot, WorkspaceSettingsError>;
  /** Validates a settings save without writing it. */
  prepareSettingsSnapshot(
    snapshot: SettingsSnapshotSaveInput,
  ): Effect.Effect<PreparedSettingsSnapshot, WorkspaceSettingsError>;
  /**
   * Lets `commit` decide whether to run `write` for a prepared save. `write` applies the
   * prepared edits to the current settings in the write transaction. The whole call holds the
   * config write lock.
   */
  saveSettingsSnapshotWith<A, E>(
    prepared: PreparedSettingsSnapshot,
    commit: (
      write: Effect.Effect<SettingsWriteResult, WorkspaceSettingsError>,
    ) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | WorkspaceSettingsError>;
  updateAgentModelFavorites(
    favorites: AgentModelFavorite[],
  ): Effect.Effect<AgentModelFavorite[], WorkspaceSettingsError>;
  updateKanbanTaskCardView(
    taskCardView: KanbanTaskCardView,
  ): Effect.Effect<KanbanTaskCardView, WorkspaceSettingsError>;
  updateSidebarSessionGrouping(
    grouping: SidebarSessionGrouping,
  ): Effect.Effect<SidebarSessionGrouping, WorkspaceSettingsError>;
  setTheme(theme: ThemePreference): Effect.Effect<void, WorkspaceSettingsError>;
};
export type SettingsWriteResult = SettingsConfigPersistence & { workspaces: WorkspaceRecord[] };
export type PreparedSettingsSnapshot = {
  readonly edits: SettingsSnapshotSaveInput;
  readonly current: GlobalConfig;
  readonly next: GlobalConfig;
};
export type WorkspaceAddInput = {
  repoPath: string;
  workspaceId: string;
  workspaceName: string;
  abbreviation?: string | undefined;
  tileColor?: string | undefined;
  git?: RepoConfig["git"];
  defaultModel?: RepoConfig["defaultModel"];
  agentDefaults?: RepoConfig["agentDefaults"];
  onRegistered?: (workspace: WorkspaceRecord) => void;
};
const normalizeOptionalNonEmptyString = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim();
  return text.length > 0 ? text : undefined;
};
const normalizeHooks = (value: RepoHooks): RepoHooks => {
  const hooks = repoHooksSchema.parse(value);
  return {
    postComplete: hooks.postComplete.map((command) => command.trim()).filter(Boolean),
  };
};
const normalizeWorktreeCopyPaths = (value: string[]): string[] =>
  value.map((entry) => entry.trim()).filter(Boolean);
const normalizeRepoConfigInput = (input: RepoConfigDraft): RepoConfig => {
  const rawWorktreeBasePath = normalizeOptionalNonEmptyString(input.worktreeBasePath);
  const rawBranchPrefix = input.branchPrefix?.trim() || DEFAULT_BRANCH_PREFIX;
  return repoConfigSchema.parse({
    ...input,
    worktreeBasePath: rawWorktreeBasePath,
    branchPrefix: rawBranchPrefix,
    hooks: input.hooks === undefined ? undefined : normalizeHooks(input.hooks),
    worktreeCopyPaths:
      input.worktreeCopyPaths === undefined
        ? undefined
        : normalizeWorktreeCopyPaths(input.worktreeCopyPaths),
  });
};
export const touchRecentWorkspace = (
  config: Pick<LoadedGlobalConfig, "recentWorkspaces">,
  workspaceId: string,
): void => {
  config.recentWorkspaces = [
    workspaceId,
    ...config.recentWorkspaces.filter((entry) => entry !== workspaceId),
  ].slice(0, 20);
};
export const toSettingsSnapshot = (config: LoadedGlobalConfig): SettingsSnapshot =>
  settingsSnapshotSchema.parse({
    customAgentRoles: config.customAgentRoles,
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
  config: { workspaces: Record<string, { repoPath: string }> },
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
  change: SettingsConfigChange,
  workspaceId: string,
  onRegistered?: (workspace: WorkspaceRecord) => void,
) =>
  Effect.gen(function* () {
    const config = yield* settingsConfig.updateConfig(
      (current, catalog) => globalConfigSchema.parse(change(current, catalog)),
      [workspaceId],
    );
    const record = workspaceRecordForId(settingsConfig, config, workspaceId);
    onRegistered?.(record);
    return record;
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
