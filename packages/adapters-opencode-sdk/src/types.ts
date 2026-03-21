import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentSessionSummary, StartAgentSessionInput } from "@openducktor/core";

/**
 * Cache TTL for workflow tool selection (5 minutes).
 * Tool IDs change only when MCP servers connect/disconnect.
 */
export const WORKFLOW_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;

export type SessionInput = Omit<StartAgentSessionInput, "sessionId"> & {
  sessionId: string;
};

export type SessionRecord = {
  summary: AgentSessionSummary;
  input: SessionInput;
  client: OpencodeClient;
  externalSessionId: string;
  streamAbortController: AbortController;
  streamDone: Promise<void>;
  emittedAssistantMessageIds: Set<string>;
  /** Cached workflow tool selection (toolId -> enabled). */
  workflowToolSelectionCache?: Record<string, boolean>;
  /** Timestamp when cache was last populated. */
  workflowToolSelectionCachedAt?: number;
  /** Model key used to compute the cached workflow tool selection. */
  workflowToolSelectionCacheModelKey?: string;
};

export type ClientFactory = (input: {
  runtimeEndpoint: string;
  workingDirectory?: string;
}) => OpencodeClient;

export type OpencodeStreamEventLog = {
  sessionId: string;
  externalSessionId: string;
  relevant: boolean;
  event: Event;
};

export type OpencodeEventLogger = (entry: OpencodeStreamEventLog) => void;

export type OpencodeSdkAdapterOptions = {
  now?: () => string;
  createClient?: ClientFactory;
  logEvent?: OpencodeEventLogger;
};

export type McpServerStatus = {
  status: string;
  error?: string;
};
