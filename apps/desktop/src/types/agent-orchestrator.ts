import type { RepoPromptOverrides, RuntimeKind } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionTodoItem,
} from "@openducktor/core";

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
      providerId?: string;
      modelId?: string;
      variant?: string;
      profileId?: string;
    }
  | {
      kind: "step";
      partId: string;
      phase: "start" | "finish";
      reason?: string;
      cost?: number;
    }
  | {
      kind: "subtask";
      partId: string;
      agent: string;
      prompt: string;
      description: string;
    };

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "tool";
  content: string;
  timestamp: string;
  meta?: AgentChatMessageMeta;
};

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
};

export type AgentSessionHistoryHydrationState =
  | "not_requested"
  | "hydrating"
  | "hydrated"
  | "failed";

export type AgentSessionState = {
  sessionId: string;
  externalSessionId: string;
  taskId: string;
  runtimeKind?: RuntimeKind;
  role: AgentRole;
  scenario: AgentScenario;
  status: "starting" | "running" | "idle" | "error" | "stopped";
  startedAt: string;
  runtimeId: string | null;
  runId: string | null;
  runtimeEndpoint: string;
  workingDirectory: string;
  historyHydrationState?: AgentSessionHistoryHydrationState;
  messages: AgentChatMessage[];
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
};

export type AgentSessionLoadMode = "bootstrap" | "requested_history" | "reconcile_live";
export type AgentSessionHistoryHydrationPolicy = "none" | "requested_only" | "live_if_empty";

export type AgentSessionLoadOptions = {
  mode?: AgentSessionLoadMode;
  targetSessionId?: string | null;
  historyPolicy?: AgentSessionHistoryHydrationPolicy;
  persistedRecords?: import("@openducktor/contracts").AgentSessionRecord[];
  preloadedRuns?: import("@openducktor/contracts").RunSummary[];
  preloadedRuntimeLists?: Map<
    import("@openducktor/contracts").RuntimeKind,
    import("@openducktor/contracts").RuntimeInstanceSummary[]
  >;
  preloadedRuntimeConnectionsByKey?: Map<
    string,
    import("@openducktor/core").AgentRuntimeConnection
  >;
  preloadedLiveAgentSessionsByKey?: Map<
    string,
    import("@openducktor/core").LiveAgentSessionSnapshot[]
  >;
  allowRuntimeEnsure?: boolean;
};
