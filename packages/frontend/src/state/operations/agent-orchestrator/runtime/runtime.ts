import type {
  BuildSessionBootstrap,
  GitTargetBranch,
  RepoConfig,
  RepoPromptOverrides,
  RuntimeKind,
  RuntimeRoute,
  SettingsSnapshot,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import {
  type AgentModelSelection,
  type AgentRole,
  type AgentRuntimeConnection,
  mergePromptOverrides,
  requireRuntimeConnection,
} from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
import { host } from "../../shared/host";
import { ensureRuntimeAndInvalidateReadinessQueries } from "../../shared/runtime-readiness-publication";
import { MISSING_BUILD_TARGET_ERROR } from "../handlers/start-session-constants";
import { runOrchestratorSideEffect } from "../support/async-side-effects";

export type RuntimeInfo = {
  runtimeKind?: RuntimeKind;
  kind?: string;
  runtimeId: string | null;
  runtimeConnection?: AgentRuntimeConnection;
  runtimeRoute: RuntimeRoute | null;
  workingDirectory: string;
};

export const runtimeConnectionToRoute = (
  runtimeConnection: AgentRuntimeConnection,
): RuntimeRoute => {
  switch (runtimeConnection.type) {
    case "local_http":
      return {
        type: "local_http",
        endpoint: runtimeConnection.endpoint,
      };
    case "stdio":
      return {
        type: "stdio",
      };
  }
};

export const runtimeRouteToConnection = (
  runtimeRoute: RuntimeRoute,
  workingDirectory: string,
): AgentRuntimeConnection => {
  switch (runtimeRoute.type) {
    case "local_http":
      return {
        type: "local_http",
        endpoint: runtimeRoute.endpoint,
        workingDirectory,
      };
    case "stdio":
      return {
        type: "stdio",
        workingDirectory,
      };
  }
};

export const resolveRuntimeRouteConnection = (
  runtimeRoute: RuntimeRoute,
  workingDirectory: string,
): { runtimeConnection: AgentRuntimeConnection } => {
  return {
    runtimeConnection: runtimeRouteToConnection(runtimeRoute, workingDirectory),
  };
};

export const runtimeRouteTransportKey = (runtimeRoute: RuntimeRoute | null | undefined): string => {
  if (!runtimeRoute) {
    return "unavailable";
  }

  switch (runtimeRoute.type) {
    case "local_http":
      return `local_http:${runtimeRoute.endpoint.trim()}`;
    case "stdio":
      return "stdio";
  }
};

export const runtimeConnectionTransportKey = (
  runtimeConnection: AgentRuntimeConnection,
): string => {
  switch (runtimeConnection.type) {
    case "local_http":
      return `local_http:${runtimeConnection.endpoint.trim()}`;
    case "stdio":
      return "stdio";
  }
};

export const getRuntimeConnectionSupportError = (
  runtimeKind: RuntimeKind | null | undefined,
  runtimeConnection: AgentRuntimeConnection | null | undefined,
  action: string,
): string | null => {
  if (!runtimeKind || !runtimeConnection) {
    return null;
  }
  if (runtimeKind !== "opencode" || runtimeConnection.type === "local_http") {
    return null;
  }
  return `Runtime connection type '${runtimeConnection.type}' is unsupported for ${action} in runtime '${runtimeKind}'; local_http is required.`;
};

export const requireRuntimeConnectionSupport = (
  runtimeKind: RuntimeKind | null | undefined,
  runtimeConnection: AgentRuntimeConnection,
  action: string,
): AgentRuntimeConnection => {
  const error = getRuntimeConnectionSupportError(runtimeKind, runtimeConnection, action);
  if (error) {
    throw new Error(error);
  }
  return runtimeConnection;
};

export const describeRuntimeRoute = (runtimeRoute: RuntimeRoute | null | undefined): string => {
  if (!runtimeRoute) {
    return "unavailable";
  }

  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
    case "stdio":
      return "stdio";
  }
};

export const resolveRuntimeRoute = (runtime: RuntimeInfo): RuntimeRoute => {
  if (runtime.runtimeRoute) {
    return runtime.runtimeRoute;
  }

  return runtimeConnectionToRoute(
    requireRuntimeConnection(runtime.runtimeConnection, "resolve runtime route"),
  );
};

export const resolveRuntimeConnection = (runtime: RuntimeInfo): AgentRuntimeConnection => {
  return (
    runtime.runtimeConnection ??
    runtimeRouteToConnection(resolveRuntimeRoute(runtime), runtime.workingDirectory)
  );
};

export type TaskDocuments = {
  specMarkdown: string;
  planMarkdown: string;
  qaMarkdown: string;
};

type EnsureRuntimeDependencies = {
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
};

type RuntimeWorkspaceQueryHost = Pick<
  typeof host,
  "workspaceGetRepoConfig" | "workspaceGetSettingsSnapshot"
>;

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

const loadRepoConfig = (workspaceId: string): Promise<RepoConfig> => {
  return loadRepoConfigFromQuery(appQueryClient, workspaceId);
};

