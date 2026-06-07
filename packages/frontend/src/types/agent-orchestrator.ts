import type {
  AgentSessionRecord,
  FileContent,
  FileDiff,
  RepoPromptOverrides,
  RuntimeInstanceSummary,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentRole,
  AgentSessionPresenceSnapshot,
  AgentSessionTodoItem,
  AgentSubagentExecutionMode,
  AgentSubagentStatus,
  AgentUserMessageDisplayPart,
  AgentUserMessageState,
} from "@openducktor/core";

/**
 * Defines when a newly-created local session may leave its initial `starting` state.
 *
 * - `after_listener_attach`: mark the session idle as soon as the runtime listener is attached.
 * - `after_first_send_attempt`: keep the session visibly starting until the kickoff/send path
 *   either marks it running or settles it back to idle/error.
 */
export type InitialSessionStatusReleasePolicy =
  | "after_listener_attach"
  | "after_first_send_attempt";

export type AgentChatMessageMeta =
  | {
      kind: "reasoning";
      partId: string;
      completed: boolean;
    }
  | {
      kind: "tool";
      partId: string;
      callId: string;
      tool: string;
      toolType: import("@openducktor/core").AgentToolType;
      status: "pending" | "running" | "completed" | "error";
      preview?: string;
      title?: string;
      displayLabel?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      fileDiffs?: FileDiff[];
      fileContent?: FileContent[];
      /** @deprecated Use fileDiffs. Kept only for already-persisted transcript messages. */
      fileChanges?: FileDiff[];
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
      observedStartedAtMs?: number;
      observedEndedAtMs?: number;
      inputReadyAtMs?: number;
    }
  | {
      kind: "assistant";
      agentRole?: AgentRole;
      providerId?: string;
      modelId?: string;
      variant?: string;
      profileId?: string;
      isFinal?: boolean;
      durationMs?: number;
      totalTokens?: number;
      contextWindow?: number;
      outputLimit?: number;
    }
  | {
      kind: "user";
      state: AgentUserMessageState;
      providerId?: string;
      modelId?: string;
      variant?: string;
      profileId?: string;
      parts?: AgentUserMessageDisplayPart[];
    }
  | {
      kind: "step";
      partId: string;
      phase: "start" | "finish";
      reason?: string;
      cost?: number;
    }
  | {
      kind: "subagent";
      partId: string;
      correlationKey: string;
      status: AgentSubagentStatus;
      agent?: string;
      prompt?: string;
      description?: string;
      error?: string;
      externalSessionId?: string;
      executionMode?: AgentSubagentExecutionMode;
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
    }
  | {
      kind: "session_notice";
      tone: "cancelled";
      reason: "user_stopped";
      title: string;
    }
  | {
      kind: "session_notice";
      tone: "error";
      reason: "session_error";
      title: string;
    }
  | {
      kind: "session_notice";
      tone: "info";
      reason: "session_compacted";
      title: string;
      compactionStatus?: "running" | "completed";
    };

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "tool";
  content: string;
  timestamp: string;
  meta?: AgentChatMessageMeta;
};

export type SessionMessagesState = {
  readonly externalSessionId: string;
  readonly count: number;
  readonly version: number;
};

export type AgentSessionMessages = AgentChatMessage[] | SessionMessagesState;

export type AgentApprovalRequest = AgentPendingApprovalRequest;

export type AgentQuestionRequest = {
  requestId: string;
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
};

export type AgentSessionContextUsage = {
  totalTokens: number;
  contextWindow?: number;
  outputLimit?: number;
  providerId?: string;
  modelId?: string;
  variant?: string;
  profileId?: string;
};

export type AgentSessionHistoryHydrationState =
  | "not_requested"
  | "hydrating"
  | "hydrated"
  | "failed";

export type AgentSessionHistoryPreludeMode = "task_context" | "none";

export type AgentSessionRuntimeRecoveryState =
  | "idle"
  | "waiting_for_runtime"
  | "recovering_runtime"
  | "failed";

export type AgentSessionPurpose = "primary" | "transcript";

export type AgentSessionState = {
  externalSessionId: string;
  purpose?: AgentSessionPurpose;
  title?: string;
  taskId: string;
  repoPath: string;
  runtimeKind?: RuntimeKind;
  role: AgentRole | null;
  status: "starting" | "running" | "idle" | "error" | "stopped";
  startedAt: string;
  runtimeId: string | null;
  workingDirectory: string;
  historyHydrationState?: AgentSessionHistoryHydrationState;
  runtimeRecoveryState?: AgentSessionRuntimeRecoveryState;
  messages: AgentSessionMessages;
  draftAssistantText: string;
  draftAssistantMessageId: string | null;
  draftReasoningText: string;
  draftReasoningMessageId: string | null;
  contextUsage?: AgentSessionContextUsage | null;
  pendingApprovals: AgentApprovalRequest[];
  pendingQuestions: AgentQuestionRequest[];
  /** Live-only parent-session overlay keyed by child runtime session id. */
  subagentPendingApprovalsByExternalSessionId?: Record<string, AgentApprovalRequest[]> | undefined;
  /** Live-only parent-session overlay keyed by child runtime session id. */
  subagentPendingQuestionsByExternalSessionId?: Record<string, AgentQuestionRequest[]> | undefined;
  todos: AgentSessionTodoItem[];
  modelCatalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
  isLoadingModelCatalog: boolean;
  promptOverrides?: RepoPromptOverrides;
  pendingUserMessageStartedAt?: number | undefined;
  stopRequestedAt?: string | null;
};

export type WorkflowAgentSessionState = AgentSessionState & {
  role: AgentRole;
};

export type TranscriptAgentSessionState = AgentSessionState & {
  purpose: "transcript";
};

export type AgentSessionLoadMode =
  | "bootstrap"
  | "requested_history"
  | "reconcile_live"
  | "recover_runtime_attachment";
export type AgentSessionHistoryHydrationPolicy = "none" | "requested_only" | "live_if_empty";

export type AgentSessionLoadOptions = {
  mode?: AgentSessionLoadMode;
  targetExternalSessionId?: string | null;
  recoveryDedupKey?: string | null;
  historyPolicy?: AgentSessionHistoryHydrationPolicy;
  historyPreludeMode?: AgentSessionHistoryPreludeMode;
  allowLiveSessionResume?: boolean;
  persistedRecords?: AgentSessionRecord[];
  preloadedRuntimeLists?: Map<RuntimeKind, RuntimeInstanceSummary[]>;
  preloadedSessionPresenceByKey?: Map<string, AgentSessionPresenceSnapshot[]>;
};
