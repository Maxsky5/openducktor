import type { AutopilotSettings, GlobalConfig, RepoConfig } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostPreferences } from "../config/global-config";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostValidationErrorAggregate,
  SettingsFileError,
} from "../effect/host-errors";

export type SettingsConfigError =
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostValidationErrorAggregate
  | SettingsFileError;

/** With workspaceIds, current.workspaces contains only those records. Workspace edits also receive the full identity catalog. */
export type SettingsConfigChange = (
  current: GlobalConfig,
  catalog: readonly WorkspaceCatalogRepo[],
) => GlobalConfig;
export type SettingsConfigPersistence = {
  shared: "unchanged" | "saved";
  preferences: "unchanged" | "saved" | { message: string };
};
export type SettingsConfigCommit = SettingsConfigPersistence & { config: GlobalConfig };
export type GlobalSettings = Omit<GlobalConfig, "workspaces">;
export type SharedRepoConfig = Omit<RepoConfig, "agentStudioState">;
export type WorkspaceCatalogRepo = Pick<
  RepoConfig,
  | "workspaceId"
  | "workspaceName"
  | "abbreviation"
  | "tileColor"
  | "repoPath"
  | "worktreeBasePath"
  | "closed"
  | "removal"
>;
/** Settings observers need global values and workspace identities, not full workspace settings. */
export type SettingsConfigView = GlobalSettings & {
  workspaces: Record<string, WorkspaceCatalogRepo>;
};
export type SharedWorkspaceCatalogSnapshot = {
  catalogRevision: number;
  workspaces: WorkspaceCatalogRepo[];
};
export type WorkspaceCatalogSnapshot = SharedWorkspaceCatalogSnapshot &
  Pick<GlobalConfig, "workspaceOrder" | "activeWorkspace">;

/** Omit workspaceIds for all workspace configs; pass [] for global settings only. */
export type SharedSettingsDatabase = {
  readGlobalConfig(): Effect.Effect<GlobalSettings, SettingsConfigError>;
  readAutopilotSettings(): Effect.Effect<AutopilotSettings, SettingsConfigError>;
  readRepoConfig(workspaceId: string): Effect.Effect<SharedRepoConfig | null, SettingsConfigError>;
  readRepoConfigByRepoPath(
    canonicalRepoPath: string,
  ): Effect.Effect<SharedRepoConfig | null, SettingsConfigError>;
  readWorkspaceCatalogSnapshot(): Effect.Effect<
    SharedWorkspaceCatalogSnapshot,
    SettingsConfigError
  >;
  readConfig(workspaceIds?: readonly string[]): Effect.Effect<GlobalConfig, SettingsConfigError>;
  updateConfig(
    change: SettingsConfigChange,
    workspaceIds?: readonly string[],
  ): Effect.Effect<
    {
      current: GlobalConfig;
      next: GlobalConfig;
      changed: boolean;
    },
    SettingsConfigError
  >;
};

/** Omit workspaceIds for all workspace configs; pass [] for global settings only. */
export type SettingsConfigPort = {
  readGlobalConfig(): Effect.Effect<GlobalSettings, SettingsConfigError>;
  /** Reads only the saved Autopilot settings, with one database statement. */
  readAutopilotSettings(): Effect.Effect<AutopilotSettings, SettingsConfigError>;
  readRepoConfig(workspaceId: string): Effect.Effect<RepoConfig | null, SettingsConfigError>;
  readRepoConfigByRepoPath(
    canonicalRepoPath: string,
  ): Effect.Effect<RepoConfig | null, SettingsConfigError>;
  /** A commit can reuse its saved preferences instead of reading config.json again. */
  readWorkspaceCatalogSnapshot(
    preferences?: Pick<GlobalConfig, "workspaceOrder" | "activeWorkspace">,
  ): Effect.Effect<WorkspaceCatalogSnapshot, SettingsConfigError>;
  updateConfig(
    change: SettingsConfigChange,
    workspaceIds?: readonly string[],
  ): Effect.Effect<GlobalConfig, SettingsConfigError>;
  applyConfigChange(
    change: SettingsConfigChange,
    workspaceIds?: readonly string[],
  ): Effect.Effect<SettingsConfigCommit, SettingsConfigError>;
  updatePreferences(
    change: (current: HostPreferences) => HostPreferences,
  ): Effect.Effect<HostPreferences, SettingsConfigError>;
  updateWorkspacePreferences(
    workspaceId: string,
    change: (current: RepoConfig) => RepoConfig["agentStudioState"],
  ): Effect.Effect<RepoConfig, SettingsConfigError>;
  readConfig(workspaceIds?: readonly string[]): Effect.Effect<GlobalConfig, SettingsConfigError>;
  defaultWorktreeBasePath(workspaceId: string): string;
  defaultRepoWorktreeBasePath(repoPath: string): string;
  resolveConfiguredPath(rawPath: string): string;
  canonicalizePath(rawPath: string): Effect.Effect<string, HostOperationErrorAggregate>;
  pathExists(path: string): Effect.Effect<boolean, HostPathAccessErrorAggregate>;
  join(...paths: string[]): string;
};
