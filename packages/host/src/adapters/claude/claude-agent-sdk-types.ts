import type { ClaudeLaunchPolicyPort } from "../../application/runtimes/claude-launch-policy";
import type { ErrorState } from "./claude-agent-sdk-errors";
import type {
  PermissionResult,
  Query,
  SDKMessage,
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
  StartAgentSessionInput,
} from "@openducktor/core";
import type { Effect, Fiber } from "effect";

export type {
  ClaudeAgentSdkService,
  ClaudeAgentSdkServiceError,
} from "../../application/runtimes/claude-agent-sdk-service";

import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../../effect/host-errors";
import type { RuntimeSessionTarget } from "../../ports/runtime-registry-port";
import type { ToolDiscoveryPort } from "../../ports/tool-discovery-port";
import type { OpenDucktorMcpBridgeConnection } from "../mcp/openducktor-mcp-environment";
import type { HostRuntimeDistribution } from "../runtimes/runtime-distribution";
import type { AsyncInputQueue } from "./claude-agent-sdk-queue";
import type { ClaudeBackgroundToolState } from "./claude-agent-sdk-background-tools";
import type { ClaudeEventSession } from "./claude-agent-sdk-event-session";
import type { ClaudeNativeActivityState } from "./claude-agent-sdk-activity";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";
import type { ClaudeWorkspaceFileSearch } from "./claude-agent-sdk-file-search";

export type ClaudeMcpBridgeConnectionResolver = (
  repoPath: string,
) => Effect.Effect<OpenDucktorMcpBridgeConnection, HostOperationErrorAggregate>;

export type CreateClaudeAgentSdkServiceInput = {
  claudeExecutablePath: string;
  launchPolicy: ClaudeLaunchPolicyPort;
  emit?: (session: ClaudeSessionContext, event: ClaudeAgentSdkEvent) => void;
  fileSearch?: ClaudeWorkspaceFileSearch;
  onBackgroundFailure: (failure: HostOperationErrorAggregate) => Effect.Effect<void, never>;
  processEnv?: NodeJS.ProcessEnv;
  historyStorage?: "memory" | "disk";
  resolveMcpBridgeConnection: ClaudeMcpBridgeConnectionResolver;
  runtimeDistribution: HostRuntimeDistribution;
  sessionStore?: ClaudeSessionStore;
  toolDiscovery: ToolDiscoveryPort;
  now?: () => string;
  randomId?: () => string;
};

export type ClaudeAgentSdkEvent = AgentEvent & { readonly statusUnavailable?: true };
export type ClaudeToolInput = ClaudeProtocolObject;

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
  /** The queue submission of the message. Every live event of the message names it. */
  submissionId?: string;
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

export type ClaudeSessionQuery = AsyncGenerator<SDKMessage, void> &
  Pick<
    Query,
    | "applyFlagSettings"
    | "close"
    | "getContextUsage"
    | "initializationResult"
    | "mcpServerStatus"
    | "setModel"
  >;

export type ClaudePendingUserMessageAdmission = {
  readonly admit: () => void;
  readonly reject: (reason: Error) => void;
};

export type ClaudeSession = ClaudeBackgroundToolState &
  ClaudeNativeActivityState &
  ErrorState & {
    disabledTools?: ReadonlySet<string>;
    appliedPermissionMode?: string;
    requestedPermissionMode?: string;
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
    lastSuccessfulResultTurnIndex?: number;
    lastAssistantNativeUuid?: string;
    lastAssistantNativeUuidTurnIndex?: number;
    completedReplyChainIds?: Map<string, string>;
    model: AgentModelSelection | undefined;
    parentExternalSessionId?: string;
    pendingApprovals: Map<string, PendingApproval>;
    pendingQuestions: Map<string, PendingQuestion>;
    sdkInitiatedTurnActive?: boolean;
    /** A successful result waits for the SDK idle state, which then completes its turn. */
    resultAwaitsSdkIdle?: boolean;
    sdkState?: "idle" | "requires_action" | "running";
    pendingUserTurnCount: number;
    query: ClaudeSessionQuery;
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
    subagentEventSessionsByToolUseId?: Map<string, ClaudeEventSession>;
    subagentEventSessionsByTaskId?: Map<string, ClaudeEventSession>;
    toolEndedAtMsByCallId: Map<string, number>;
    toolStartedAtMsByCallId: Map<string, number>;
    todosById: Map<string, AgentSessionTodoItem>;
    /** Sent user messages that the CLI has not admitted yet, by message UUID. */
    pendingUserMessageAdmissions: Map<string, ClaudePendingUserMessageAdmission>;
    /** Steered messages that no turn has read yet, by message UUID. */
    unreadSteeredUserMessages: Map<string, ClaudeAcceptedUserMessage>;
  };

export type ClaudeSessionContext = Omit<ClaudeSession, "query">;

export type ClaudeSessionStore = {
  readonly sessions: Map<string, ClaudeSession>;
  /** Close local resources; the consumer can call this without joining itself. */
  close(session: ClaudeSession): void;
  confirmClosed(session: ClaudeSession): Effect.Effect<void, HostOperationErrorAggregate>;
  ownConsumer(
    session: ClaudeSession,
    fiber: Fiber.Fiber<void, HostOperationErrorAggregate>,
    canFinish: () => boolean,
  ): void;
  settle(session: ClaudeSession): Effect.Effect<void, HostOperationErrorAggregate>;
  finish(
    session: ClaudeSession,
    message: string,
    emit?: ClaudeAgentSdkEventEmitter,
    timestamp?: string,
  ): void;
  get(externalSessionId: string): ClaudeSession | undefined;
  /** Match the latest execution even after it leaves live state. */
  isLatest(session: ClaudeSessionContext): boolean;
  /** Include consumers that still run after close removes their session. */
  getForCleanup(externalSessionId: string): ClaudeSession | undefined;
  probeSessionStatus(
    input: RuntimeSessionTarget,
  ): Effect.Effect<{ supported: boolean; hasLiveSession: boolean }, never>;
  set(session: ClaudeSession): void;
  subscribeClose(listener: (session: ClaudeSession) => void): () => void;
  stopSession(
    input: RuntimeSessionTarget,
  ): Effect.Effect<void, HostOperationErrorAggregate | HostValidationErrorAggregate>;
  stopSessionsForRuntime(runtimeId: string): Effect.Effect<void, HostOperationErrorAggregate>;
  values(): IterableIterator<ClaudeSession>;
};

export type ClaudeAgentSdkCatalog = {
  agents: Awaited<ReturnType<Query["supportedAgents"]>>;
  commands: SlashCommand[];
  models: Awaited<ReturnType<Query["supportedModels"]>>;
  skills: SlashCommand[];
};
