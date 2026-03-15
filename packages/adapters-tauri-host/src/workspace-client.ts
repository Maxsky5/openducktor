import {
  type GitProviderRepository,
  type GitTargetBranch,
  type GlobalGitConfig,
  gitProviderRepositorySchema,
  type RepoConfig,
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
  repoPath: string;
  fingerprint: string;
  expiresAt: string;
  preStartCount: number;
  postCompleteCount: number;
};

export type TrustedHooksProof = {
  nonce: string;
  fingerprint: string;
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
    repoPath: readString("repoPath"),
    fingerprint: readString("fingerprint"),
    expiresAt: readString("expiresAt"),
    preStartCount: readCount("preStartCount"),
    postCompleteCount: readCount("postCompleteCount"),
  };
};

export const workspaceList = async (invokeFn: InvokeFn): Promise<WorkspaceRecord[]> => {
  const payload = await invokeFn<unknown>("workspace_list");
  return parseArray(workspaceRecordSchema, payload);
};

export const workspaceAdd = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_add", { repoPath });
  return workspaceRecordSchema.parse(payload);
};

export const workspaceSelect = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_select", { repoPath });
  return workspaceRecordSchema.parse(payload);
};

export const workspaceUpdateRepoConfig = async (
  invokeFn: InvokeFn,
  repoPath: string,
  config: WorkspaceRepoConfigInput,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_update_repo_config", {
    repoPath,
    config,
  });
  return workspaceRecordSchema.parse(payload);
};

export const workspaceSaveRepoSettings = async (
  invokeFn: InvokeFn,
  repoPath: string,
  settings: WorkspaceRepoSettingsInput,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_save_repo_settings", {
    repoPath,
    settings,
  });
  return workspaceRecordSchema.parse(payload);
};

export const workspaceUpdateRepoHooks = async (
  invokeFn: InvokeFn,
  repoPath: string,
  hooks: WorkspaceRepoHooksInput,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_update_repo_hooks", {
    repoPath,
    hooks,
  });
  return workspaceRecordSchema.parse(payload);
};

export const workspaceGetRepoConfig = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<RepoConfig> => {
  const payload = await invokeFn<unknown>("workspace_get_repo_config", { repoPath });
  return repoConfigSchema.parse(payload);
};

export const workspaceGetSettingsSnapshot = async (
  invokeFn: InvokeFn,
): Promise<SettingsSnapshot> => {
  const payload = await invokeFn<unknown>("workspace_get_settings_snapshot");
  return settingsSnapshotSchema.parse(payload);
};

export const workspaceSaveSettingsSnapshot = async (
  invokeFn: InvokeFn,
  snapshot: SettingsSnapshot,
): Promise<WorkspaceRecord[]> => {
  const payload = await invokeFn<unknown>("workspace_save_settings_snapshot", { snapshot });
  return parseArray(workspaceRecordSchema, payload);
};

export const workspaceUpdateGlobalGitConfig = async (
  invokeFn: InvokeFn,
  git: GlobalGitConfig,
): Promise<void> => {
  await invokeFn<void>("workspace_update_global_git_config", { git });
};

export const workspaceDetectGithubRepository = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<GitProviderRepository | null> => {
  const payload = await invokeFn<unknown>("workspace_detect_github_repository", { repoPath });
  return payload === null ? null : gitProviderRepositorySchema.parse(payload);
};

export const workspaceSetTrustedHooks = async (
  invokeFn: InvokeFn,
  repoPath: string,
  trusted: boolean,
  challenge?: TrustedHooksProof,
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_set_trusted_hooks", {
    repoPath,
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

export const workspacePrepareTrustedHooksChallenge = async (
  invokeFn: InvokeFn,
  repoPath: string,
): Promise<TrustedHooksChallenge> => {
  const payload = await invokeFn<unknown>("workspace_prepare_trusted_hooks_challenge", {
    repoPath,
  });
  return parseTrustedHooksChallenge(payload);
};

export const setTheme = async (invokeFn: InvokeFn, theme: string): Promise<void> => {
  await invokeFn<void>("set_theme", { theme });
};

export class TauriWorkspaceClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async workspaceList(): Promise<WorkspaceRecord[]> {
    return workspaceList(this.invokeFn);
  }

  async workspaceAdd(repoPath: string): Promise<WorkspaceRecord> {
    return workspaceAdd(this.invokeFn, repoPath);
  }

  async workspaceSelect(repoPath: string): Promise<WorkspaceRecord> {
    return workspaceSelect(this.invokeFn, repoPath);
  }

  async workspaceUpdateRepoConfig(
    repoPath: string,
    config: WorkspaceRepoConfigInput,
  ): Promise<WorkspaceRecord> {
    return workspaceUpdateRepoConfig(this.invokeFn, repoPath, config);
  }

  async workspaceSaveRepoSettings(
    repoPath: string,
    settings: WorkspaceRepoSettingsInput,
  ): Promise<WorkspaceRecord> {
    return workspaceSaveRepoSettings(this.invokeFn, repoPath, settings);
  }

  async workspaceUpdateRepoHooks(
    repoPath: string,
    hooks: WorkspaceRepoHooksInput,
  ): Promise<WorkspaceRecord> {
    return workspaceUpdateRepoHooks(this.invokeFn, repoPath, hooks);
  }

  async workspaceGetRepoConfig(repoPath: string): Promise<RepoConfig> {
    return workspaceGetRepoConfig(this.invokeFn, repoPath);
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

  async workspacePrepareTrustedHooksChallenge(repoPath: string): Promise<TrustedHooksChallenge> {
    return workspacePrepareTrustedHooksChallenge(this.invokeFn, repoPath);
  }

  async workspaceSetTrustedHooks(
    repoPath: string,
    trusted: boolean,
    challenge?: TrustedHooksProof,
  ): Promise<WorkspaceRecord> {
    return workspaceSetTrustedHooks(this.invokeFn, repoPath, trusted, challenge);
  }

  async setTheme(theme: string): Promise<void> {
    return setTheme(this.invokeFn, theme);
  }
}