export const loadRepoDefaultTargetBranch = async (
  workspaceId: string,
): Promise<GitTargetBranch | null> => {
  const config = await loadRepoConfig(workspaceId);
  return config.defaultTargetBranch ?? null;
};

export const loadRepoDefaultModel = async (
  workspaceId: string,
  role: AgentRole,
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
): Promise<RuntimeKind> => {
  const config = await loadRepoConfig(workspaceId);
  const roleDefault = config?.agentDefaults?.[role];
  return roleDefault?.runtimeKind ?? config?.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND;
};

export const createEnsureRuntime = ({ refreshTaskData }: EnsureRuntimeDependencies) => {
  return async (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      workspaceId?: string | null;
      targetWorkingDirectory?: string | null;
      runtimeKind?: RuntimeKind | null;
    },
  ): Promise<RuntimeInfo> => {
    const targetWorkingDirectory = options?.targetWorkingDirectory?.trim() ?? "";
    const workspaceId = options?.workspaceId?.trim() ?? "";
    const runtimeKind = options?.runtimeKind?.trim()
      ? options.runtimeKind
      : workspaceId
        ? await loadRepoDefaultRuntimeKind(workspaceId, role)
        : (() => {
            throw new Error("Active workspace is required to resolve the default runtime.");
          })();
    const toRuntimeInfo = (input: {
      runtimeId: string | null;
      runtimeRoute: RuntimeRoute;
      runtimeConnection: AgentRuntimeConnection;
      workingDirectory: string;
    }): RuntimeInfo => ({
      runtimeKind,
      runtimeId: input.runtimeId,
      runtimeRoute: input.runtimeRoute,
      runtimeConnection: requireRuntimeConnectionSupport(
        runtimeKind,
        input.runtimeConnection,
        `${role} sessions`,
      ),
      workingDirectory: input.workingDirectory,
    });

    if (role === "build") {
      if (targetWorkingDirectory) {
        const runtime = await ensureRuntimeAndInvalidateReadinessQueries({
          repoPath,
          runtimeKind,
          ensureRuntime: (nextRepoPath, nextRuntimeKind) =>
            host.runtimeEnsure(nextRepoPath, nextRuntimeKind),
        });
        const { runtimeConnection } = resolveRuntimeRouteConnection(
          runtime.runtimeRoute,
          targetWorkingDirectory,
        );
        return toRuntimeInfo({
          runtimeId: runtime.runtimeId,
          runtimeRoute: runtime.runtimeRoute,
          runtimeConnection,
          workingDirectory: targetWorkingDirectory,
        });
      }

      const bootstrap: BuildSessionBootstrap = await host.buildStart(repoPath, taskId, runtimeKind);
      runOrchestratorSideEffect(
        "runtime-refresh-task-data-after-build-start",
        refreshTaskData(repoPath),
        {
          tags: { repoPath, taskId, role },
        },
      );
      const { runtimeConnection } = resolveRuntimeRouteConnection(
        bootstrap.runtimeRoute,
        bootstrap.workingDirectory,
      );
      return toRuntimeInfo({
        runtimeId: null,
        runtimeRoute: bootstrap.runtimeRoute,
        runtimeConnection,
        workingDirectory: bootstrap.workingDirectory,
      });
    }

    if (role === "qa") {
      const continuationTarget =
        targetWorkingDirectory.length === 0 ? await host.taskWorktreeGet(repoPath, taskId) : null;
      const workingDirectory = targetWorkingDirectory || continuationTarget?.workingDirectory;
      if (!workingDirectory) {
        throw new Error(MISSING_BUILD_TARGET_ERROR);
      }
      const runtime = await ensureRuntimeAndInvalidateReadinessQueries({
        repoPath,
        runtimeKind,
        ensureRuntime: (nextRepoPath, nextRuntimeKind) =>
          host.runtimeEnsure(nextRepoPath, nextRuntimeKind),
      });
      const { runtimeConnection } = resolveRuntimeRouteConnection(
        runtime.runtimeRoute,
        workingDirectory,
      );
      return toRuntimeInfo({
        runtimeId: runtime.runtimeId,
        runtimeRoute: runtime.runtimeRoute,
        runtimeConnection,
        workingDirectory,
      });
    }

    const runtime = await ensureRuntimeAndInvalidateReadinessQueries({
      repoPath,
      runtimeKind,
      ensureRuntime: (nextRepoPath, nextRuntimeKind) =>
        host.runtimeEnsure(nextRepoPath, nextRuntimeKind),
    });
    const workingDirectory = targetWorkingDirectory || runtime.workingDirectory;
    const { runtimeConnection } = resolveRuntimeRouteConnection(
      runtime.runtimeRoute,
      workingDirectory,
    );
    return toRuntimeInfo({
      runtimeId: runtime.runtimeId,
      runtimeRoute: runtime.runtimeRoute,
      runtimeConnection,
      workingDirectory,
    });
  };
};
