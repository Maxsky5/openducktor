import type { RunSummary } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { host } from "../../host";
import {
  captureOrchestratorFallback,
  runOrchestratorSideEffect,
} from "../support/async-side-effects";
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
    captureOrchestratorFallback(
      "runtime-load-task-document",
      async () => {
        const spec = await host.specGet(repoPath, taskId);
        return spec.markdown;
      },
      {
        tags: { repoPath, taskId, document: "spec" },
        logLevel: "warn",
        fallback: () => "",
      },
    ),
    captureOrchestratorFallback(
      "runtime-load-task-document",
      async () => {
        const plan = await host.planGet(repoPath, taskId);
        return plan.markdown;
      },
      {
        tags: { repoPath, taskId, document: "plan" },
        logLevel: "warn",
        fallback: () => "",
      },
    ),
    captureOrchestratorFallback(
      "runtime-load-task-document",
      async () => {
        const qa = await host.qaGetReport(repoPath, taskId);
        return qa.markdown;
      },
      {
        tags: { repoPath, taskId, document: "qa" },
        logLevel: "warn",
        fallback: () => "",
      },
    ),
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
  const config = await captureOrchestratorFallback(
    "runtime-load-repo-config",
    async () => host.workspaceGetRepoConfig(repoPath),
    {
      tags: { repoPath, role },
      logLevel: "warn",
      fallback: () => null,
    },
  );
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

export const createEnsureRuntime = ({ runsRef, refreshTaskData }: EnsureRuntimeDependencies) => {
  return async (repoPath: string, taskId: string, role: AgentRole): Promise<RuntimeInfo> => {
    if (role === "build") {
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
        workingDirectory: runtime.workingDirectory,
      };
    }

    const runtime = await host.opencodeRepoRuntimeEnsure(repoPath);
    return {
      runtimeId: runtime.runtimeId,
      runId: null,
      baseUrl: toBaseUrl(runtime.port),
      workingDirectory: runtime.workingDirectory,
    };
  };
};
