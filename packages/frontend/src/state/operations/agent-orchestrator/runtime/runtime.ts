import type {
  RepoConfig,
  RepoPromptOverrides,
  RuntimeKind,
  SettingsSnapshot,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import { type AgentModelSelection, type AgentRole, mergePromptOverrides } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
import { host } from "../../shared/host";

export type EnsureExistingSessionRuntime = (
  repoPath: string,
  runtimeKind: RuntimeKind,
) => Promise<void>;

export type TaskDocuments = {
  specMarkdown: string;
  planMarkdown: string;
  qaMarkdown: string;
};

type RuntimeWorkspaceQueryHost = Pick<
  typeof host,
  "workspaceGetRepoConfig" | "workspaceGetSettingsSnapshot"
>;

export type RepoConfigLoader = (workspaceId: string) => Promise<RepoConfig>;

const defaultRepoConfigLoader: RepoConfigLoader = (workspaceId: string): Promise<RepoConfig> => {
  return loadRepoConfigFromQuery(appQueryClient, workspaceId);
};

export const loadTaskDocuments = async (
  repoPath: string,
  taskId: string,
  taskMetadataGetFresh: typeof host.taskMetadataGetFresh = host.taskMetadataGetFresh,
): Promise<TaskDocuments> => {
  const metadata = await taskMetadataGetFresh(repoPath, taskId);

  return {
    specMarkdown: metadata.spec.markdown,
    planMarkdown: metadata.plan.markdown,
    qaMarkdown: metadata.qaReport?.markdown ?? "",
  };
};

export const loadRepoDefaultModel = async (
  workspaceId: string,
  role: AgentRole,
  loadRepoConfig: RepoConfigLoader = defaultRepoConfigLoader,
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
  options?: {
    queryClient?: QueryClient;
    hostClient?: RuntimeWorkspaceQueryHost;
    loadRepoConfig?: () => Promise<RepoConfig>;
    loadSettingsSnapshot?: () => Promise<SettingsSnapshot>;
  },
): Promise<RepoPromptOverrides> => {
  const queryClient = options?.queryClient ?? appQueryClient;
  const hostClient = options?.hostClient;
  const [repoConfig, snapshot] = await Promise.all([
    options?.loadRepoConfig
      ? options.loadRepoConfig()
      : loadRepoConfigFromQuery(queryClient, workspaceId, hostClient),
    options?.loadSettingsSnapshot
      ? options.loadSettingsSnapshot()
      : loadSettingsSnapshotFromQuery(queryClient, hostClient),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};

export const loadTaskWorktree = async (
  repoPath: string,
  taskId: string,
): Promise<TaskWorktreeSummary | null> => {
  return host.taskWorktreeGet(repoPath, taskId);
};

export const loadRepoDefaultRuntimeKind = async (
  workspaceId: string,
  role: AgentRole,
  loadRepoConfig: RepoConfigLoader = defaultRepoConfigLoader,
): Promise<RuntimeKind> => {
  const config = await loadRepoConfig(workspaceId);
  const roleDefault = config?.agentDefaults?.[role];
  return requireConfiguredRuntimeKind(
    roleDefault?.runtimeKind ?? config?.defaultRuntimeKind,
    `Runtime kind is not configured for ${role} sessions. Select a ${role} agent runtime or repository default runtime before starting a session.`,
  );
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

export const createEnsureExistingSessionRuntime = (
  hostClient: Pick<typeof host, "runtimeEnsure"> = host,
): EnsureExistingSessionRuntime => {
  return async (repoPath, runtimeKind): Promise<void> => {
    await hostClient.runtimeEnsure(repoPath, runtimeKind);
  };
};
