import {
  type AgentModelFavorite,
  type AzureDevOpsConnectionState,
  azureDevOpsConnectionStateSchema,
  type AzureDevOpsDeviceCode,
  azureDevOpsDeviceCodeSchema,
  type AzureDevOpsRepository,
  type CustomAgentRole,
  type CustomAgentRoleInput,
  customAgentRoleSchema,
  type GitProviderRepository,
  type GlobalGitConfig,
  type KanbanTaskCardView,
  gitProviderRepositorySchema,
  type RepositoryGitProviderContext,
  repositoryGitProviderContextSchema,
  type RepoConfig,
  repoConfigSchema,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  settingsSnapshotSchema,
  type WorkspaceRecord,
  type WorkspaceAgentStudioState,
  type WorkspaceRepoConfigInput,
  type WorkspaceRepoHooksInput,
  type WorkspaceRepoSettingsInput,
  type WorkspaceCatalog,
  type WorkspacePathResolution,
  type WorkspaceRemovalCommandResult,
  workspaceCatalogSchema,
  workspacePathResolutionSchema,
  workspaceRemovalCommandResultSchema,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { arrayResultSchema, voidResultSchema } from "./invoke-utils";
import { z } from "zod";

export type {
  WorkspaceRepoConfigInput,
  WorkspaceRepoHooksInput,
  WorkspaceRepoSettingsInput,
} from "@openducktor/contracts";

const stagedLocalAttachmentSchema = z.object({
  path: z.string().refine((path) => path.trim().length > 0),
});
export type StagedLocalAttachment = z.output<typeof stagedLocalAttachmentSchema>;
export type ResolvedLocalAttachment = StagedLocalAttachment;

const workspaceList = async (invokeFn: InvokeFn): Promise<WorkspaceRecord[]> => {
  return invokeFn(
    "workspace_list",
    undefined,
    arrayResultSchema(workspaceRecordSchema, "workspace_list"),
  );
};

export type WorkspaceCreateInput = {
  workspaceId: string;
  workspaceName: string;
  repoPath: string;
  abbreviation?: string;
  tileColor?: string;
};

const workspaceAdd = async (
  invokeFn: InvokeFn,
  input: WorkspaceCreateInput,
): Promise<WorkspaceRecord> => {
  return invokeFn("workspace_add", input, workspaceRecordSchema);
};

const workspaceSelect = async (
  invokeFn: InvokeFn,
  workspaceId: string,
): Promise<WorkspaceRecord> => {
  return invokeFn("workspace_select", { workspaceId }, workspaceRecordSchema);
};

const workspaceCatalogGet = async (invokeFn: InvokeFn): Promise<WorkspaceCatalog> => {
  return invokeFn("workspace_catalog_get", undefined, workspaceCatalogSchema);
};

const workspaceResolvePath = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<WorkspacePathResolution> => {
  return invokeFn("workspace_resolve_path", { repoPath }, workspacePathResolutionSchema);
};

const workspaceClose = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  expectedRepoPath: string,
): Promise<WorkspaceCatalog> => {
  return invokeFn("workspace_close", { workspaceId, expectedRepoPath }, workspaceCatalogSchema);
};

const workspaceReopen = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  expectedRepoPath: string,
): Promise<WorkspaceCatalog> => {
  return invokeFn("workspace_reopen", { workspaceId, expectedRepoPath }, workspaceCatalogSchema);
};

const workspaceRemove = async (
  invokeFn: InvokeFn,
  input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  },
): Promise<WorkspaceRemovalCommandResult> => {
  return invokeFn("workspace_remove", input, workspaceRemovalCommandResultSchema);
};

const workspaceReorder = async (
  invokeFn: InvokeFn,
  workspaceOrder: string[],
): Promise<WorkspaceRecord[]> => {
  return invokeFn(
    "workspace_reorder",
    { workspaceOrder },
    arrayResultSchema(workspaceRecordSchema, "workspace_reorder"),
  );
};

const workspaceUpdateRepoConfig = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  config: WorkspaceRepoConfigInput,
): Promise<WorkspaceRecord> => {
  return invokeFn("workspace_update_repo_config", { workspaceId, config }, workspaceRecordSchema);
};

const workspaceSaveRepoSettings = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  settings: WorkspaceRepoSettingsInput,
): Promise<WorkspaceRecord> => {
  return invokeFn("workspace_save_repo_settings", { workspaceId, settings }, workspaceRecordSchema);
};

const workspaceUpdateRepoHooks = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  hooks: WorkspaceRepoHooksInput,
): Promise<WorkspaceRecord> => {
  return invokeFn("workspace_update_repo_hooks", { workspaceId, hooks }, workspaceRecordSchema);
};

const workspaceGetRepoConfig = async (
  invokeFn: InvokeFn,
  workspaceId: string,
): Promise<RepoConfig> => {
  return invokeFn("workspace_get_repo_config", { workspaceId }, repoConfigSchema);
};

const workspaceReplaceAgentStudioState = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  state: WorkspaceAgentStudioState,
): Promise<RepoConfig> => {
  return invokeFn("workspace_replace_agent_studio_state", { workspaceId, state }, repoConfigSchema);
};

