import type {
  PermissionResult,
  Query,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  AgentModelSelection,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentUserMessageDisplayPart,
  ForkAgentSessionInput,
  ResumeAgentSessionInput,
  SessionRef,
  StartAgentSessionInput,
} from "@openducktor/core";
import type { Effect } from "effect";

export type {
  ClaudeAgentSdkService,
  ClaudeAgentSdkServiceError,
} from "../../application/runtimes/claude-agent-sdk-service";

import type { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { OpenDucktorMcpBridgeConnection } from "../mcp/openducktor-mcp-environment";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";
import type { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { JsonValue } from "@openducktor/contracts";

export type ClaudeMcpBridgeConnectionResolver = (
  repoPath: string,
) => Effect.Effect<OpenDucktorMcpBridgeConnection, HostOperationError>;

export type CreateClaudeAgentSdkServiceInput = {
  emit?: (session: ClaudeSessionContext, event: ClaudeAgentSdkEvent) => void;
  onBackgroundFailure: (failure: HostOperationError) => Effect.Effect<void, never>;
  processEnv?: NodeJS.ProcessEnv;
  resolveMcpBridgeConnection: ClaudeMcpBridgeConnectionResolver;
  runtimeDistribution: HostRuntimeDistribution;
  sessionStore?: ClaudeSessionStore;
  settingsConfig: SettingsConfigPort;
  toolDiscovery: ToolDiscoveryPort;
  now?: () => string;
  randomId?: () => string;
};

export type ClaudeAgentSdkEvent = AgentEvent;

export type ClaudeAgentSdkEventEmitter = (
  session: ClaudeSessionContext,
  event: ClaudeAgentSdkEvent,
) => void;

export type PendingApproval = {
  event: Extract<AgentEvent, { type: "approval_required" }>;
  resolve: (result: PermissionResult) => void;
};

export type PendingQuestion = {
  event: Extract<AgentEvent, { type: "question_required" }>;
  resolve: (answers: string[][]) => void;
};

export type ClaudeAcceptedUserMessage = {
  isManualCompaction?: true;
  messageId: string;
  model?: AgentModelSelection;
  parts: AgentUserMessageDisplayPart[];
  text: string;
  timestamp: string;
};

export type ClaudeSessionInput =
  | StartAgentSessionInput
  | ResumeAgentSessionInput
  | ForkAgentSessionInput;

export type ClaudeSessionActivity = "idle" | "running" | "stopped";

export type ClaudeManualCompactionState = {
  boundaryReceived: boolean;
  messageId: string;
};

export type ClaudeSession = {
  acceptedUserMessages: ClaudeAcceptedUserMessage[];
  activeBackgroundSubagentTaskIds?: Set<string>;
  activeManualCompaction?: ClaudeManualCompactionState;
  activeSdkUserTurnCount: number;
  abortController: AbortController;
  activity: ClaudeSessionActivity;
  externalSessionId: string;
  input: ClaudeSessionInput;
  lastAssistantTextMessageId?: string;
  lastAssistantText?: string;
  lastAssistantTextFinal?: boolean;
  lastAssistantTextTurnIndex?: number;
  model: AgentModelSelection | undefined;
  modelAfterQueuedTurns?: AgentModelSelection | null;
  parentExternalSessionId?: string;
  pendingApprovals: Map<string, PendingApproval>;
  pendingQuestions: Map<string, PendingQuestion>;
  sdkState?: "idle" | "requires_action" | "running";
  queuedSdkMessages: SDKUserMessage[];
  pendingUserTurnCount: number;
  query: Query;
  queue: AsyncInputQueue<SDKUserMessage>;
  runtimeId: string;
  startedAt: string;
  summary: AgentSessionSummary;
  streamAssistantMessageOrdinal: number;
  streamAssistantMessageIdsByBlockIndex: Map<number, string>;
  hiddenSubagentTaskIds?: Set<string>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentAgentIdsByToolUseId?: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  toolEndedAtMsByCallId: Map<string, number>;
  toolInputsByCallId: Map<string, Record<string, JsonValue>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId: Map<string, number>;
  todosById: Map<string, AgentSessionTodoItem>;
};

export type ClaudeSessionContext = Omit<ClaudeSession, "query">;

export type ClaudeSessionStore = {
  readonly sessions: Map<string, ClaudeSession>;
  close(session: ClaudeSession): void;
  get(externalSessionId: string): ClaudeSession | undefined;
  probeSessionStatus(
    input: SessionRef,
  ): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, never>;
  set(session: ClaudeSession): void;
  subscribeClose(listener: (session: ClaudeSession) => void): () => void;
  stopSession(input: SessionRef): Effect.Effect<void, HostOperationError | HostValidationError>;
  stopSessionsForRuntime(runtimeId: string): Effect.Effect<void, HostOperationError>;
  values(): IterableIterator<ClaudeSession>;
};

export type ClaudeAgentSdkCatalog = {
  agents: Awaited<ReturnType<Query["supportedAgents"]>>;
  commands: SlashCommand[];
  models: Awaited<ReturnType<Query["supportedModels"]>>;
  skills: SlashCommand[];
};
