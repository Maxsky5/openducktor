import type { ClientConnection } from "../../../connection/client-connection";
import type { AgentOrchestratorDependencies } from "./orchestrator-ports";

export const createAgentOrchestratorDependencies = ({
  host,
  queryClient,
}: ClientConnection): AgentOrchestratorDependencies => ({
  queryClient,
  // Session-list reads batch per read port, so they share the port of the other app reads.
  hostPort: host.client,
  liveSessionHostPort: {
    agentSessionLiveLoadContext: host.client.agentSessionLiveLoadContext,
    agentSessionLiveRead: host.client.agentSessionLiveRead,
    agentSessionLiveReplyApproval: host.client.agentSessionLiveReplyApproval,
    agentSessionLiveReplyQuestion: host.client.agentSessionLiveReplyQuestion,
    observeAgentSessionLive: host.observeAgentSessionLive,
  },
});
