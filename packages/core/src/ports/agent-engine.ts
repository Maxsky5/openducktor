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

export type StartAgentSessionInput = AgentSessionContext;

export type ResumeAgentSessionInput = AgentSessionContext & {
  externalSessionId: ExternalSessionId;
};

export type AttachAgentSessionInput =
  | (AgentSessionContext & {
      externalSessionId: ExternalSessionId;
      purpose?: "primary";
    })
  | {
      purpose: "transcript";
      externalSessionId: ExternalSessionId;
      repoPath: string;
      runtimeKind: RuntimeKind;
      runtimeId?: string;
      workingDirectory: string;
      taskId: "";
      role: null;
      systemPrompt: "";
    };

export type ForkAgentSessionInput = AgentSessionContext & {
  parentExternalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type SendAgentUserMessageInput = {
  externalSessionId: ExternalSessionId;
  parts: AgentUserMessagePart[];
  model?: AgentModelSelection;
};

export type UpdateAgentSessionModelInput = {
  externalSessionId: ExternalSessionId;
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

export type SearchAgentFilesInput = RuntimeWorkingDirectoryRef & {
  query: string;
};

export type ListLiveAgentSessionsInput = RepoRuntimeRef & {
  directories?: string[];
};

export type ReadLiveAgentSessionSnapshotInput = AgentSessionRef;

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
      totalTokens?: number;
      model?: AgentModelSelection;
      parts: AgentStreamPart[];
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
      runtimeId: string;
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
      runtimeId: string | null;
      pendingApprovals: [];
      pendingQuestions: [];
    }
  | {
      presence: "persisted_only";
      classification: "persisted_only";
      ref: AgentSessionRef;
      runtimeId: null;
      reason: string;
      pendingApprovals: [];
      pendingQuestions: [];
    };

export type ReplyApprovalInput = {
  externalSessionId: ExternalSessionId;
  requestId: RuntimePendingInputRequestId;
  outcome: RuntimeApprovalReplyOutcome;
  message?: string;
};

export type ReplyQuestionInput = {
  externalSessionId: ExternalSessionId;
  requestId: RuntimePendingInputRequestId;
  answers: string[][];
};

export type EventUnsubscribe = () => void;

export type AgentSessionSummary = {
  externalSessionId: ExternalSessionId;
  runtimeKind?: RuntimeKind;
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
  searchFiles(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]>;
}

export interface AgentSessionPort {
  startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary>;
  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary>;
  attachSession(input: AttachAgentSessionInput): Promise<AgentSessionSummary>;
  detachSession(externalSessionId: ExternalSessionId): Promise<void>;
  forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary>;
  listLiveAgentSessions(input: ListLiveAgentSessionsInput): Promise<LiveAgentSessionSummary[]>;
  listSessionPresence(input: ListSessionPresenceInput): Promise<AgentSessionPresenceSnapshot[]>;
  readSessionPresence(input: ReadSessionPresenceInput): Promise<AgentSessionPresenceSnapshot>;
  hasSession(externalSessionId: ExternalSessionId): boolean;
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
  updateSessionModel(input: UpdateAgentSessionModelInput): void;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<void>;
  replyApproval(input: ReplyApprovalInput): Promise<void>;
  replyQuestion(input: ReplyQuestionInput): Promise<void>;
  subscribeEvents(
    externalSessionId: ExternalSessionId,
    listener: (event: AgentEvent) => void,
  ): EventUnsubscribe;
  stopSession(externalSessionId: ExternalSessionId): Promise<void>;
}

export interface AgentWorkspaceInspectionPort {
  loadSessionDiff(input: LoadAgentSessionDiffInput): Promise<FileDiff[]>;
  loadFileStatus(input: LoadAgentFileStatusInput): Promise<FileStatus[]>;
}

export type AgentEnginePort = AgentRuntimeRegistryPort &
  AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort;
