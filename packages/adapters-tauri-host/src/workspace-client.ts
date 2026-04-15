import {
  type GitProviderRepository,
  type GitTargetBranch,
  type GlobalGitConfig,
  gitProviderRepositorySchema,
  type RepoConfig,
  type RepoDevServerScript,
  type RepoGitConfig,
  type RepoPromptOverrides,
  type RuntimeKind,
  repoConfigSchema,
  type SettingsSnapshot,
  settingsSnapshotSchema,
  type WorkspaceRecord,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";

export type AgentDefaultConfig = {
  providerId: string;
  modelId: string;
  variant?: string;
  profileId?: string;
};

export type WorkspaceAgentDefaults = {
  spec?: AgentDefaultConfig;
  planner?: AgentDefaultConfig;
  build?: AgentDefaultConfig;
  qa?: AgentDefaultConfig;
};

export type WorkspaceRepoConfigInput = {
  defaultRuntimeKind?: RuntimeKind;
  worktreeBasePath?: string;
  branchPrefix?: string;
  defaultTargetBranch?: GitTargetBranch;
  git?: RepoGitConfig;
  devServers?: RepoDevServerScript[];
  worktreeFileCopies?: string[];
  agentDefaults?: WorkspaceAgentDefaults;
  promptOverrides?: RepoPromptOverrides;
};

export type WorkspaceRepoSettingsInput = WorkspaceRepoConfigInput & {
  defaultTargetBranch?: GitTargetBranch;
  trustedHooks: boolean;
  hooks?: WorkspaceRepoHooksInput;
  worktreeFileCopies?: string[];
};

export type WorkspaceRepoHooksInput = {
  preStart?: string[];
  postComplete?: string[];
};

export type TrustedHooksChallenge = {
  nonce: string;
  workspaceId: string;
  fingerprint: string;
  expiresAt: string;
  preStartCount: number;
  postCompleteCount: number;
};

export type TrustedHooksProof = {
  nonce: string;
  fingerprint: string;
};

export type StagedLocalAttachment = {
  path: string;
};

export type ResolvedLocalAttachment = {
  path: string;
};

const parseTrustedHooksChallenge = (payload: unknown): TrustedHooksChallenge => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Expected trusted hooks challenge payload from host command");
  }

  const candidate = payload as Record<string, unknown>;
  const readString = (key: keyof TrustedHooksChallenge): string => {
    const value = candidate[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Expected string field '${key}' in trusted hooks challenge payload`);
    }
    return value;
  };
  const readCount = (key: "preStartCount" | "postCompleteCount"): number => {
    const value = candidate[key];
    if (!Number.isInteger(value) || (value as number) < 0) {
      throw new Error(
        `Expected non-negative integer field '${key}' in trusted hooks challenge payload`,
      );
    }
    return value as number;
  };

  return {
    nonce: readString("nonce"),
    workspaceId: readString("workspaceId"),
    fingerprint: readString("fingerprint"),
    expiresAt: readString("expiresAt"),
    preStartCount: readCount("preStartCount"),
    postCompleteCount: readCount("postCompleteCount"),
  };
};

const parseStagedLocalAttachment = (payload: unknown): StagedLocalAttachment => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Expected staged local attachment payload from host command");
  }

  const candidate = payload as Record<string, unknown>;
  const path = candidate.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("Expected non-empty 'path' in staged local attachment payload");
  }

  return { path };
};

const parseResolvedLocalAttachment = (payload: unknown): ResolvedLocalAttachment => {
  return parseStagedLocalAttachment(payload);
};

const workspaceList = async (invokeFn: InvokeFn): Promise<WorkspaceRecord[]> => {
  const payload = await invokeFn("workspace_list");
  return parseArray(workspaceRecordSchema, payload, "workspace_list");
};

const workspaceAdd = async (invokeFn: InvokeFn, repoPath: string): Promise<WorkspaceRecord> => {
  const payload = await invokeFn("workspace_add", { repoPath });
  return workspaceRecordSchema.parse(payload);
};

const workspaceSelect = async (
  invokeFn: InvokeFn,
  workspaceId: string,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn("workspace_select", { workspaceId });
  return workspaceRecordSchema.parse(payload);
};

const workspaceUpdateRepoConfig = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  config: WorkspaceRepoConfigInput,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn("workspace_update_repo_config", {
    workspaceId,
    config,
  });
  return workspaceRecordSchema.parse(payload);
};

const workspaceSaveRepoSettings = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  settings: WorkspaceRepoSettingsInput,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn("workspace_save_repo_settings", {
    workspaceId,
    settings,
  });
  return workspaceRecordSchema.parse(payload);
};

const workspaceUpdateRepoHooks = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  hooks: WorkspaceRepoHooksInput,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn("workspace_update_repo_hooks", {
    workspaceId,
    hooks,
  });
  return workspaceRecordSchema.parse(payload);
};

const workspaceGetRepoConfig = async (
  invokeFn: InvokeFn,
  workspaceId: string,
): Promise<RepoConfig> => {
  const payload = await invokeFn("workspace_get_repo_config", { workspaceId });
  return repoConfigSchema.parse(payload);
};

const workspaceGetSettingsSnapshot = async (invokeFn: InvokeFn): Promise<SettingsSnapshot> => {
  const payload = await invokeFn("workspace_get_settings_snapshot");
  return settingsSnapshotSchema.parse(payload);
};

const workspaceSaveSettingsSnapshot = async (
  invokeFn: InvokeFn,
  snapshot: SettingsSnapshot,
): Promise<WorkspaceRecord[]> => {
  const payload = await invokeFn("workspace_save_settings_snapshot", { snapshot });
  return parseArray(workspaceRecordSchema, payload, "workspace_save_settings_snapshot");
};

const workspaceUpdateGlobalGitConfig = async (
  invokeFn: InvokeFn,
  git: GlobalGitConfig,
): Promise<void> => {
  await invokeFn("workspace_update_global_git_config", { git });
};

const workspaceDetectGithubRepository = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<GitProviderRepository | null> => {
  const payload = await invokeFn("workspace_detect_github_repository", { repoPath });
  return payload === null ? null : gitProviderRepositorySchema.parse(payload);
};

const workspaceSetTrustedHooks = async (
  invokeFn: InvokeFn,
  workspaceId: string,
  trusted: boolean,
  challenge?: TrustedHooksProof,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn("workspace_set_trusted_hooks", {
    workspaceId,
    trusted,
    ...(challenge
      ? {
          challengeNonce: challenge.nonce,
          challengeFingerprint: challenge.fingerprint,
        }
      : {}),
  });
  return workspaceRecordSchema.parse(payload);
};

const workspacePrepareTrustedHooksChallenge = async (
  invokeFn: InvokeFn,
  workspaceId: string,
): Promise<TrustedHooksChallenge> => {
  const payload = await invokeFn("workspace_prepare_trusted_hooks_challenge", {
    workspaceId,
  });
  return parseTrustedHooksChallenge(payload);
};

const setTheme = async (invokeFn: InvokeFn, theme: string): Promise<void> => {
  await invokeFn("set_theme", { theme });
};

const workspaceStageLocalAttachment = async (
  invokeFn: InvokeFn,
  input: {
    name: string;
    mime?: string;
    base64Data: string;
  },
): Promise<StagedLocalAttachment> => {
  const payload = await invokeFn("workspace_stage_local_attachment", input);
  return parseStagedLocalAttachment(payload);
};

const workspaceResolveLocalAttachmentPath = async (
  invokeFn: InvokeFn,
  input: {
    path: string;
  },
): Promise<ResolvedLocalAttachment> => {
  const payload = await invokeFn("workspace_resolve_local_attachment_path", input);
  return parseResolvedLocalAttachment(payload);
};

export class TauriWorkspaceClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async workspaceList(): Promise<WorkspaceRecord[]> {
    return workspaceList(this.invokeFn);
  }

  async workspaceAdd(repoPath: string): Promise<WorkspaceRecord> {
    return workspaceAdd(this.invokeFn, repoPath);
  }

  async workspaceSelect(workspaceId: string): Promise<WorkspaceRecord> {
    return workspaceSelect(this.invokeFn, workspaceId);
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

  async workspaceSaveSettingsSnapshot(snapshot: SettingsSnapshot): Promise<WorkspaceRecord[]> {
    return workspaceSaveSettingsSnapshot(this.invokeFn, snapshot);
  }

  async workspaceUpdateGlobalGitConfig(git: GlobalGitConfig): Promise<void> {
    return workspaceUpdateGlobalGitConfig(this.invokeFn, git);
  }

  async workspaceDetectGithubRepository(repoPath: string): Promise<GitProviderRepository | null> {
    return workspaceDetectGithubRepository(this.invokeFn, repoPath);
  }

  async workspacePrepareTrustedHooksChallenge(workspaceId: string): Promise<TrustedHooksChallenge> {
    return workspacePrepareTrustedHooksChallenge(this.invokeFn, workspaceId);
  }

  async workspaceSetTrustedHooks(
    workspaceId: string,
    trusted: boolean,
    challenge?: TrustedHooksProof,
  ): Promise<WorkspaceRecord> {
    return workspaceSetTrustedHooks(this.invokeFn, workspaceId, trusted, challenge);
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
