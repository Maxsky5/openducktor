import type { FileDiff, FileStatus, RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentPendingPermissionRequest,
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
  RuntimeHistoryAnchor,
  RuntimeKind,
  RuntimePendingInputRequestId,
} from "../types/agent-orchestrator";

type RepoRuntimeOperationInput = {
  repoPath: string;
  runtimeKind: RuntimeKind;
};

type RepoRuntimeSessionOperationInput = RepoRuntimeOperationInput & {
  workingDirectory: string;
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

export type LoadAgentSessionHistoryInput = RepoRuntimeSessionOperationInput & {
  externalSessionId: ExternalSessionId;
  limit?: number;
};

export type LoadAgentSessionTodosInput = RepoRuntimeSessionOperationInput & {
  externalSessionId: ExternalSessionId;
};

export type ListLiveAgentSessionPendingInput = RepoRuntimeSessionOperationInput;

export type LiveAgentSessionPendingInputByExternalSessionId = Record<
  ExternalSessionId,
  {
    permissions: AgentPendingPermissionRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

export type ListAgentModelsInput = RepoRuntimeOperationInput;

export type ListAgentSlashCommandsInput = RepoRuntimeOperationInput;

export type SearchAgentFilesInput = RepoRuntimeSessionOperationInput & {
  query: string;
};

export type ListLiveAgentSessionsInput = RepoRuntimeOperationInput & {
  directories?: string[];
};

export type LoadAgentSessionDiffInput = RepoRuntimeSessionOperationInput & {
  externalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type LoadAgentFileStatusInput = RepoRuntimeSessionOperationInput;

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
  pendingPermissions: AgentPendingPermissionRequest[];
  pendingQuestions: AgentPendingQuestionRequest[];
};

export type ReplyPermissionInput = {
  externalSessionId: ExternalSessionId;
  requestId: RuntimePendingInputRequestId;
  reply: "once" | "always" | "reject";
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
  listLiveAgentSessionSnapshots(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSnapshot[]>;
  hasSession(externalSessionId: ExternalSessionId): boolean;
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
  listLiveAgentSessionPendingInput(
    input: ListLiveAgentSessionPendingInput,
  ): Promise<LiveAgentSessionPendingInputByExternalSessionId>;
  updateSessionModel(input: UpdateAgentSessionModelInput): void;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<void>;
  replyPermission(input: ReplyPermissionInput): Promise<void>;
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
