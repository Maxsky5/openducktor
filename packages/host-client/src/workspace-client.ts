import {
  type AgentModelFavorite,
  type GitProviderRepository,
  type GlobalGitConfig,
  gitProviderRepositorySchema,
  type RepoConfig,
  type RuntimeKind,
  repoConfigSchema,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
  settingsSnapshotSchema,
  type WorkspaceRecord,
  type WorkspaceRepoConfigInput,
  type WorkspaceRepoHooksInput,
  type WorkspaceRepoSettingsInput,
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
  defaultRuntimeKind?: RuntimeKind;
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

  async workspaceList(): Promise<WorkspaceRecord[]> {
    return workspaceList(this.invokeFn);
  }

  async workspaceAdd(input: WorkspaceCreateInput): Promise<WorkspaceRecord> {
    return workspaceAdd(this.invokeFn, input);
  }

  async workspaceSelect(workspaceId: string): Promise<WorkspaceRecord> {
    return workspaceSelect(this.invokeFn, workspaceId);
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

  async workspaceUpdateGlobalGitConfig(git: GlobalGitConfig): Promise<void> {
    return workspaceUpdateGlobalGitConfig(this.invokeFn, git);
  }

  async workspaceDetectGithubRepository(repoPath: string): Promise<GitProviderRepository | null> {
    return workspaceDetectGithubRepository(this.invokeFn, repoPath);
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
