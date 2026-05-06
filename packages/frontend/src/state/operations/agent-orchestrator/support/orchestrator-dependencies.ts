import type {
  AgentSessionRecord,
  AgentSessionStopTarget,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { appQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";

export type AgentOrchestratorHostPort = {
  buildStart: typeof host.buildStart;
  runtimeEnsure: typeof host.runtimeEnsure;
  agentSessionUpsert: (
    repoPath: string,
    taskId: string,
    record: AgentSessionRecord,
  ) => Promise<void>;
  agentSessionStop: (target: AgentSessionStopTarget) => Promise<void>;
  taskWorktreeGet: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
};

export const createDefaultAgentOrchestratorDependencies = (): AgentOrchestratorDependencies => ({
  queryClient: appQueryClient,
  hostPort: {
    buildStart: (...args) => host.buildStart(...args),
    runtimeEnsure: (...args) => host.runtimeEnsure(...args),
    agentSessionUpsert: (repoPath, taskId, record) =>
      host.agentSessionUpsert(repoPath, taskId, record),
    agentSessionStop: async (target) => {
      await host.agentSessionStop(target);
    },
    taskWorktreeGet: (repoPath, taskId) => host.taskWorktreeGet(repoPath, taskId),
  },
});
