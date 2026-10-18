import type {
  RepoConfig,
  RepoPromptOverrides,
  RuntimeKind,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { type AgentModelSelection, type AgentRole, mergePromptOverrides } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "../../../queries/workspace";
import type { HostClient } from "@openducktor/host-client";

export type TaskDocuments = {
  specMarkdown: string;
  planMarkdown: string;
  qaMarkdown: string;
};

export type RepoConfigLoader = (workspaceId: string) => Promise<RepoConfig>;

export const loadTaskDocuments = async (
  repoPath: string,
  taskId: string,
  taskMetadataGet: HostClient["taskMetadataGet"],
): Promise<TaskDocuments> => {
  const metadata = await taskMetadataGet(repoPath, taskId);

  return {
    specMarkdown: metadata.spec.markdown,
    planMarkdown: metadata.plan.markdown,
    qaMarkdown: metadata.qaReport?.markdown ?? "",
  };
};

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

export const loadRepoPromptOverrides = async (
  workspaceId: string,
  options: {
    queryClient: QueryClient;
    loadRepoConfig?: () => Promise<RepoConfig>;
    loadSettingsSnapshot?: () => Promise<SettingsSnapshot>;
  },
): Promise<RepoPromptOverrides> => {
  const { queryClient } = options;
  const [repoConfig, snapshot] = await Promise.all([
    options.loadRepoConfig
      ? options.loadRepoConfig()
      : loadRepoConfigFromQuery(queryClient, workspaceId),
    options.loadSettingsSnapshot
      ? options.loadSettingsSnapshot()
      : loadSettingsSnapshotFromQuery(queryClient),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
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