const workspaceGetSettingsSnapshot = async (invokeFn: InvokeFn): Promise<SettingsSnapshot> => {
  return invokeFn("workspace_get_settings_snapshot", undefined, settingsSnapshotSchema);
};

const workspaceSaveSettingsSnapshot = async (
  invokeFn: InvokeFn,
  snapshot: SettingsSnapshotSaveInput,
): Promise<WorkspaceRecord[]> => {
  return invokeFn(
    "workspace_save_settings_snapshot",
    { snapshot },
    arrayResultSchema(workspaceRecordSchema, "workspace_save_settings_snapshot"),
  );
};

const workspaceUpdateAgentModelFavorites = async (
  invokeFn: InvokeFn,
  favorites: AgentModelFavorite[],
): Promise<SettingsSnapshot> => {
  return invokeFn("workspace_update_agent_model_favorites", { favorites }, settingsSnapshotSchema);
};

const workspaceUpdateKanbanTaskCardView = async (
  invokeFn: InvokeFn,
  taskCardView: KanbanTaskCardView,
): Promise<SettingsSnapshot> => {
  return invokeFn(
    "workspace_update_kanban_task_card_view",
    { taskCardView },
    settingsSnapshotSchema,
  );
};

const workspaceUpdateGlobalGitConfig = async (
  invokeFn: InvokeFn,
  git: GlobalGitConfig,
): Promise<void> => {
  await invokeFn("workspace_update_global_git_config", { git }, voidResultSchema);
};

const workspaceDetectGithubRepository = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<GitProviderRepository | null> => {
  return invokeFn(
    "workspace_detect_github_repository",
    { repoPath },
    gitProviderRepositorySchema.nullable(),
  );
};

const workspaceDetectAzureDevOpsRepository = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<GitProviderRepository> =>
  invokeFn("workspace_detect_azure_devops_repository", { repoPath }, gitProviderRepositorySchema);

export type AzureDevOpsConnectionInput = {
  repoPath: string;
  repository: AzureDevOpsRepository;
};

const workspaceGetGitProviderContext = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<RepositoryGitProviderContext> => {
  return invokeFn(
    "workspace_get_git_provider_context",
    { repoPath },
    repositoryGitProviderContextSchema,
  );
};

const setTheme = async (invokeFn: InvokeFn, theme: string): Promise<void> => {
  await invokeFn("set_theme", { theme }, voidResultSchema);
};

const workspaceStageLocalAttachment = async (
  invokeFn: InvokeFn,
  input: {
    name: string;
    mime?: string;
    base64Data: string;
  },
): Promise<StagedLocalAttachment> => {
  return invokeFn("workspace_stage_local_attachment", input, stagedLocalAttachmentSchema);
};

const workspaceResolveLocalAttachmentPath = async (
  invokeFn: InvokeFn,
  input: {
    path: string;
  },
): Promise<ResolvedLocalAttachment> => {
  return invokeFn("workspace_resolve_local_attachment_path", input, stagedLocalAttachmentSchema);
};

