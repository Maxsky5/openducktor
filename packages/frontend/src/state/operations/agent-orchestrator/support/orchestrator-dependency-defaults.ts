import { appQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";
import type { AgentOrchestratorDependencies } from "./orchestrator-ports";

export const createDefaultAgentOrchestratorDependencies = (): AgentOrchestratorDependencies => ({
  queryClient: appQueryClient,
  hostPort: {
    agentSessionDelete: (repoPath, taskId, identity) =>
      host.agentSessionDelete(repoPath, taskId, identity),
    agentSessionsList: (repoPath, taskId) => host.agentSessionsList(repoPath, taskId),
    agentSessionsListForTasks: (repoPath, taskIds) =>
      host.agentSessionsListForTasks(repoPath, taskIds),
    agentSessionUpsert: (repoPath, taskId, record) =>
      host.agentSessionUpsert(repoPath, taskId, record),
    agentSessionStop: async (target) => {
      await host.agentSessionStop(target);
    },
    taskWorktreeGet: (repoPath, taskId) => host.taskWorktreeGet(repoPath, taskId),
  },
  runtimeHostPort: {
    gitCanonicalizePath: (...args) => host.gitCanonicalizePath(...args),
    runtimeEnsure: (...args) => host.runtimeEnsure(...args),
    taskSessionBootstrapPrepare: (...args) => host.taskSessionBootstrapPrepare(...args),
    taskSessionBootstrapComplete: (...args) => host.taskSessionBootstrapComplete(...args),
    taskSessionBootstrapAbort: (...args) => host.taskSessionBootstrapAbort(...args),
    taskSessionStartupLeasePrepare: (...args) => host.taskSessionStartupLeasePrepare(...args),
    taskSessionStartupLeaseComplete: (...args) => host.taskSessionStartupLeaseComplete(...args),
    taskSessionStartupLeaseAbort: (...args) => host.taskSessionStartupLeaseAbort(...args),
  },
});
