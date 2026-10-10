import { observeAgentSessionLive } from "@/lib/host-client";
import { appQueryClient } from "@/lib/query-client";
import { host } from "../../shared/host";
import type { AgentOrchestratorDependencies } from "./orchestrator-ports";

export const createDefaultAgentOrchestratorDependencies = (): AgentOrchestratorDependencies => ({
  queryClient: appQueryClient,
  // Session-list reads batch per read port, so they share the port of the other app reads.
  hostPort: host,
  liveSessionHostPort: {
    agentSessionLiveLoadContext: (...args) => host.agentSessionLiveLoadContext(...args),
    agentSessionLiveRead: (...args) => host.agentSessionLiveRead(...args),
    agentSessionLiveReplyApproval: (...args) => host.agentSessionLiveReplyApproval(...args),
    agentSessionLiveReplyQuestion: (...args) => host.agentSessionLiveReplyQuestion(...args),
    observeAgentSessionLive,
  },
});
