import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveAttachInput,
  TaskWorktreeSummary,
} from "@openducktor/contracts";
import type { QueryClient } from "@tanstack/react-query";
import type { AgentSessionReadPort } from "../../../queries/agent-sessions";
import type { HostClient } from "@openducktor/host-client";

export type AgentOrchestratorHostPort = AgentSessionReadPort & {
  taskMetadataGet: HostClient["taskMetadataGet"];
  taskWorktreeGet: (repoPath: string, taskId: string) => Promise<TaskWorktreeSummary | null>;
};

export type AgentOrchestratorLiveSessionHostPort = {
  agentSessionLiveLoadContext: HostClient["agentSessionLiveLoadContext"];
  agentSessionLiveRead: HostClient["agentSessionLiveRead"];
  agentSessionLiveReplyApproval: HostClient["agentSessionLiveReplyApproval"];
  agentSessionLiveReplyQuestion: HostClient["agentSessionLiveReplyQuestion"];
  observeAgentSessionLive: (
    input: AgentSessionLiveAttachInput,
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ) => Promise<() => void>;
};

export type AgentOrchestratorDependencies = {
  queryClient: QueryClient;
  hostPort: AgentOrchestratorHostPort;
  liveSessionHostPort: AgentOrchestratorLiveSessionHostPort;
};
