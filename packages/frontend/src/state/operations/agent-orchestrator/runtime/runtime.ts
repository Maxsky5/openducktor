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
import { taskWorktreeQueryKeys } from "@/state/queries/build-runtime";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
import { host } from "../../shared/host";
import { runOrchestratorSideEffect } from "../support/async-side-effects";

export type RuntimeInfo = {
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  bootstrap?: {
    complete: () => Promise<void>;
    abort: () => Promise<void>;
  };
};

export type EnsureRuntimeOptions = {
  workspaceId?: string | null;
  targetWorkingDirectory?: string | null;
  runtimeKind?: RuntimeKind | null;
};

export type EnsureRuntime = (
  repoPath: string,
  taskId: string,
  role: AgentRole,
  options?: EnsureRuntimeOptions,
) => Promise<RuntimeInfo>;

export type EnsureExistingSessionRuntime = (
  repoPath: string,
  runtimeKind: RuntimeKind,
) => Promise<void>;

export type TaskDocuments = {
  specMarkdown: string;
  planMarkdown: string;
  qaMarkdown: string;
};

type EnsureRuntimeDependencies = {
  queryClient?: QueryClient;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  hostClient?: RuntimeStartupHost;
  repoConfigLoader?: RepoConfigLoader;
};

type RuntimeStartupHost = Pick<
  typeof host,
  "taskSessionBootstrapPrepare" | "taskSessionBootstrapComplete" | "taskSessionBootstrapAbort"
>;

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
): Promise<TaskDocuments> => {
  const [spec, plan, qa] = await Promise.all([
    host.specGet(repoPath, taskId).then((document) => document.markdown),
    host.planGet(repoPath, taskId).then((document) => document.markdown),
    host.qaGetReport(repoPath, taskId).then((document) => document.markdown),
  ]);

  return {
    specMarkdown: spec,
    planMarkdown: plan,
    qaMarkdown: qa,
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

  return {
    runtimeKind: roleDefault.runtimeKind,
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
    ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
    ...(roleDefault.profileId ? { profileId: roleDefault.profileId } : {}),
  };
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

export const createEnsureRuntime = ({
  refreshTaskData,
  hostClient = host,
  repoConfigLoader = defaultRepoConfigLoader,
  queryClient = appQueryClient,
}: EnsureRuntimeDependencies): EnsureRuntime => {
  return async (repoPath, taskId, role, options): Promise<RuntimeInfo> => {
    const targetWorkingDirectory = options?.targetWorkingDirectory?.trim() ?? "";
    const workspaceId = options?.workspaceId?.trim() ?? "";
    const explicitRuntimeKind = options?.runtimeKind;
    let runtimeKind: RuntimeKind;
    if (explicitRuntimeKind) {
      runtimeKind = requireConfiguredRuntimeKind(
        explicitRuntimeKind,
        `Runtime kind is required to start ${role} sessions.`,
      );
    } else {
      if (!workspaceId) {
        throw new Error("Active workspace is required to resolve the default runtime.");
      }
      runtimeKind = await loadRepoDefaultRuntimeKind(workspaceId, role, repoConfigLoader);
    }
    const prepareBootstrap = hostClient.taskSessionBootstrapPrepare;
    const completeBootstrap = hostClient.taskSessionBootstrapComplete;
    const abortBootstrap = hostClient.taskSessionBootstrapAbort;
    const bootstrap = await prepareBootstrap(
      repoPath,
      taskId,
      role,
      runtimeKind,
      targetWorkingDirectory || undefined,
    );
    return {
      runtimeKind,
      workingDirectory: bootstrap.workingDirectory,
      bootstrap: {
        complete: async () => {
          await completeBootstrap(repoPath, taskId, bootstrap.bootstrapId);
          await queryClient.invalidateQueries({
            queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
          });
          if (role === "build") {
            runOrchestratorSideEffect(
              "runtime-refresh-task-data-after-build-start",
              refreshTaskData(repoPath, taskId),
              { tags: { repoPath, taskId, role } },
            );
          }
        },
        abort: async () => {
          await abortBootstrap(repoPath, taskId, bootstrap.bootstrapId);
          await queryClient.invalidateQueries({
            queryKey: taskWorktreeQueryKeys.taskWorktree({ repoPath, taskId }),
          });
        },
      },
    };
  };
};

export const createEnsureExistingSessionRuntime = (
  hostClient: Pick<typeof host, "runtimeEnsure"> = host,
): EnsureExistingSessionRuntime => {
  return async (repoPath, runtimeKind): Promise<void> => {
    await hostClient.runtimeEnsure(repoPath, runtimeKind);
  };
};
