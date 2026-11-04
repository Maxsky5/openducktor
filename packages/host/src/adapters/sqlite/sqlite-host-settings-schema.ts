import { REPO_ACTION_ICON_VALUES, type AgentModelDefault } from "@openducktor/contracts";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { runtimeSettingsSchema } from "./sqlite-runtime-settings-schema";
import { booleanCheck, column, enumCheck } from "./sqlite-schema-sql";
export * from "./sqlite-runtime-settings-schema";

export const workspaces = sqliteTable(
  "workspaces",
  {
    workspaceId: text("workspace_id").primaryKey().notNull(),
    workspaceName: text("workspace_name").notNull(),
    abbreviation: text("abbreviation"),
    tileColor: text("tile_color"),
    repoPath: text("repo_path").notNull(),
    worktreeBasePath: text("worktree_base_path"),
    branchPrefix: text("branch_prefix").notNull(),
    defaultTargetRemote: text("default_target_remote"),
    defaultTargetBranch: text("default_target_branch").notNull(),
    defaultActionId: text("default_action_id"),
    closed: integer("closed", { mode: "boolean" }).notNull(),
  },
  (table) => [
    index("idx_workspaces_repo_path").on(table.repoPath),
    check("chk_workspaces_closed", booleanCheck(table.closed)),
    foreignKey({
      name: "fk_workspaces_default_action",
      columns: [table.workspaceId, table.defaultActionId],
      foreignColumns: [workspaceActions.workspaceId, workspaceActions.actionId],
    }),
  ],
);

export const workspaceDefaultModels = sqliteTable("workspace_default_models", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .notNull()
    .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
  runtimeKind: text("runtime_kind").$type<AgentModelDefault["runtimeKind"]>().notNull(),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  variant: text("variant"),
  profileId: text("profile_id"),
});

export const workspaceRoleDefaults = sqliteTable(
  "workspace_role_defaults",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
    runtimeKind: text("runtime_kind").$type<AgentModelDefault["runtimeKind"]>().notNull(),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    variant: text("variant"),
    profileId: text("profile_id"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.roleId] })],
);

export const workspaceBuildCompletionCommands = sqliteTable(
  "workspace_build_completion_commands",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    command: text("command").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.position] }),
    check("chk_workspace_build_completion_commands_position", sql`${column(table.position)} >= 0`),
  ],
);

export const workspaceActions = sqliteTable(
  "workspace_actions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references((): AnySQLiteColumn => workspaces.workspaceId, { onDelete: "cascade" }),
    actionId: text("action_id").notNull(),
    position: integer("position").notNull(),
    icon: text("icon", { enum: REPO_ACTION_ICON_VALUES }).notNull(),
    name: text("name").notNull(),
    command: text("command").notNull(),
    runOnWorktreeCreate: integer("run_on_worktree_create", { mode: "boolean" }).notNull(),
    waitBeforeAgentStart: integer("wait_before_agent_start", { mode: "boolean" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.actionId] }),
    uniqueIndex("idx_workspace_actions_position").on(table.workspaceId, table.position),
    check("chk_workspace_actions_position_nonnegative", sql`${column(table.position)} >= 0`),
    check("chk_workspace_actions_run_on_worktree_create", booleanCheck(table.runOnWorktreeCreate)),
    check(
      "chk_workspace_actions_wait_before_agent_start",
      booleanCheck(table.waitBeforeAgentStart),
    ),
    check(
      "chk_workspace_actions_wait_requires_run",
      sql`${column(table.waitBeforeAgentStart)} = 0 or ${column(table.runOnWorktreeCreate)} = 1`,
    ),
  ],
);

export const workspaceCopyPaths = sqliteTable(
  "workspace_copy_paths",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    path: text("path").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.position] }),
    check("chk_workspace_copy_paths_position", sql`${column(table.position)} >= 0`),
  ],
);

export const workspacePromptOverrides = sqliteTable(
  "workspace_prompt_overrides",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    templateId: text("template_id").notNull(),
    template: text("template").notNull(),
    baseVersion: integer("base_version").notNull(),
    enabled: integer("enabled", { mode: "boolean" }),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.templateId] }),
    check("chk_workspace_prompt_overrides_base_version", sql`${column(table.baseVersion)} >= 1`),
    check("chk_workspace_prompt_overrides_enabled", booleanCheck(table.enabled)),
  ],
);

export const workspaceRemovals = sqliteTable(
  "workspace_removals",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    removeTaskWorktrees: integer("remove_task_worktrees", { mode: "boolean" }).notNull(),
    phase: text("phase", { enum: ["worktrees", "attachments", "task_store"] }).notNull(),
    pendingWorktreePath: text("pending_worktree_path"),
  },
  (table) => [
    check("chk_workspace_removals_remove_task_worktrees", booleanCheck(table.removeTaskWorktrees)),
    check(
      "chk_workspace_removals_phase",
      enumCheck(table.phase, ["worktrees", "attachments", "task_store"]),
    ),
  ],
);

