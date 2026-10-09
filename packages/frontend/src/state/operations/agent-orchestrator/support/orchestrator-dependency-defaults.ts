import { observeAgentSessionLive } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";
import type { AgentOrchestratorDependencies } from "./orchestrator-ports";

export const createDefaultAgentOrchestratorDependencies = (): AgentOrchestratorDependencies => ({
  queryClient: appQueryClient,
  hostPort: {
    agentSessionsListForTasks: (repoPath, taskIds) =>
      host.agentSessionsListForTasks(repoPath, taskIds),
    taskMetadataGet: (repoPath, taskId) => host.taskMetadataGet(repoPath, taskId),
    taskWorktreeGet: (repoPath, taskId) => host.taskWorktreeGet(repoPath, taskId),
  },
  liveSessionHostPort: {
    agentSessionLiveLoadContext: (...args) => host.agentSessionLiveLoadContext(...args),
    agentSessionLiveRead: (...args) => host.agentSessionLiveRead(...args),
    agentSessionLiveReplyApproval: (...args) => host.agentSessionLiveReplyApproval(...args),
    agentSessionLiveReplyQuestion: (...args) => host.agentSessionLiveReplyQuestion(...args),
    observeAgentSessionLive,
  },
});
