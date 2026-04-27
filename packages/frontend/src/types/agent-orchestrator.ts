import type { RepoPromptOverrides, RuntimeKind, RuntimeRoute } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionTodoItem,
  AgentSubagentExecutionMode,
  AgentSubagentStatus,
  AgentUserMessageDisplayPart,
  AgentUserMessageState,
} from "@openducktor/core";
import type { RuntimeConnectionPreloadIndex } from "@/state/operations/agent-orchestrator/lifecycle/live-agent-session-cache";

export type { RuntimeConnectionPreloadIndex };

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
      status: "pending" | "running" | "completed" | "error";
      preview?: string;
      title?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
      observedStartedAtMs?: number;
      observedEndedAtMs?: number;
      inputReadyAtMs?: number;
    }
  | {
      kind: "assistant";
      agentRole: AgentRole;
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
      sessionId?: string;
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
    };

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "tool";
  content: string;
  timestamp: string;
  meta?: AgentChatMessageMeta;
};

export type SessionMessagesState = {
  readonly sessionId: string;
  readonly count: number;
  readonly version: number;
};

export type AgentSessionMessages = AgentChatMessage[] | SessionMessagesState;

export type AgentPermissionRequest = {
  requestId: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
};

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
  sessionId: string;
  externalSessionId: string;
  purpose?: AgentSessionPurpose;
  title?: string;
  taskId: string;
  repoPath: string;
  runtimeKind?: RuntimeKind;
  role: AgentRole;
  scenario: AgentScenario;
  status: "starting" | "running" | "idle" | "error" | "stopped";
  startedAt: string;
  runtimeId: string | null;
  runtimeRoute: RuntimeRoute | null;
  workingDirectory: string;
  historyHydrationState?: AgentSessionHistoryHydrationState;
  runtimeRecoveryState?: AgentSessionRuntimeRecoveryState;
  messages: AgentSessionMessages;
  draftAssistantText: string;
  draftAssistantMessageId: string | null;
  draftReasoningText: string;
  draftReasoningMessageId: string | null;
  contextUsage?: AgentSessionContextUsage | null;
  pendingPermissions: AgentPermissionRequest[];
  pendingQuestions: AgentQuestionRequest[];
  todos: AgentSessionTodoItem[];
  modelCatalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
  isLoadingModelCatalog: boolean;
  promptOverrides?: RepoPromptOverrides;
  stopRequestedAt?: string | null;
};

export type AgentSessionLoadMode =
  | "bootstrap"
  | "requested_history"
  | "reconcile_live"
  | "recover_runtime_attachment";
export type AgentSessionHistoryHydrationPolicy = "none" | "requested_only" | "live_if_empty";

export type AgentSessionLoadOptions = {
  mode?: AgentSessionLoadMode;
  targetSessionId?: string | null;
  recoveryDedupKey?: string | null;
  historyPolicy?: AgentSessionHistoryHydrationPolicy;
  historyPreludeMode?: AgentSessionHistoryPreludeMode;
  allowLiveSessionResume?: boolean;
  persistedRecords?: import("@openducktor/contracts").AgentSessionRecord[];
  preloadedRuntimeLists?: Map<
    import("@openducktor/contracts").RuntimeKind,
    import("@openducktor/contracts").RuntimeInstanceSummary[]
  >;
  preloadedRuntimeConnections?: RuntimeConnectionPreloadIndex;
  preloadedLiveAgentSessionsByKey?: Map<
    string,
    import("@openducktor/core").LiveAgentSessionSnapshot[]
  >;
  allowRuntimeEnsure?: boolean;
};
