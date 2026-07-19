import type {
  AgentSessionLiveLoadContextInput,
  FileContent,
  FileDiff,
  RuntimeKind,
} from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentRole,
  AgentSubagentExecutionMode,
  AgentSubagentStatus,
  AgentUserMessageDisplayPart,
  AgentUserMessageState,
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
      sourceMessageId?: string;
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
    }
  | {
      kind: "session_notice";
      tone: "info";
      reason: "session_forked";
      title: string;
      parentExternalSessionId: string;
    };

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "tool";
  content: string;
  timestamp: string;
  /** The timestamp is retained for ordering but hidden from the transcript clock label. */
  timestampIsApproximate?: true;
  meta?: AgentChatMessageMeta;
};

export type SessionMessagesState = {
  readonly externalSessionId: string;
  readonly items: readonly AgentChatMessage[];
  readonly version: number;
};

export type AgentSessionMessages = SessionMessagesState;

export type AgentPendingInputSource = {
  kind: "subagent";
  parentExternalSessionId: string;
  childExternalSessionId: string;
  subagentCorrelationKey?: string;
};

type AgentPendingInputRouting = {
  source?: AgentPendingInputSource;
  responseSession?: AgentSessionIdentity;
};

export type AgentApprovalRequest = AgentPendingApprovalRequest & AgentPendingInputRouting;

export type AgentQuestionRequest = {
  requestId: string;
  requestInstanceId?: string;
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
} & AgentPendingInputRouting;

export type AgentSessionContextUsage = {
  totalTokens: number;
  contextWindow?: number;
  outputLimit?: number;
  providerId?: string;
  modelId?: string;
  variant?: string;
  profileId?: string;
};

export type AgentSessionHistoryLoadState = "not_requested" | "loading" | "loaded" | "failed";
export type AgentSessionRuntimeAvailability = "runtime" | "missing";

export type AgentSessionState = {
  externalSessionId: string;
  title?: string;
  taskId: string;
  runtimeKind: RuntimeKind;
  role: AgentRole | null;
  status: "starting" | "running" | "idle" | "error" | "stopped";
  runtimeStatusMessage: string | null;
  startedAt: string;
  workingDirectory: string;
  historyLoadState: AgentSessionHistoryLoadState;
  messages: AgentSessionMessages;
  contextUsage?: AgentSessionContextUsage | null;
  contextUsageError?: string | null;
  pendingApprovals: AgentApprovalRequest[];
  pendingQuestions: AgentQuestionRequest[];
  selectedModel: AgentModelSelection | null;
  runtimeAvailability?: AgentSessionRuntimeAvailability;
  pendingUserMessageStartedAt?: number | undefined;
  stopRequestedAt?: string | null;
};

export type WorkflowAgentSessionState = AgentSessionState & {
  role: AgentRole;
};

export type AgentSessionIdentity = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory"
>;

export type AgentSessionContextLoadTarget = Omit<AgentSessionLiveLoadContextInput, "repoPath">;
