import { appQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";
import type { AgentOrchestratorDependencies } from "./orchestrator-ports";

export const createDefaultAgentOrchestratorDependencies = (): AgentOrchestratorDependencies => ({
  queryClient: appQueryClient,
  hostPort: {
    agentSessionUpsert: (repoPath, taskId, record) =>
      host.agentSessionUpsert(repoPath, taskId, record),
    agentSessionStop: async (target) => {
      await host.agentSessionStop(target);
    },
    taskWorktreeGet: (repoPath, taskId) => host.taskWorktreeGet(repoPath, taskId),
  },
  runtimeHostPort: {
    taskSessionBootstrapPrepare: (...args) => host.taskSessionBootstrapPrepare(...args),
    taskSessionBootstrapComplete: (...args) => host.taskSessionBootstrapComplete(...args),
    taskSessionBootstrapAbort: (...args) => host.taskSessionBootstrapAbort(...args),
  },
});
