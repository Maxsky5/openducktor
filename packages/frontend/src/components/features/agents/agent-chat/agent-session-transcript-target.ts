import type { AgentSessionScope } from "@openducktor/core";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";

export type AgentSessionTranscriptTarget = AgentSessionIdentity & {
  sessionScope?: AgentSessionScope | null;
};
