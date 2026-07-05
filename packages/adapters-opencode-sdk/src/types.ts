import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type {
  AgentModelSelection,
  AgentRuntimePolicyBinding,
  AgentSessionSummary,
  AgentSessionWorkflowScope,
  AgentUserMessageDisplayPart,
  RepoRuntimeRef,
  RepoRuntimeRouteResolution,
  RuntimeWorkingDirectoryRef,
} from "@openducktor/core";
import type {
  PendingBackgroundTaskResult,
  PendingPartDelta,
  PendingSubagentInputEvent,
  PendingSubagentPartEmission,
  PendingSubagentSessionBinding,
} from "./event-stream/shared";

/**
 * Cache TTL for workflow tool selection (5 minutes).
 * Tool IDs change only when MCP servers connect/disconnect.
 */
export const WORKFLOW_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;

export type SessionInput = RuntimeWorkingDirectoryRef &
  AgentRuntimePolicyBinding & {
    sessionScope?: AgentSessionWorkflowScope;
    systemPrompt: string;
    model?: AgentModelSelection;
  };

export type QueuedUserMessageSend = {
  signature: string;
  attachmentIdentitySignature?: string;
  attachmentParts?: Extract<AgentUserMessageDisplayPart, { kind: "attachment" }>[];
};

export type SessionMessageMetadata = {
  timestamp: string;
  model?: AgentModelSelection;
  parentId?: string;
  text?: string;
  hasStopSignal?: boolean;
  totalTokens?: number;
  displayParts?: AgentUserMessageDisplayPart[];
};

export type SessionStreamTurnStatus = "active" | "idle";

export type SessionRecord = {
  summary: AgentSessionSummary;
  input: SessionInput;
  client: OpencodeClient;
  externalSessionId: string;
  runtimeId: string;
  streamTurnStatus: SessionStreamTurnStatus;
  isSendingUserMessage: boolean;
  isAwaitingRuntimeTurnStart: boolean;
  activeAssistantMessageId: string | null;
  completedAssistantMessageIds: Set<string>;
  emittedAssistantMessageIds: Set<string>;
  emittedUserMessageSignatures: Map<string, string>;
  emittedUserMessageStates: Map<string, import("@openducktor/core").AgentUserMessageState>;
  pendingQueuedUserMessages: QueuedUserMessageSend[];
  partsById: Map<string, import("@opencode-ai/sdk/v2/client").Part>;
  messageRoleById: Map<string, string>;
  messageMetadataById: Map<string, SessionMessageMetadata>;
  pendingDeltasByPartId: Map<string, PendingPartDelta[]>;
  subagentCorrelationKeyByPartId: Map<string, string>;
  subagentCorrelationKeyByExternalSessionId: Map<string, string>;
  subagentPartIdByCorrelationKey: Map<string, string>;
  subagentPartIdByExternalSessionId: Map<string, string>;
  pendingSubagentCorrelationKeysBySignature: Map<string, string[]>;
  pendingSubagentCorrelationKeys: string[];
  pendingSubagentSessionsByExternalSessionId: Map<string, PendingSubagentSessionBinding>;
  pendingSubagentPartEmissionsByExternalSessionId: Map<string, PendingSubagentPartEmission[]>;
  pendingSubagentInputEventsByExternalSessionId: Map<string, PendingSubagentInputEvent[]>;
  pendingBackgroundTaskResultsByExternalSessionId: Map<string, PendingBackgroundTaskResult[]>;
  /** Cached workflow tool selection (toolId -> enabled). */
  workflowToolSelectionCache?: Record<string, boolean>;
  /** Timestamp when cache was last populated. */
  workflowToolSelectionCachedAt?: number;
};

export type EventStreamSubscriber = {
  externalSessionId: string;
  input: SessionInput;
};

export type RuntimeEventTransportRecord = {
  runtimeId: string;
  runtimeEndpoint: string;
  controller: AbortController;
  streamDone: Promise<void>;
  subscribers: Map<string, EventStreamSubscriber>;
};

export type ClientFactory = (input: {
  runtimeEndpoint: string;
  workingDirectory?: string;
}) => OpencodeClient;

export type RepoRuntimeResolverPort = {
  requireRepoRuntime(ref: RepoRuntimeRef): Promise<RepoRuntimeRouteResolution>;
};

export type OpencodeStreamEventLog = {
  externalSessionId: string;
  relevant: boolean;
  event: Event;
};

export type OpencodeEventLogger = (entry: OpencodeStreamEventLog) => void;

export type OpencodeSdkAdapterOptions = {
  now?: () => string;
  createClient?: ClientFactory;
  repoRuntimeResolver?: RepoRuntimeResolverPort;
  logEvent?: OpencodeEventLogger;
};
