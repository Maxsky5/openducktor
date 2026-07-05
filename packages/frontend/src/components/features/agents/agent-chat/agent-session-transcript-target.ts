import type { AgentSessionScope } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentSessionTranscriptTarget = AgentSessionIdentity & {
  sessionScope?: AgentSessionScope | null;
};
