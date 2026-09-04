import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveRefreshInput,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionReadPort } from "@/state/queries/agent-sessions";
import type { host } from "../../shared/host";

export type AgentOrchestratorHostPort = AgentSessionReadPort & {
  taskMetadataGetFresh: typeof host.taskMetadataGetFresh;
  taskWorktreeGet: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
};

export type AgentOrchestratorRuntimeHostPort = {
  gitCanonicalizePath: typeof host.gitCanonicalizePath;
  runtimeEnsure: typeof host.runtimeEnsure;
  agentSessionWorkflowStart: typeof host.agentSessionWorkflowStart;
};

export type AgentOrchestratorLiveSessionHostPort = {
  agentSessionLiveLoadContext: typeof host.agentSessionLiveLoadContext;
  agentSessionLiveRead: typeof host.agentSessionLiveRead;
  agentSessionLiveReplyApproval: typeof host.agentSessionLiveReplyApproval;
  agentSessionLiveReplyQuestion: typeof host.agentSessionLiveReplyQuestion;
  observeAgentSessionLive: (
    input: AgentSessionLiveRefreshInput,
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
  runtimeHostPort: AgentOrchestratorRuntimeHostPort;
  liveSessionHostPort: AgentOrchestratorLiveSessionHostPort;
};
