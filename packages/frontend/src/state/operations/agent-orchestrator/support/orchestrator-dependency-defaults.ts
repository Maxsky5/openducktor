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
    buildStart: (...args) => host.buildStart(...args),
    runtimeEnsure: (...args) => host.runtimeEnsure(...args),
  },
});
