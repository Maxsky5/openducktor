import { observeAgentSessionLive } from "@/lib/host-client";
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
    taskMetadataGetFresh: (repoPath, taskId) => host.taskMetadataGetFresh(repoPath, taskId),
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
  liveSessionHostPort: {
    agentSessionLiveLoadContext: (...args) => host.agentSessionLiveLoadContext(...args),
    agentSessionLiveRead: (...args) => host.agentSessionLiveRead(...args),
    agentSessionLiveReplyApproval: (...args) => host.agentSessionLiveReplyApproval(...args),
    agentSessionLiveReplyQuestion: (...args) => host.agentSessionLiveReplyQuestion(...args),
    observeAgentSessionLive,
  },
});
