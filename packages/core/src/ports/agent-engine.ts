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

export type RuntimeWorkingDirectoryRef = RepoRuntimeRef & {
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

export type AcceptedAgentUserMessage = Extract<AgentEvent, { type: "user_message" }>;

export type UpdateAgentSessionModelInput = AgentSessionRef & {
  model: AgentModelSelection | null;
};

export type AgentSessionHistorySystemPromptContext = {
  systemPrompt: string;
  startedAt: string;
};

export type LoadAgentSessionHistoryInput = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
  systemPromptContext?: AgentSessionHistorySystemPromptContext;
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

export type ListSessionRuntimeSnapshotsInput = RepoRuntimeRef & {
  directories?: string[];
};

export type ReadSessionRuntimeSnapshotInput = AgentSessionRef;

export type LoadAgentSessionDiffInput = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type LoadAgentFileStatusInput = RuntimeWorkingDirectoryRef;

export const AGENT_SESSION_SYSTEM_PROMPT_PREFIX = "System prompt:\n\n";

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
       * exposed by the runtime-owned history source or supplied as transient
       * history-read context. Adapters must not read OpenDucktor persistence to
       * synthesize missing prompt text.
       */
      notice?: {
        tone: "info";
        reason: "session_compacted";
        title: string;
      };
      parts: [];
    };

export type AgentSessionActivity =
  | "waiting_for_question"
  | "waiting_for_permission"
  | "retrying"
  | "running"
  | "idle";

export type AgentSessionRuntimeSnapshotAvailability = "runtime" | "missing";

export type AgentSessionRuntimeSnapshot =
  | {
      availability: "runtime";
      classification: AgentSessionActivity;
      ref: AgentSessionRef;
      parentExternalSessionId?: ExternalSessionId;
      title: string;
      startedAt: string;
      pendingApprovals: AgentPendingApprovalRequest[];
      pendingQuestions: AgentPendingQuestionRequest[];
    }
  | {
      availability: "missing";
      classification: "missing";
      ref: AgentSessionRef;
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
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  title?: string;
  role: AgentRole | null;
  startedAt: string;
  status: "starting" | "running" | "idle" | "error" | "stopped";
};

export interface AgentRuntimeDefinitionsPort {
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
  releaseSession(input: AgentSessionRef): Promise<void>;
  forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary>;
  listSessionRuntimeSnapshots(
    input: ListSessionRuntimeSnapshotsInput,
  ): Promise<AgentSessionRuntimeSnapshot[]>;
  readSessionRuntimeSnapshot(
    input: ReadSessionRuntimeSnapshotInput,
  ): Promise<AgentSessionRuntimeSnapshot>;
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
  updateSessionModel(input: UpdateAgentSessionModelInput): void;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<AcceptedAgentUserMessage>;
  replyApproval(input: ReplyApprovalInput): Promise<void>;
  replyQuestion(input: ReplyQuestionInput): Promise<void>;
  subscribeEvents(
    input: AgentSessionRef,
    listener: (event: AgentEvent) => void,
  ): Promise<EventUnsubscribe>;
  stopSession(input: AgentSessionRef): Promise<void>;
}

export interface AgentWorkspaceInspectionPort {
  loadSessionDiff(input: LoadAgentSessionDiffInput): Promise<FileDiff[]>;
  loadFileStatus(input: LoadAgentFileStatusInput): Promise<FileStatus[]>;
}

export type AgentEnginePort = AgentRuntimeDefinitionsPort &
  AgentCatalogPort &
  AgentSessionPort &
  AgentWorkspaceInspectionPort;