export const workspaceGitConfig = sqliteTable(
  "workspace_git_config",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .notNull()
      .references(() => workspaces.workspaceId, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
    autoDetected: integer("auto_detected", { mode: "boolean" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_workspace_git_config_provider").on(table.workspaceId, table.providerId),
    check(
      "chk_workspace_git_config_provider_id",
      sql`length(trim(${column(table.providerId)})) > 0`,
    ),
    check("chk_workspace_git_config_enabled", booleanCheck(table.enabled)),
    check("chk_workspace_git_config_auto_detected", booleanCheck(table.autoDetected)),
  ],
);

export const workspaceRepositoryIdentity = sqliteTable(
  "workspace_repository_identity",
  {
    workspaceId: text("workspace_id").primaryKey().notNull(),
    providerId: text("provider_id").notNull(),
    host: text("host").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
  },
  (table) => [
    check(
      "chk_workspace_repository_identity_provider",
      sql`${column(table.providerId)} <> 'azure_devops'`,
    ),
    foreignKey({
      columns: [table.workspaceId, table.providerId],
      foreignColumns: [workspaceGitConfig.workspaceId, workspaceGitConfig.providerId],
    }).onDelete("cascade"),
  ],
);

export type StoredAzureRemoteMappings = Array<{
  remoteName: string;
  fetchUrl: string;
  pushUrls: [string, ...string[]];
}>;

export const workspaceAzureConfig = sqliteTable(
  "workspace_azure_config",
  {
    workspaceId: text("workspace_id").primaryKey().notNull(),
    providerId: text("provider_id", { enum: ["azure_devops"] }).notNull(),
    deployment: text("deployment", { enum: ["services", "server"] }),
    serviceUrl: text("service_url"),
    organization: text("organization"),
    project: text("project"),
    repositoryName: text("repository_name"),
    httpConsentCollectionUrl: text("http_consent_collection_url"),
    areaPath: text("area_path"),
    remoteMappingsJson: text("remote_mappings_json").notNull().default("[]"),
  },
  (table) => [
    check("chk_workspace_azure_config_provider", sql`${column(table.providerId)} = 'azure_devops'`),
    check(
      "chk_workspace_azure_config_deployment",
      enumCheck(table.deployment, ["services", "server"]),
    ),
    check(
      "chk_workspace_azure_config_remote_mappings",
      sql`json_valid(${column(table.remoteMappingsJson)}) and json_type(${column(table.remoteMappingsJson)}) = 'array'`,
    ),
    check(
      "chk_workspace_azure_config_identity",
      sql`(${column(table.deployment)} is null and ${column(table.serviceUrl)} is null and ${column(table.organization)} is null
        and ${column(table.project)} is null and ${column(table.repositoryName)} is null)
        or (${column(table.deployment)} is not null and ${column(table.serviceUrl)} is not null
          and ${column(table.organization)} is not null and ${column(table.project)} is not null
          and ${column(table.repositoryName)} is not null)`,
    ),
    check(
      "chk_workspace_azure_config_nonempty",
      sql`${column(table.repositoryName)} is not null or ${column(table.httpConsentCollectionUrl)} is not null
        or ${column(table.areaPath)} is not null`,
    ),
    check(
      "chk_workspace_azure_config_mappings_require_identity",
      sql`${column(table.repositoryName)} is not null or json_array_length(${column(table.remoteMappingsJson)}) = 0`,
    ),
    foreignKey({
      columns: [table.workspaceId, table.providerId],
      foreignColumns: [workspaceGitConfig.workspaceId, workspaceGitConfig.providerId],
    }).onDelete("cascade"),
  ],
);

/** A saved GitLab account. Its secret is in the OS secure store, keyed by the account ID. */
export const gitlabAccounts = sqliteTable(
  "gitlab_accounts",
  {
    accountId: text("account_id").primaryKey().notNull(),
    instanceUrl: text("instance_url").notNull(),
    userId: integer("user_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    authKind: text("auth_kind", { enum: ["oauth", "token"] }).notNull(),
    tokenExpiresAt: integer("token_expires_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_gitlab_accounts_instance_user").on(table.instanceUrl, table.userId),
    check("chk_gitlab_accounts_auth_kind", enumCheck(table.authKind, ["oauth", "token"])),
  ],
);

export const workspaceGitlabConfig = sqliteTable(
  "workspace_gitlab_config",
  {
    workspaceId: text("workspace_id").primaryKey().notNull(),
    providerId: text("provider_id", { enum: ["gitlab"] }).notNull(),
    instanceUrl: text("instance_url"),
    projectPath: text("project_path"),
    accountId: text("account_id").references(() => gitlabAccounts.accountId, {
      onDelete: "restrict",
    }),
    remoteName: text("remote_name"),
    httpConsentInstanceUrl: text("http_consent_instance_url"),
  },
  (table) => [
    check("chk_workspace_gitlab_config_provider", sql`${column(table.providerId)} = 'gitlab'`),
    check(
      "chk_workspace_gitlab_config_identity",
      sql`(${column(table.instanceUrl)} is null) = (${column(table.projectPath)} is null)`,
    ),
    index("idx_workspace_gitlab_config_account").on(table.accountId),
    foreignKey({
      columns: [table.workspaceId, table.providerId],
      foreignColumns: [workspaceGitConfig.workspaceId, workspaceGitConfig.providerId],
    }).onDelete("cascade"),
  ],
);

export const hostSettings = sqliteTable(
  "host_settings",
  {
    singletonId: integer("singleton_id").primaryKey().notNull(),
    hostId: text("host_id").notNull(),
    defaultMergeMethod: text("default_merge_method", {
      enum: ["merge_commit", "squash", "rebase"],
    }).notNull(),
    removeWorktreeOnClose: integer("remove_worktree_on_close", { mode: "boolean" }).notNull(),
    alwaysStartQaReviewsFresh: integer("always_start_qa_reviews_fresh", {
      mode: "boolean",
    }).notNull(),
    remoteAccessEnabled: integer("remote_access_enabled", { mode: "boolean" }).notNull(),
  },
  (table) => [
    check("chk_host_settings_singleton", sql`${column(table.singletonId)} = 1`),
    check("chk_host_settings_remove_worktree_on_close", booleanCheck(table.removeWorktreeOnClose)),
    check(
      "chk_host_settings_always_start_qa_reviews_fresh",
      booleanCheck(table.alwaysStartQaReviewsFresh),
    ),
    check("chk_host_settings_remote_access_enabled", booleanCheck(table.remoteAccessEnabled)),
  ],
);

export const customAgentRoles = sqliteTable(
  "custom_agent_roles",
  {
    roleId: text("role_id").primaryKey().notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    systemPrompt: text("system_prompt").notNull(),
  },
  (table) => [
    uniqueIndex("idx_custom_agent_roles_position").on(table.position),
    uniqueIndex("idx_custom_agent_roles_name_key").on(table.nameKey),
    check("chk_custom_agent_roles_position_nonnegative", sql`${column(table.position)} >= 0`),
  ],
);

export const globalPromptOverrides = sqliteTable(
  "global_prompt_overrides",
  {
    templateId: text("template_id").primaryKey().notNull(),
    template: text("template").notNull(),
    baseVersion: integer("base_version").notNull(),
    enabled: integer("enabled", { mode: "boolean" }),
  },
  (table) => [
    check("chk_global_prompt_overrides_base_version", sql`${column(table.baseVersion)} >= 1`),
    check("chk_global_prompt_overrides_enabled", booleanCheck(table.enabled)),
  ],
);

export const remoteAccessListener = sqliteTable(
  "remote_access_listener",
  {
    singletonId: integer("singleton_id")
      .primaryKey()
      .notNull()
      .references(() => hostSettings.singletonId, { onDelete: "cascade" }),
    listenHost: text("listen_host").notNull(),
    listenPort: integer("listen_port").notNull(),
    publicEndpoint: text("public_endpoint"),
    webOriginsPresent: integer("web_origins_present", { mode: "boolean" }).notNull(),
  },
  (table) => [
    check("chk_remote_access_listener_port", sql`${column(table.listenPort)} between 1 and 65535`),
    check("chk_remote_access_listener_web_origins_present", booleanCheck(table.webOriginsPresent)),
  ],
);

export const remoteAccessWebOrigins = sqliteTable(
  "remote_access_web_origins",
  {
    singletonId: integer("singleton_id")
      .notNull()
      .references(() => remoteAccessListener.singletonId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    origin: text("origin").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.singletonId, table.position] }),
    check(
      "chk_remote_access_web_origins_position",
      sql`${column(table.position)} between 0 and 31`,
    ),
  ],
);

export const autopilotRules = sqliteTable(
  "autopilot_rules",
  { workflowId: text("workflow_id").notNull(), eventId: text("event_id").notNull() },
  (table) => [primaryKey({ columns: [table.workflowId, table.eventId] })],
);

export const autopilotRuleActions = sqliteTable(
  "autopilot_rule_actions",
  {
    workflowId: text("workflow_id").notNull(),
    eventId: text("event_id").notNull(),
    position: integer("position").notNull(),
    actionId: text("action_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workflowId, table.eventId, table.position] }),
    uniqueIndex("idx_autopilot_rule_actions_identity").on(
      table.workflowId,
      table.eventId,
      table.actionId,
    ),
    check("chk_autopilot_rule_actions_position", sql`${column(table.position)} >= 0`),
    foreignKey({
      columns: [table.workflowId, table.eventId],
      foreignColumns: [autopilotRules.workflowId, autopilotRules.eventId],
    }).onDelete("cascade"),
  ],
);

export const hostSettingsSchema = {
  ...runtimeSettingsSchema,
  workspaces,
  workspaceDefaultModels,
  workspaceRoleDefaults,
  workspaceBuildCompletionCommands,
  workspaceActions,
  workspaceCopyPaths,
  workspacePromptOverrides,
  workspaceRemovals,
  workspaceGitConfig,
  workspaceRepositoryIdentity,
  workspaceAzureConfig,
  gitlabAccounts,
  workspaceGitlabConfig,
  hostSettings,
  customAgentRoles,
  globalPromptOverrides,
  remoteAccessListener,
  remoteAccessWebOrigins,
  autopilotRules,
  autopilotRuleActions,
};
