import type { AgentSessionMetadata } from "@openducktor/contracts";
import type { WorkflowSessionRef } from "./agent-engine";

export type LoadAgentSessionMetadataInput = WorkflowSessionRef;

/** Reads native session metadata without retaining, resuming, or binding the session. */
export type AgentSessionMetadataPort = {
  loadSessionMetadata(input: LoadAgentSessionMetadataInput): Promise<AgentSessionMetadata>;
};
