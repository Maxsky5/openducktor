import type { RepoPromptOverrides, RunSummary } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { host } from "../../host";
import { loadEffectivePromptOverrides } from "../../prompt-overrides";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { runningStates, toBaseUrl } from "../support/utils";

export type RuntimeInfo = {
  runtimeId: string | null;
  runId: string | null;
  baseUrl: string;
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
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
    ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
    ...(roleDefault.opencodeAgent ? { opencodeAgent: roleDefault.opencodeAgent } : {}),
  };
};

export const loadRepoPromptOverrides = async (repoPath: string): Promise<RepoPromptOverrides> => {
  return loadEffectivePromptOverrides(repoPath);
};

export const createEnsureRuntime = ({ runsRef, refreshTaskData }: EnsureRuntimeDependencies) => {
  return async (
    repoPath: string,
    taskId: string,
    role: AgentRole,
    options?: {
      workingDirectoryOverride?: string | null;
    },
  ): Promise<RuntimeInfo> => {
    const workingDirectoryOverride = options?.workingDirectoryOverride?.trim() ?? "";

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
            runtimeId: null,
            runId: matchingRun.runId,
            baseUrl: toBaseUrl(matchingRun.port),
            workingDirectory: workingDirectoryOverride,
          };
        }

        const runtime = await host.opencodeRepoRuntimeEnsure(repoPath);
        return {
          runtimeId: runtime.runtimeId,
          runId: null,
          baseUrl: toBaseUrl(runtime.port),
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
        runtimeId: null,
        runId: run.runId,
        baseUrl: toBaseUrl(run.port),
        workingDirectory: run.worktreePath,
      };
    }

    if (role === "qa") {
      const runtime = await host.opencodeRuntimeStart(repoPath, taskId, "qa");
      return {
        runtimeId: runtime.runtimeId,
        runId: null,
        baseUrl: toBaseUrl(runtime.port),
        workingDirectory: workingDirectoryOverride || runtime.workingDirectory,
      };
    }

    const runtime = await host.opencodeRepoRuntimeEnsure(repoPath);
    return {
      runtimeId: runtime.runtimeId,
      runId: null,
      baseUrl: toBaseUrl(runtime.port),
      workingDirectory: workingDirectoryOverride || runtime.workingDirectory,
    };
  };
};
