import type { AgentRole } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentSessionTranscriptTarget = AgentSessionIdentity & {
  taskId: string;
  role: AgentRole | null;
};
