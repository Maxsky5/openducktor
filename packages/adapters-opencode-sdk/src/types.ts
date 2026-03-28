import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type {
  AgentModelSelection,
  AgentSessionSummary,
  StartAgentSessionInput,
} from "@openducktor/core";
import type { PendingPartDelta } from "./event-stream/shared";

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
  eventTransportKey: string;
  hasIdleSinceActivity: boolean;
  emittedMessageIds: Set<string>;
  partsById: Map<string, import("@opencode-ai/sdk/v2/client").Part>;
  messageRoleById: Map<string, string>;
  messageMetadataById: Map<
    string,
    {
      timestamp: string;
      model?: AgentModelSelection;
    }
  >;
  pendingDeltasByPartId: Map<string, PendingPartDelta[]>;
  /** Cached workflow tool selection (toolId -> enabled). */
  workflowToolSelectionCache?: Record<string, boolean>;
  /** Timestamp when cache was last populated. */
  workflowToolSelectionCachedAt?: number;
  /** Model key used to compute the cached workflow tool selection. */
  workflowToolSelectionCacheModelKey?: string;
};

export type EventStreamSubscriber = {
  sessionId: string;
  externalSessionId: string;
  input: SessionInput;
};

export type RuntimeEventTransportRecord = {
  key: string;
  runtimeEndpoint: string;
  controller: AbortController;
  streamDone: Promise<void>;
  subscribers: Map<string, EventStreamSubscriber>;
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
