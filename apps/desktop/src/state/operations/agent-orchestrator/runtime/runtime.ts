import type {
  BuildContinuationTarget,
  GitTargetBranch,
  RepoConfig,
  RepoPromptOverrides,
  RunSummary,
  RuntimeKind,
  RuntimeRoute,
} from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentRuntimeConnection } from "@openducktor/core";
import { mergePromptOverrides } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { appQueryClient } from "@/lib/query-client";
import { loadRepoConfigFromQuery, loadSettingsSnapshotFromQuery } from "@/state/queries/workspace";
import { host } from "../../shared/host";
import { MISSING_BUILD_TARGET_ERROR } from "../handlers/start-session-constants";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { normalizeWorkingDirectory, runningStates, toBaseUrl } from "../support/core";

export type RuntimeInfo = {
  runtimeKind?: RuntimeKind;
  kind?: string;
  runtimeId: string | null;
  runId: string | null;
  runtimeConnection?: AgentRuntimeConnection;
  runtimeEndpoint: string;
  workingDirectory: string;
};

const toRuntimeConnection = (
  runtimeEndpoint: string,
  workingDirectory: string,
): AgentRuntimeConnection => ({
  endpoint: runtimeEndpoint,
  workingDirectory,
});

const resolveRuntimeEndpoint = (runtimeRoute: RuntimeRoute): string => {
  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
  }
};

export const resolveRuntimeRouteConnection = (
  runtimeRoute: RuntimeRoute,
  workingDirectory: string,
): { runtimeEndpoint: string; runtimeConnection: AgentRuntimeConnection } => {
  const runtimeEndpoint = resolveRuntimeEndpoint(runtimeRoute);
  return {
    runtimeEndpoint,
    runtimeConnection: toRuntimeConnection(runtimeEndpoint, workingDirectory),
  };
};

export const resolveRuntimeConnection = (runtime: RuntimeInfo): AgentRuntimeConnection => {
  return (
    runtime.runtimeConnection ??
    toRuntimeConnection(runtime.runtimeEndpoint, runtime.workingDirectory)
  );
};

export type TaskDocuments = {
  specMarkdown: string;
  planMarkdown: string;
  qaMarkdown: string;
};

