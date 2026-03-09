import type {
  QaReviewTarget,
  RepoPromptOverrides,
  RunSummary,
  RuntimeKind,
  RuntimeRoute,
} from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole, AgentRuntimeConnection } from "@openducktor/core";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { host } from "../../host";
import { loadEffectivePromptOverrides } from "../../prompt-overrides";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { runningStates, toBaseUrl } from "../support/utils";

export type RuntimeInfo = {
  runtimeKind?: RuntimeKind;
  kind?: string;
  runtimeId: string | null;
  runId: string | null;
  runtimeConnection?: AgentRuntimeConnection;
  runtimeEndpoint: string;
  workingDirectory: string;
};

export const toRuntimeConnection = (
  runtimeEndpoint: string,
  workingDirectory: string,
): AgentRuntimeConnection => ({
  endpoint: runtimeEndpoint,
  workingDirectory,
});

const normalizeWorkingDirectory = (workingDirectory: string | null | undefined): string => {
  let normalized = workingDirectory?.trim() ?? "";
  while (normalized.length > 1 && /[\\/]/.test(normalized.at(-1) ?? "")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
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
  refreshTaskData: (repoPath: string) => Promise<void>;
};

export const loadTaskDocuments = async (
  repoPath: string,
  taskId: string,
): Promise<TaskDocuments> => {
  const [spec, plan, qa] = await Promise.all([
    host.specGet(repoPath, taskId).then((spec) => spec.markdown),
    host.planGet(repoPath, taskId).then((plan) => plan.markdown),
    host.qaGetReport(repoPath, taskId).then((qa) => qa.markdown),
  ]);

  return {
    specMarkdown: spec,
    planMarkdown: plan,
    qaMarkdown: qa,
  };
};

export const loadRepoDefaultModel = async (
  repoPath: string,
  role: AgentRole,
): Promise<AgentModelSelection | null> => {
  const config = await host.workspaceGetRepoConfig(repoPath);
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
  return loadEffectivePromptOverrides(repoPath);
};

export const loadQaReviewTarget = async (
  repoPath: string,
  taskId: string,
): Promise<QaReviewTarget> => {
  return host.qaReviewTargetGet(repoPath, taskId);
};

export const loadRepoDefaultRuntimeKind = async (
  repoPath: string,
  role: AgentRole,
): Promise<RuntimeKind> => {
  const config = await host.workspaceGetRepoConfig(repoPath);
  const roleDefault = config?.agentDefaults?.[role];
  return roleDefault?.runtimeKind ?? config?.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND;
};

export const createEnsureRuntime = ({ runsRef, refreshTaskData }: EnsureRuntimeDependencies) => {
  return async (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      workingDirectoryOverride?: string | null;
      runtimeKind?: RuntimeKind | null;
    },
  ): Promise<RuntimeInfo> => {
    const workingDirectoryOverride = options?.workingDirectoryOverride?.trim() ?? "";
    const normalizedWorkingDirectoryOverride = normalizeWorkingDirectory(workingDirectoryOverride);
    const runtimeKind = options?.runtimeKind?.trim()
      ? options.runtimeKind
      : await loadRepoDefaultRuntimeKind(repoPath, role);

    if (role === "build") {
      if (workingDirectoryOverride) {
        const matchingRun = runsRef.current.find(
          (entry) =>
            entry.repoPath === repoPath &&
            entry.taskId === taskId &&
            runningStates.has(entry.state) &&
            normalizeWorkingDirectory(entry.worktreePath) === normalizedWorkingDirectoryOverride,
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
        if (taskRun && normalizedWorkingDirectoryOverride === normalizeWorkingDirectory(repoPath)) {
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

        const runtime = await host.runtimeEnsure(runtimeKind, repoPath);
        const runtimeEndpoint = resolveRuntimeEndpoint(runtime.runtimeRoute);
        return {
          runtimeKind,
          runtimeId: runtime.runtimeId,
          runId: null,
          runtimeConnection: toRuntimeConnection(runtimeEndpoint, workingDirectoryOverride),
          runtimeEndpoint,
          workingDirectory: workingDirectoryOverride,
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
      const workingDirectory =
        workingDirectoryOverride || (await host.qaReviewTargetGet(repoPath, taskId)).workingDirectory;
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

      const runtime = await host.runtimeEnsure(runtimeKind, repoPath);
      const runtimeEndpoint = resolveRuntimeEndpoint(runtime.runtimeRoute);
      return {
        runtimeKind,
        runtimeId: runtime.runtimeId,
        runId: null,
        runtimeConnection: toRuntimeConnection(runtimeEndpoint, workingDirectory),
        runtimeEndpoint,
        workingDirectory,
      };
    }

    const runtime = await host.runtimeEnsure(runtimeKind, repoPath);
    const workingDirectory = workingDirectoryOverride || runtime.workingDirectory;
    const runtimeEndpoint = resolveRuntimeEndpoint(runtime.runtimeRoute);
    return {
      runtimeKind,
      runtimeId: runtime.runtimeId,
      runId: null,
      runtimeConnection: toRuntimeConnection(runtimeEndpoint, workingDirectory),
      runtimeEndpoint,
      workingDirectory,
    };
  };
};

const resolveRuntimeEndpoint = (runtimeRoute: RuntimeRoute): string => {
  switch (runtimeRoute.type) {
    case "local_http":
      return runtimeRoute.endpoint;
  }
};
