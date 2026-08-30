import type {
  AgentSessionAssociation,
  AgentSessionControlForkInput,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlStartInput,
  AgentSessionScope,
  AgentSessionWorkflowScope,
  CodexEffectivePolicy,
  AgentSessionHistoryMessage as ContractsAgentSessionHistoryMessage,
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
  AgentSessionActivity,
  AgentSessionLiveEnvelope,
  AgentSessionLiveListInput,
  AgentSessionLiveLoadContextInput,
  AgentSessionLiveLoadContextResult,
  AgentSessionLiveReadInput,
  AgentSessionLiveReadResult,
  AgentSessionLiveRefreshInput,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
  AgentSessionLiveSnapshot,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  AgentUserMessagePart,
  ExternalSessionId,
  RepoRuntimeRef,
  RuntimeHistoryAnchor,
  RuntimeKind,
  RuntimePendingInputRequestId,
  RuntimeWorkingDirectoryRef,
  SessionRef,
} from "../types/agent-orchestrator";

export type {
  AgentSessionAssociation,
  AgentSessionRepositoryScope,
  AgentSessionScope,
  AgentSessionUnboundAssociation,
  AgentSessionWorkflowScope,
} from "@openducktor/contracts";

export type AgentSessionRef = SessionRef & { sessionScope?: AgentSessionScope };
export type WorkflowSessionRef = SessionRef & { sessionScope: AgentSessionWorkflowScope };
export type AgentSessionRuntimePolicy =
  | { kind: "opencode" }
  | { kind: "claude" }
  | { kind: "codex"; policy: CodexEffectivePolicy };
export type AgentRuntimePolicyBinding =
  | {
      runtimeKind: "opencode";
      runtimePolicy: Extract<AgentSessionRuntimePolicy, { kind: "opencode" }>;
    }
  | { runtimeKind: "claude"; runtimePolicy: Extract<AgentSessionRuntimePolicy, { kind: "claude" }> }
  | { runtimeKind: "codex"; runtimePolicy: Extract<AgentSessionRuntimePolicy, { kind: "codex" }> };

export const workflowAgentSessionScope = (
  taskId: string,
  role: AgentRole,
): AgentSessionWorkflowScope => ({ kind: "workflow", taskId, role });

export const isWorkflowAgentSessionScope = (
  scope: AgentSessionAssociation | null | undefined,
): scope is AgentSessionWorkflowScope => scope?.kind === "workflow";

export const requireWorkflowAgentSessionScope = (
  scope: AgentSessionAssociation | null | undefined,
  action: string,
): AgentSessionWorkflowScope => {
  if (!scope) {
    throw new Error(`Cannot ${action} without workflow session context.`);
  }
  if (!isWorkflowAgentSessionScope(scope)) {
    throw new Error(
      `Cannot ${action} with ${scope.kind} session context; workflow session context is required.`,
    );
  }
  return scope;
};

export function assertAgentRuntimePolicyBinding(
  input: { runtimeKind: RuntimeKind; runtimePolicy: AgentSessionRuntimePolicy },
  action: string,
): asserts input is AgentRuntimePolicyBinding {
  if (!input.runtimePolicy) {
    throw new Error(`Cannot ${action} without resolved runtime policy.`);
  }
  if (input.runtimeKind !== input.runtimePolicy.kind) {
    throw new Error(
      `Cannot ${action} with runtime '${input.runtimeKind}' and '${input.runtimePolicy.kind}' runtime policy.`,
    );
  }
}

export const toAgentRuntimePolicyBinding = (input: {
  runtimeKind: RuntimeKind;
  runtimePolicy: AgentSessionRuntimePolicy;
}): AgentRuntimePolicyBinding => {
  assertAgentRuntimePolicyBinding(input, "bind runtime policy");
  return input;
};

export type PolicyBoundSessionRef = AgentSessionRef &
  AgentRuntimePolicyBinding & {
    model?: AgentModelSelection;
    systemPrompt?: string;
  };

export type PolicyBoundSessionControlRef = PolicyBoundSessionRef & {
  sessionScope: AgentSessionScope;
};

export type StartAgentSessionInput = RuntimeWorkingDirectoryRef &
  AgentRuntimePolicyBinding & {
    sessionScope: AgentSessionScope;
    systemPrompt: string;
    model?: AgentModelSelection;
  };

export type ResumeAgentSessionInput = PolicyBoundSessionControlRef;

