import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type {
  AgentModelSelection,
  AgentRuntimePolicyBinding,
  AgentSessionScope,
  AgentSessionSummary,
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
import type { ParsedOpencodeEvent as Event } from "./opencode-global-event-ingress";
import type { ParsedOpencodePart } from "./opencode-ingress";

/**
 * Cache TTL for workflow tool selection (5 minutes).
 * Tool IDs change only when MCP servers connect/disconnect.
 */
export const WORKFLOW_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;

export type SessionInput = RuntimeWorkingDirectoryRef &
  AgentRuntimePolicyBinding & {
    sessionScope?: AgentSessionScope;
    systemPrompt: string;
    model?: AgentModelSelection;
  };

export type QueuedUserMessageSend = {
  messageId: string;
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
  pendingCompletedAssistantMessageIds: Set<string>;
  emittedAssistantMessageIds: Set<string>;
  emittedUserMessageSignatures: Map<string, string>;
  emittedUserMessageStates: Map<string, import("@openducktor/core").AgentUserMessageState>;
  pendingUserMessageAdmissions: Map<
    string,
    { admit: () => void; reject: (cause?: unknown) => void }
  >;
  pendingQueuedUserMessages: QueuedUserMessageSend[];
  partsById: Map<string, ParsedOpencodePart>;
  partIdsByMessageId: Map<string, Set<string>>;
  messageRoleById: Map<string, string>;
  messageMetadataById: Map<string, SessionMessageMetadata>;
  compactionMessageIds: Set<string>;
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
  dispatch: (event: Event) => Promise<boolean>;
  ready: Promise<void>;
  streamDone: Promise<void>;
  subscribers: Map<string, EventStreamSubscriber>;
  observers: Set<(event: Event) => void | Promise<void>>;
  terminalObservers: Set<(error: Error) => void | Promise<void>>;
  parentExternalSessionIdByChildExternalSessionId: Map<string, string>;
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
