import type { RepoConfig, RuntimeKind } from "@openducktor/contracts";
import { type AgentModelSelection } from "@openducktor/core";
import { type WorkflowRoleId as AgentRole } from "@openducktor/workflows";

export type RepoConfigLoader = (workspaceId: string) => Promise<RepoConfig>;

export const loadRepoDefaultModel = async (
  workspaceId: string,
  role: AgentRole,
  loadRepoConfig: RepoConfigLoader,
): Promise<AgentModelSelection | null> => {
  const config = await loadRepoConfig(workspaceId);
  const roleDefault = config?.agentDefaults?.[role];
  if (!roleDefault) {
    return null;
  }

  const selection: AgentModelSelection = {
    runtimeKind: roleDefault.runtimeKind,
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
  };
  if (roleDefault.variant) {
    selection.variant = roleDefault.variant;
  }
  if (roleDefault.profileId) {
    selection.profileId = roleDefault.profileId;
  }
  return selection;
};

export const requireConfiguredRuntimeKind = (
  runtimeKind: RuntimeKind | null | undefined,
  contextMessage: string,
): RuntimeKind => {
  if (!runtimeKind) {
    throw new Error(contextMessage);
  }
  return runtimeKind;
};
