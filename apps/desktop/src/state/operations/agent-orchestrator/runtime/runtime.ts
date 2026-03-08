import type { RepoPromptOverrides, RunSummary, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
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
  runtimeEndpoint: string;
  workingDirectory: string;
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

const loadRepoDefaultRuntimeKind = async (
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
            entry.worktreePath === workingDirectoryOverride,
        );
        if (matchingRun) {
          return {
            runtimeKind,
            runtimeId: null,
            runId: matchingRun.runId,
            runtimeEndpoint: toBaseUrl(matchingRun.port),
            workingDirectory: workingDirectoryOverride,
          };
        }

        const taskRun = runsRef.current.find(
          (entry) =>
            entry.repoPath === repoPath &&
            entry.taskId === taskId &&
            runningStates.has(entry.state),
        );
        if (taskRun && workingDirectoryOverride === repoPath) {
          return {
            runtimeKind,
            runtimeId: null,
            runId: taskRun.runId,
            runtimeEndpoint: toBaseUrl(taskRun.port),
            workingDirectory: taskRun.worktreePath,
          };
        }

        const runtime = await host.runtimeEnsure(runtimeKind, repoPath);
        return {
          runtimeKind,
          runtimeId: runtime.runtimeId,
          runId: null,
          runtimeEndpoint: resolveRuntimeEndpoint(runtime),
          workingDirectory: workingDirectoryOverride,
        };
      }

      let run = runsRef.current.find(
        (entry) =>
          entry.repoPath === repoPath && entry.taskId === taskId && runningStates.has(entry.state),
      );
      if (!run) {
        run = await host.buildStart(repoPath, taskId);
        runOrchestratorSideEffect(
          "runtime-refresh-task-data-after-build-start",
          refreshTaskData(repoPath),
          {
            tags: { repoPath, taskId, role },
          },
        );
      }
      return {
        runtimeKind,
        runtimeId: null,
        runId: run.runId,
        runtimeEndpoint: toBaseUrl(run.port),
        workingDirectory: run.worktreePath,
      };
    }

    if (role === "qa") {
      const runtime = await host.runtimeStart(runtimeKind, repoPath, taskId, "qa");
      return {
        runtimeKind,
        runtimeId: runtime.runtimeId,
        runId: null,
        runtimeEndpoint: resolveRuntimeEndpoint(runtime),
        workingDirectory: workingDirectoryOverride || runtime.workingDirectory,
      };
    }

    const runtime = await host.runtimeEnsure(runtimeKind, repoPath);
    return {
      runtimeKind,
      runtimeId: runtime.runtimeId,
      runId: null,
      runtimeEndpoint: resolveRuntimeEndpoint(runtime),
      workingDirectory: workingDirectoryOverride || runtime.workingDirectory,
    };
  };
};

const resolveRuntimeEndpoint = (runtime: {
  endpoint?: string | null | undefined;
  port?: number | undefined;
}): string => {
  if (runtime.endpoint?.trim()) {
    return runtime.endpoint;
  }
  if (typeof runtime.port === "number") {
    return toBaseUrl(runtime.port);
  }
  throw new Error("Runtime endpoint is missing from the runtime summary.");
};