export type ForkAgentSessionInput = StartAgentSessionInput & {
  parentExternalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type SendAgentUserMessageInput = PolicyBoundSessionControlRef & {
  parts: AgentUserMessagePart[];
  model?: AgentModelSelection;
};

export type AcceptedAgentUserMessage = Extract<AgentEvent, { type: "user_message" }>;

export type UpdateAgentSessionModelInput = SessionRef & {
  model: AgentModelSelection | null;
};

export type AgentSessionHistorySystemPromptContext = {
  systemPrompt: string;
  startedAt: string;
};

export type LoadAgentSessionHistoryInput = PolicyBoundSessionRef & {
  systemPromptContext?: AgentSessionHistorySystemPromptContext;
  limit?: number;
};

export type LoadAgentSessionTodosInput = PolicyBoundSessionRef;

export type ListAgentModelsInput = RepoRuntimeRef;

export type ListAgentSlashCommandsInput = RuntimeWorkingDirectoryRef;

export type ListAgentSkillsInput = RuntimeWorkingDirectoryRef;

export type ListAgentSubagentsInput = RuntimeWorkingDirectoryRef;

export type SearchAgentFilesInput = RuntimeWorkingDirectoryRef & {
  query: string;
};

export type ListSessionRuntimeSnapshotsInput = RepoRuntimeRef & {
  directories?: string[];
};

export type ReadSessionRuntimeSnapshotInput = SessionRef;

export type LoadAgentSessionDiffInput = RuntimeWorkingDirectoryRef & {
  externalSessionId: ExternalSessionId;
  runtimeHistoryAnchor?: RuntimeHistoryAnchor;
};

export type LoadAgentFileStatusInput = RuntimeWorkingDirectoryRef;

export const AGENT_SESSION_SYSTEM_PROMPT_PREFIX = "System prompt:\n\n";

export type AgentSessionHistoryMessage = ContractsAgentSessionHistoryMessage;

export type AgentSessionRuntimeSnapshotAvailability = "runtime" | "missing";

export type AgentSessionRuntimeSnapshot =
  | {
      availability: "runtime";
      classification: AgentSessionActivity;
      ref: SessionRef;
      parentExternalSessionId?: ExternalSessionId;
      title: string;
      startedAt: string;
      pendingApprovals: AgentPendingApprovalRequest[];
      pendingQuestions: AgentPendingQuestionRequest[];
    }
  | {
      availability: "missing";
      classification: "missing";
      ref: SessionRef;
      pendingApprovals: [];
      pendingQuestions: [];
    };

export type ReplyApprovalInput = PolicyBoundSessionRef & {
  requestId: RuntimePendingInputRequestId;
  outcome: RuntimeApprovalReplyOutcome;
  message?: string;
};

export type ReplyQuestionInput = PolicyBoundSessionRef & {
  requestId: RuntimePendingInputRequestId;
  answers: string[][];
};

export type EventUnsubscribe = () => void;

export type AgentSessionSummary = {
  externalSessionId: ExternalSessionId;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  title?: string;
  sessionAssociation: AgentSessionAssociation;
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
  listAvailableSubagents(input: ListAgentSubagentsInput): Promise<AgentSubagentCatalog>;
  searchFiles(input: SearchAgentFilesInput): Promise<AgentFileSearchResult[]>;
}

/** Host-owned, runtime-neutral live session projection. */
export interface AgentSessionLivePort {
  listLiveSessions(input: AgentSessionLiveListInput): Promise<AgentSessionLiveSnapshot[]>;
  readLiveSession(input: AgentSessionLiveReadInput): Promise<AgentSessionLiveReadResult>;
  observeLiveSessions(
    input: AgentSessionLiveRefreshInput,
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ): Promise<EventUnsubscribe>;
  loadLiveSessionContext(
    input: AgentSessionLiveLoadContextInput,
  ): Promise<AgentSessionLiveLoadContextResult>;
  replyLiveSessionApproval(input: AgentSessionLiveReplyApprovalInput): Promise<void>;
  replyLiveSessionQuestion(input: AgentSessionLiveReplyQuestionInput): Promise<void>;
}

/** Runtime-neutral session controls owned by the host application boundary. */
export interface AgentSessionControlPort {
  startSession(input: AgentSessionControlStartInput): Promise<AgentSessionSummary>;
  resumeSession(input: AgentSessionControlResumeInput): Promise<AgentSessionSummary>;
  releaseSession(input: SessionRef): Promise<void>;
  forkSession(input: AgentSessionControlForkInput): Promise<AgentSessionSummary>;
  updateSessionModel(input: UpdateAgentSessionModelInput): Promise<void>;
  sendUserMessage(input: AgentSessionControlSendInput): Promise<AcceptedAgentUserMessage>;
  stopSession(input: SessionRef): Promise<void>;
}

/** Policy-bound runtime-library controls. Host adapters are the only shared-path callers. */
export interface AgentRuntimeSessionControlPort {
  startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary>;
  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary>;
  releaseSession(input: SessionRef): Promise<void>;
  forkSession(input: ForkAgentSessionInput): Promise<AgentSessionSummary>;
  updateSessionModel(input: UpdateAgentSessionModelInput): Promise<void>;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<AcceptedAgentUserMessage>;
  stopSession(input: SessionRef): Promise<void>;
}

/** Pure runtime history and transcript-adjacent reads. */
export interface AgentSessionHistoryPort {
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
}

/** Runtime-library session controls and pure history reads. Live state uses AgentSessionLivePort. */
export interface AgentSessionPort extends AgentRuntimeSessionControlPort, AgentSessionHistoryPort {}

export interface AgentWorkspaceInspectionPort {
  loadSessionDiff(input: LoadAgentSessionDiffInput): Promise<FileDiff[]>;
  loadFileStatus(input: LoadAgentFileStatusInput): Promise<FileStatus[]>;
}

export type AgentEnginePort = AgentRuntimeDefinitionsPort &
  AgentCatalogPort &
  AgentSessionControlPort &
  AgentSessionHistoryPort &
  AgentWorkspaceInspectionPort;