export class HostWorkspaceClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async customAgentRoleList(): Promise<CustomAgentRole[]> {
    return this.invokeFn(
      "custom_agent_role_list",
      undefined,
      arrayResultSchema(customAgentRoleSchema, "custom_agent_role_list"),
    );
  }

  async customAgentRoleCreate(input: CustomAgentRoleInput): Promise<CustomAgentRole> {
    return this.invokeFn("custom_agent_role_create", { input }, customAgentRoleSchema);
  }

  async customAgentRoleUpdate(id: string, input: CustomAgentRoleInput): Promise<CustomAgentRole> {
    return this.invokeFn("custom_agent_role_update", { id, input }, customAgentRoleSchema);
  }

  async customAgentRoleDelete(id: string): Promise<void> {
    return this.invokeFn("custom_agent_role_delete", { id }, voidResultSchema);
  }

  async workspaceList(): Promise<WorkspaceRecord[]> {
    return workspaceList(this.invokeFn);
  }

  async workspaceAdd(input: WorkspaceCreateInput): Promise<WorkspaceRecord> {
    return workspaceAdd(this.invokeFn, input);
  }

  async workspaceSelect(workspaceId: string): Promise<WorkspaceRecord> {
    return workspaceSelect(this.invokeFn, workspaceId);
  }

  async workspaceCatalogGet(): Promise<WorkspaceCatalog> {
    return workspaceCatalogGet(this.invokeFn);
  }

  async workspaceResolvePath(repoPath: string): Promise<WorkspacePathResolution> {
    return workspaceResolvePath(this.invokeFn, repoPath);
  }

  async workspaceClose(workspaceId: string, expectedRepoPath: string): Promise<WorkspaceCatalog> {
    return workspaceClose(this.invokeFn, workspaceId, expectedRepoPath);
  }

  async workspaceReopen(workspaceId: string, expectedRepoPath: string): Promise<WorkspaceCatalog> {
    return workspaceReopen(this.invokeFn, workspaceId, expectedRepoPath);
  }

  async workspaceRemove(input: {
    workspaceId: string;
    expectedRepoPath: string;
    removeTaskWorktrees: boolean;
  }): Promise<WorkspaceRemovalCommandResult> {
    return workspaceRemove(this.invokeFn, input);
  }

  async workspaceReorder(workspaceOrder: string[]): Promise<WorkspaceRecord[]> {
    return workspaceReorder(this.invokeFn, workspaceOrder);
  }

  async workspaceUpdateRepoConfig(
    workspaceId: string,
    config: WorkspaceRepoConfigInput,
  ): Promise<WorkspaceRecord> {
    return workspaceUpdateRepoConfig(this.invokeFn, workspaceId, config);
  }

  async workspaceSaveRepoSettings(
    workspaceId: string,
    settings: WorkspaceRepoSettingsInput,
  ): Promise<WorkspaceRecord> {
    return workspaceSaveRepoSettings(this.invokeFn, workspaceId, settings);
  }

  async workspaceUpdateRepoHooks(
    workspaceId: string,
    hooks: WorkspaceRepoHooksInput,
  ): Promise<WorkspaceRecord> {
    return workspaceUpdateRepoHooks(this.invokeFn, workspaceId, hooks);
  }

  async workspaceGetRepoConfig(workspaceId: string): Promise<RepoConfig> {
    return workspaceGetRepoConfig(this.invokeFn, workspaceId);
  }

  async workspaceReplaceAgentStudioState(
    workspaceId: string,
    state: WorkspaceAgentStudioState,
  ): Promise<RepoConfig> {
    return workspaceReplaceAgentStudioState(this.invokeFn, workspaceId, state);
  }

  async workspaceGetSettingsSnapshot(): Promise<SettingsSnapshot> {
    return workspaceGetSettingsSnapshot(this.invokeFn);
  }

  async workspaceSaveSettingsSnapshot(
    snapshot: SettingsSnapshotSaveInput,
  ): Promise<WorkspaceRecord[]> {
    return workspaceSaveSettingsSnapshot(this.invokeFn, snapshot);
  }

  async workspaceUpdateAgentModelFavorites(
    favorites: AgentModelFavorite[],
  ): Promise<SettingsSnapshot> {
    return workspaceUpdateAgentModelFavorites(this.invokeFn, favorites);
  }

  async workspaceUpdateKanbanTaskCardView(
    taskCardView: KanbanTaskCardView,
  ): Promise<SettingsSnapshot> {
    return workspaceUpdateKanbanTaskCardView(this.invokeFn, taskCardView);
  }

  async workspaceUpdateGlobalGitConfig(git: GlobalGitConfig): Promise<void> {
    return workspaceUpdateGlobalGitConfig(this.invokeFn, git);
  }

  async workspaceDetectGithubRepository(repoPath: string): Promise<GitProviderRepository | null> {
    return workspaceDetectGithubRepository(this.invokeFn, repoPath);
  }

  async workspaceDetectAzureDevOpsRepository(repoPath: string): Promise<GitProviderRepository> {
    return workspaceDetectAzureDevOpsRepository(this.invokeFn, repoPath);
  }

  async workspaceGetAzureDevOpsConnection(
    input: AzureDevOpsConnectionInput,
  ): Promise<AzureDevOpsConnectionState> {
    return this.invokeFn(
      "workspace_get_azure_devops_connection",
      input,
      azureDevOpsConnectionStateSchema,
    );
  }

  async workspaceStartAzureDevOpsSignIn(
    input: AzureDevOpsConnectionInput,
  ): Promise<AzureDevOpsDeviceCode> {
    return this.invokeFn(
      "workspace_start_azure_devops_sign_in",
      input,
      azureDevOpsDeviceCodeSchema,
    );
  }

  async workspaceCancelAzureDevOpsSignIn(attemptId: string): Promise<void> {
    await this.invokeFn("workspace_cancel_azure_devops_sign_in", { attemptId }, voidResultSchema);
  }

  async workspaceReplaceAzureDevOpsPat(
    input: AzureDevOpsConnectionInput & { pat: string },
  ): Promise<AzureDevOpsConnectionState> {
    return this.invokeFn(
      "workspace_replace_azure_devops_pat",
      input,
      azureDevOpsConnectionStateSchema,
    );
  }

  async workspaceDisconnectAzureDevOps(input: AzureDevOpsConnectionInput): Promise<void> {
    await this.invokeFn("workspace_disconnect_azure_devops", input, voidResultSchema);
  }

  async workspaceGetGitProviderContext(repoPath: string): Promise<RepositoryGitProviderContext> {
    return workspaceGetGitProviderContext(this.invokeFn, repoPath);
  }

  async workspaceStageLocalAttachment(input: {
    name: string;
    mime?: string;
    base64Data: string;
  }): Promise<StagedLocalAttachment> {
    return workspaceStageLocalAttachment(this.invokeFn, input);
  }

  async workspaceResolveLocalAttachmentPath(input: {
    path: string;
  }): Promise<ResolvedLocalAttachment> {
    return workspaceResolveLocalAttachmentPath(this.invokeFn, input);
  }

  async setTheme(theme: string): Promise<void> {
    return setTheme(this.invokeFn, theme);
  }
}