type EnsureRuntimeDependencies = {
  runsRef: { current: RunSummary[] };
  refreshTaskData: (repoPath: string, taskId?: string) => Promise<void>;
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

const loadRepoConfig = (repoPath: string): Promise<RepoConfig> => {
  return loadRepoConfigFromQuery(appQueryClient, repoPath);
};

export const loadRepoDefaultTargetBranch = async (
  repoPath: string,
): Promise<GitTargetBranch | null> => {
  const config = await loadRepoConfig(repoPath);
  return config.defaultTargetBranch ?? null;
};

export const loadRepoDefaultModel = async (
  repoPath: string,
  role: AgentRole,
): Promise<AgentModelSelection | null> => {
  const config = await loadRepoConfig(repoPath);
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

export const loadRepoPromptOverrides = async (repoPath: string): Promise<RepoPromptOverrides> => {
  const [repoConfig, snapshot] = await Promise.all([
    loadRepoConfig(repoPath),
    loadSettingsSnapshotFromQuery(appQueryClient),
  ]);

  return mergePromptOverrides({
    globalOverrides: snapshot.globalPromptOverrides,
    repoOverrides: repoConfig.promptOverrides,
  });
};

export const loadBuildContinuationTarget = async (
  repoPath: string,
  taskId: string,
): Promise<BuildContinuationTarget | null> => {
  return host.buildContinuationTargetGet(repoPath, taskId);
};

export const loadRepoDefaultRuntimeKind = async (
  repoPath: string,
  role: AgentRole,
): Promise<RuntimeKind> => {
  const config = await loadRepoConfig(repoPath);
  const roleDefault = config?.agentDefaults?.[role];
  return roleDefault?.runtimeKind ?? config?.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND;
};

export const createEnsureRuntime = ({ runsRef, refreshTaskData }: EnsureRuntimeDependencies) => {
  return async (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      targetWorkingDirectory?: string | null;
      runtimeKind?: RuntimeKind | null;
    },
  ): Promise<RuntimeInfo> => {
    const targetWorkingDirectory = options?.targetWorkingDirectory?.trim() ?? "";
    const normalizedTargetWorkingDirectory = normalizeWorkingDirectory(targetWorkingDirectory);
    const runtimeKind = options?.runtimeKind?.trim()
      ? options.runtimeKind
      : await loadRepoDefaultRuntimeKind(repoPath, role);

    if (role === "build") {
      if (targetWorkingDirectory) {
        const matchingRun = runsRef.current.find(
          (entry) =>
            entry.repoPath === repoPath &&
            entry.taskId === taskId &&
            runningStates.has(entry.state) &&
            normalizeWorkingDirectory(entry.worktreePath) === normalizedTargetWorkingDirectory,
        );
        if (matchingRun) {
          const runtimeEndpoint = toBaseUrl(matchingRun.port);
          return {
            runtimeKind,
            runtimeId: null,
            runId: matchingRun.runId,
            runtimeConnection: toRuntimeConnection(runtimeEndpoint, matchingRun.worktreePath),
            runtimeEndpoint,
            workingDirectory: matchingRun.worktreePath,
          };
        }

        const taskRun = runsRef.current.find(
          (entry) =>
            entry.repoPath === repoPath &&
            entry.taskId === taskId &&
            runningStates.has(entry.state),
        );
        if (taskRun && normalizedTargetWorkingDirectory === normalizeWorkingDirectory(repoPath)) {
          const runtimeEndpoint = toBaseUrl(taskRun.port);
          return {
            runtimeKind,
            runtimeId: null,
            runId: taskRun.runId,
            runtimeConnection: toRuntimeConnection(runtimeEndpoint, taskRun.worktreePath),
            runtimeEndpoint,
            workingDirectory: taskRun.worktreePath,
          };
        }

        const runtime = await host.runtimeEnsure(repoPath, runtimeKind);
        const { runtimeEndpoint, runtimeConnection } = resolveRuntimeRouteConnection(
          runtime.runtimeRoute,
          targetWorkingDirectory,
        );
        return {
          runtimeKind,
          runtimeId: runtime.runtimeId,
          runId: null,
          runtimeConnection,
          runtimeEndpoint,
          workingDirectory: targetWorkingDirectory,
        };
      }

      let run = runsRef.current.find(
        (entry) =>
          entry.repoPath === repoPath && entry.taskId === taskId && runningStates.has(entry.state),
      );
      if (!run) {
        run = await host.buildStart(repoPath, taskId, runtimeKind);
        runOrchestratorSideEffect(
          "runtime-refresh-task-data-after-build-start",
          refreshTaskData(repoPath),
          {
            tags: { repoPath, taskId, role },
          },
        );
      }
      const runtimeEndpoint = toBaseUrl(run.port);
      return {
        runtimeKind,
        runtimeId: null,
        runId: run.runId,
        runtimeConnection: toRuntimeConnection(runtimeEndpoint, run.worktreePath),
        runtimeEndpoint,
        workingDirectory: run.worktreePath,
      };
    }

    if (role === "qa") {
      const continuationTarget =
        targetWorkingDirectory.length === 0
          ? await host.buildContinuationTargetGet(repoPath, taskId)
          : null;
      const workingDirectory = targetWorkingDirectory || continuationTarget?.workingDirectory;
      if (!workingDirectory) {
        throw new Error(MISSING_BUILD_TARGET_ERROR);
      }
      const normalizedWorkingDirectory = normalizeWorkingDirectory(workingDirectory);
      const matchingRun = runsRef.current.find(
        (entry) =>
          entry.repoPath === repoPath &&
          entry.taskId === taskId &&
          runningStates.has(entry.state) &&
          normalizeWorkingDirectory(entry.worktreePath) === normalizedWorkingDirectory,
      );
      if (matchingRun) {
        const runtimeEndpoint = toBaseUrl(matchingRun.port);
        return {
          runtimeKind,
          runtimeId: null,
          runId: matchingRun.runId,
          runtimeConnection: toRuntimeConnection(runtimeEndpoint, matchingRun.worktreePath),
          runtimeEndpoint,
          workingDirectory: matchingRun.worktreePath,
        };
      }

      const runtime = await host.runtimeEnsure(repoPath, runtimeKind);
      const { runtimeEndpoint, runtimeConnection } = resolveRuntimeRouteConnection(
        runtime.runtimeRoute,
        workingDirectory,
      );
      return {
        runtimeKind,
        runtimeId: runtime.runtimeId,
        runId: null,
        runtimeConnection,
        runtimeEndpoint,
        workingDirectory,
      };
    }

    const runtime = await host.runtimeEnsure(repoPath, runtimeKind);
    const workingDirectory = targetWorkingDirectory || runtime.workingDirectory;
    const { runtimeEndpoint, runtimeConnection } = resolveRuntimeRouteConnection(
      runtime.runtimeRoute,
      workingDirectory,
    );
    return {
      runtimeKind,
      runtimeId: runtime.runtimeId,
      runId: null,
      runtimeConnection,
      runtimeEndpoint,
      workingDirectory,
    };
  };
};
