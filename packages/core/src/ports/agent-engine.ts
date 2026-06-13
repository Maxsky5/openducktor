import type {
  FileDiff,
  FileStatus,
  RuntimeApprovalReplyOutcome,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentPendingApprovalRequest,
  AgentPendingQuestionRequest,
  AgentRole,
  AgentSessionContext,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentStreamPart,
  AgentUserMessageDisplayPart,
  AgentUserMessagePart,
  AgentUserMessageState,
  ExternalSessionId,
  RepoRuntimeRef,
  RuntimeHistoryAnchor,
  RuntimeKind,
  RuntimePendingInputRequestId,
} from "../types/agent-orchestrator";

type RuntimeWorkingDirectoryRef = RepoRuntimeRef & {
  workingDirectory: string;
};

export type AgentSessionRef = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
};

export type AgentSessionRuntimeRef = AgentSessionRef & {
  taskId: string;
  role: AgentRole | null;
  model?: AgentModelSelection;
  systemPrompt?: string;
  purpose?: "primary" | "transcript";
};

export type StartAgentSessionInput = AgentSessionContext;

export type ResumeAgentSessionInput = AgentSessionRuntimeRef;

export type ForkAgentSessionInput = AgentSessionContext & {
  parentExternalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type SendAgentUserMessageInput = AgentSessionRuntimeRef & {
  parts: AgentUserMessagePart[];
  model?: AgentModelSelection;
};

export type UpdateAgentSessionModelInput = AgentSessionRef & {
  model: AgentModelSelection | null;
};

export type LoadAgentSessionHistoryInput = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
  limit?: number;
};

export type LoadAgentSessionTodosInput = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
};

export type ListAgentModelsInput = RepoRuntimeRef;

export type ListAgentSlashCommandsInput = RepoRuntimeRef;

export type ListAgentSkillsInput = RuntimeWorkingDirectoryRef;

export type SearchAgentFilesInput = RuntimeWorkingDirectoryRef & {
  query: string;
};

export type ListLiveAgentSessionsInput = RepoRuntimeRef & {
  directories?: string[];
};

export type ListSessionPresenceInput = RepoRuntimeRef & {
  directories?: string[];
};

export type ReadSessionPresenceInput = AgentSessionRef;

export type LoadAgentSessionDiffInput = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type LoadAgentFileStatusInput = RuntimeWorkingDirectoryRef;

export type AgentSessionHistoryMessage =
  | {
      messageId: RuntimeHistoryAnchor;
      role: "user";
      timestamp: string;
      text: string;
      displayParts: AgentUserMessageDisplayPart[];
      state: AgentUserMessageState;
      model?: AgentModelSelection;
      parts: AgentStreamPart[];
    }
  | {
      messageId: RuntimeHistoryAnchor;
      role: "assistant";
      timestamp: string;
      text: string;
      durationMs?: number;
      totalTokens?: number;
      contextWindow?: number;
      model?: AgentModelSelection;
      parts: AgentStreamPart[];
    }
  | {
      messageId: RuntimeHistoryAnchor;
      role: "system";
      timestamp: string;
      text: string;
      /**
       * Runtime adapters use system messages only for system/developer context
       * that is exposed by the runtime-owned history source. Adapters must not
       * synthesize missing prompt text from OpenDucktor persistence.
       */
      notice?: {
        tone: "info";
        reason: "session_compacted";
        title: string;
      };
      parts: [];
    };

export type LiveAgentSessionStatus =
  | {
      type: "busy";
    }
  | {
      type: "idle";
    }
  | {
      type: "retry";
      attempt: number;
      message: string;
      nextEpochMs: number;
    };

export type LiveAgentSessionSummary = {
  externalSessionId: ExternalSessionId;
  title: string;
  workingDirectory: string;
  startedAt: string;
  status: LiveAgentSessionStatus;
};

export type LiveAgentSessionSnapshot = LiveAgentSessionSummary & {
  pendingApprovals: AgentPendingApprovalRequest[];
  pendingQuestions: AgentPendingQuestionRequest[];
};

export type AgentSessionActivity =
  | "waiting_for_question"
  | "waiting_for_permission"
  | "retrying"
  | "running"
  | "idle";

export type AgentSessionPresence = "runtime" | "persisted_only" | "stale";

export type AgentSessionPresenceSnapshot =
  | {
      presence: "runtime";
      classification: AgentSessionActivity;
      ref: AgentSessionRef;
      title: string;
      startedAt: string;
      status: LiveAgentSessionStatus;
      agentSessionStatus: "running" | "idle";
      pendingApprovals: AgentPendingApprovalRequest[];
      pendingQuestions: AgentPendingQuestionRequest[];
    }
  | {
      presence: "stale";
      classification: "stale";
      ref: AgentSessionRef;
      pendingApprovals: [];
      pendingQuestions: [];
    }
  | {
      presence: "persisted_only";
      classification: "persisted_only";
      ref: AgentSessionRef;
      reason: string;
      pendingApprovals: [];
      pendingQuestions: [];
    };

export type ReplyApprovalInput = AgentSessionRuntimeRef & {
  requestId: RuntimePendingInputRequestId;
  outcome: RuntimeApprovalReplyOutcome;
  message?: string;
};

export type ReplyQuestionInput = AgentSessionRuntimeRef & {
  requestId: RuntimePendingInputRequestId;
  answers: string[][];
};

export type EventUnsubscribe = () => void;

export type AgentSessionSummary = {
  externalSessionId: ExternalSessionId;
  runtimeKind?: RuntimeKind;
  title?: string;
  role: AgentRole | null;
  startedAt: string;
  status: "starting" | "running" | "idle" | "error" | "stopped";
};

export interface AgentRuntimeRegistryPort {
  listRuntimeDefinitions(): RuntimeDescriptor[];
}

export interface AgentCatalogPort {
  listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog>;
  listAvailableSlashCommands(input: ListAgentSlashCommandsInput): Promise<AgentSlashCommandCatalog>;
  listAvailableSkills(input: ListAgentSkillsInput): Promise<AgentSkillCatalog>;
  searchFiles(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]>;
}

export interface AgentSessionPort {
  startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary>;
  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary>;
  restoreSession(input: AgentSessionRef): Promise<AgentSessionSummary>;
  releaseSession(input: AgentSessionRef): Promise<void>;
  forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary>;
  listLiveAgentSessions(input: ListLiveAgentSessionsInput): Promise<LiveAgentSessionSummary[]>;
  listSessionPresence(input: ListSessionPresenceInput): Promise<AgentSessionPresenceSnapshot[]>;
  readSessionPresence(input: ReadSessionPresenceInput): Promise<AgentSessionPresenceSnapshot>;
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
  updateSessionModel(input: UpdateAgentSessionModelInput): void;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<void>;
  replyApproval(input: ReplyApprovalInput): Promise<void>;
  replyQuestion(input: ReplyQuestionInput): Promise<void>;
  subscribeEvents(input: AgentSessionRef, listener: (event: AgentEvent) => void): EventUnsubscribe;
  stopSession(input: AgentSessionRef): Promise<void>;
}

export interface AgentWorkspaceInspectionPort {
  loadSessionDiff(input: LoadAgentSessionDiffInput): Promise<FileDiff[]>;
  loadFileStatus(input: LoadAgentFileStatusInput): Promise<FileStatus[]>;
}

export type AgentEnginePort = AgentRuntimeRegistryPort &
  AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort;
