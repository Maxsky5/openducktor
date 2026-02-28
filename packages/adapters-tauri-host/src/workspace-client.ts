import {
  type RepoConfig,
  repoConfigSchema,
  type WorkspaceRecord,
  workspaceRecordSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray } from "./invoke-utils";

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
  config: {
    worktreeBasePath?: string;
    branchPrefix?: string;
    agentDefaults?: {
      spec?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
      planner?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
      build?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
      qa?: { providerId: string; modelId: string; variant?: string; opencodeAgent?: string };
    };
  },
): Promise<WorkspaceRecord> => {
  const payload = await invokeFn<unknown>("workspace_update_repo_config", {
    repoPath,
    config,
  });
  return workspaceRecordSchema.parse(payload);
};

export const workspaceUpdateRepoHooks = async (
  invokeFn: InvokeFn,
  repoPath: string,
  hooks: { preStart?: string[]; postComplete?: string[] },
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

export const workspaceSetTrustedHooks = async (
  invokeFn: InvokeFn,
  repoPath: string,
  trusted: boolean,
  challenge?: { nonce: string; fingerprint: string },
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
): Promise<{
  nonce: string;
  repoPath: string;
  fingerprint: string;
  expiresAt: string;
  preStartCount: number;
  postCompleteCount: number;
}> => {
  return invokeFn("workspace_prepare_trusted_hooks_challenge", { repoPath });
};

export const getTheme = async (invokeFn: InvokeFn): Promise<string> => {
  return invokeFn<string>("get_theme");
};

export const setTheme = async (invokeFn: InvokeFn, theme: string): Promise<void> => {
  await invokeFn<void>("set_theme", { theme });
};
