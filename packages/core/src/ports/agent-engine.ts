import type { FileDiff, FileStatus, RuntimeDescriptor } from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentModelCatalog,
  AgentModelSelection,
  AgentPendingPermissionRequest,
  AgentPendingQuestionRequest,
  AgentRole,
  AgentRuntimeConnection,
  AgentScenario,
  AgentSessionContext,
  AgentSessionTodoItem,
  AgentSlashCommandCatalog,
  AgentStreamPart,
  AgentUserMessagePart,
  RuntimeKind,
} from "../types/agent-orchestrator";

export type StartAgentSessionInput = Omit<AgentSessionContext, "sessionId"> & {
  sessionId?: string;
};

export type ResumeAgentSessionInput = Omit<AgentSessionContext, "sessionId"> & {
  sessionId: string;
  externalSessionId: string;
};

export type ForkAgentSessionInput = Omit<AgentSessionContext, "sessionId"> & {
  sessionId?: string;
  parentExternalSessionId: string;
  messageId?: string;
};

export type SendAgentUserMessageInput = {
  sessionId: string;
  parts: AgentUserMessagePart[];
  model?: AgentModelSelection;
};

export type UpdateAgentSessionModelInput = {
  sessionId: string;
  model: AgentModelSelection | null;
};

export type LoadAgentSessionHistoryInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  externalSessionId: string;
  limit?: number;
};

export type LoadAgentSessionTodosInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  externalSessionId: string;
};

export type ListLiveAgentSessionPendingInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
};

export type LiveAgentSessionPendingInputBySession = Record<
  string,
  {
    permissions: AgentPendingPermissionRequest[];
    questions: AgentPendingQuestionRequest[];
  }
>;

export type ListAgentModelsInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
};

export type ListAgentSlashCommandsInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
};

export type ListLiveAgentSessionsInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  directories?: string[];
};

export type LoadAgentSessionDiffInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
  sessionId: string;
  messageId?: string;
};

export type LoadAgentFileStatusInput = {
  runtimeKind: RuntimeKind;
  runtimeConnection: AgentRuntimeConnection;
};

export type AgentSessionHistoryMessage =
  | {
      messageId: string;
      role: "user";
      timestamp: string;
      text: string;
      state: AgentUserMessageState;
      model?: AgentModelSelection;
      parts: AgentStreamPart[];
    }
  | {
      messageId: string;
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
  externalSessionId: string;
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
  sessionId: string;
  requestId: string;
  reply: "once" | "always" | "reject";
  message?: string;
};

export type ReplyQuestionInput = {
  sessionId: string;
  requestId: string;
  answers: string[][];
};

export type EventUnsubscribe = () => void;

export type AgentSessionSummary = {
  sessionId: string;
  externalSessionId: string;
  runtimeKind?: string;
  role: AgentRole;
  scenario: AgentScenario;
  startedAt: string;
  status: "starting" | "running" | "idle" | "error" | "stopped";
};

export interface AgentRuntimeRegistryPort {
  listRuntimeDefinitions(): RuntimeDescriptor[];
}

export interface AgentCatalogPort {
  listAvailableModels(input: ListAgentModelsInput): Promise<AgentModelCatalog>;
  listAvailableSlashCommands(input: ListAgentSlashCommandsInput): Promise<AgentSlashCommandCatalog>;
}

export interface AgentSessionPort {
  startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary>;
  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary>;
  forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary>;
  listLiveAgentSessions(input: ListLiveAgentSessionsInput): Promise<LiveAgentSessionSummary[]>;
  listLiveAgentSessionSnapshots(
    input: ListLiveAgentSessionsInput,
  ): Promise<LiveAgentSessionSnapshot[]>;
  hasSession(sessionId: string): boolean;
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
  listLiveAgentSessionPendingInput(
    input: ListLiveAgentSessionPendingInput,
  ): Promise<LiveAgentSessionPendingInputBySession>;
  updateSessionModel(input: UpdateAgentSessionModelInput): void;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<void>;
  replyPermission(input: ReplyPermissionInput): Promise<void>;
  replyQuestion(input: ReplyQuestionInput): Promise<void>;
  subscribeEvents(sessionId: string, listener: (event: AgentEvent) => void): EventUnsubscribe;
  stopSession(sessionId: string): Promise<void>;
}

export interface AgentWorkspaceInspectionPort {
  loadSessionDiff(input: LoadAgentSessionDiffInput): Promise<FileDiff[]>;
  loadFileStatus(input: LoadAgentFileStatusInput): Promise<FileStatus[]>;
}

export type AgentEnginePort = AgentRuntimeRegistryPort &
  AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort;
