import type {
  AgentDescriptor as ContractsAgentDescriptor,
  AgentModelAttachmentSupport as ContractsAgentModelAttachmentSupport,
  AgentModelCatalog as ContractsAgentModelCatalog,
  AgentModelDescriptor as ContractsAgentModelDescriptor,
  AgentRole as ContractsAgentRole,
  AgentRuntimeEvent as ContractsAgentRuntimeEvent,
  AgentSessionActivity as ContractsAgentSessionActivity,
  AgentSessionContextUsage as ContractsAgentSessionContextUsage,
  AgentSessionLiveEnvelope as ContractsAgentSessionLiveEnvelope,
  AgentSessionLiveListInput as ContractsAgentSessionLiveListInput,
  AgentSessionLiveLoadContextInput as ContractsAgentSessionLiveLoadContextInput,
  AgentSessionLiveLoadContextResult as ContractsAgentSessionLiveLoadContextResult,
  AgentSessionLivePendingApprovalRequest as ContractsAgentSessionLivePendingApprovalRequest,
  AgentSessionLivePendingQuestionRequest as ContractsAgentSessionLivePendingQuestionRequest,
  AgentSessionLiveReadInput as ContractsAgentSessionLiveReadInput,
  AgentSessionLiveReadResult as ContractsAgentSessionLiveReadResult,
  AgentSessionLiveRef as ContractsAgentSessionLiveRef,
  AgentSessionLiveRefreshInput as ContractsAgentSessionLiveRefreshInput,
  AgentSessionLiveReplyApprovalInput as ContractsAgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput as ContractsAgentSessionLiveReplyQuestionInput,
  AgentSessionLiveScope as ContractsAgentSessionLiveScope,
  AgentSessionLiveSnapshot as ContractsAgentSessionLiveSnapshot,
  AgentSessionStartMode as ContractsAgentSessionStartMode,
  AgentSessionTranscriptEvent as ContractsAgentSessionTranscriptEvent,
  AgentToolName as ContractsAgentToolName,
  AgentTranscriptModelSelection as ContractsAgentTranscriptModelSelection,
  AgentTranscriptPendingApprovalRequest as ContractsAgentTranscriptPendingApprovalRequest,
  AgentTranscriptPendingQuestionRequest as ContractsAgentTranscriptPendingQuestionRequest,
  AgentTranscriptSessionStatus as ContractsAgentTranscriptSessionStatus,
  AgentTranscriptSessionTodoItem as ContractsAgentTranscriptSessionTodoItem,
  AgentTranscriptStreamPart as ContractsAgentTranscriptStreamPart,
  AgentTranscriptUserMessageDisplayPart as ContractsAgentTranscriptUserMessageDisplayPart,
  KnownGitProviderId as ContractsKnownGitProviderId,
  RuntimeSubagentExecutionMode as ContractsRuntimeSubagentExecutionMode,
  SkillCatalog as ContractsSkillCatalog,
  SkillDescriptor as ContractsSkillDescriptor,
  SlashCommandCatalog as ContractsSlashCommandCatalog,
  SlashCommandDescriptor as ContractsSlashCommandDescriptor,
  SubagentCatalog as ContractsSubagentCatalog,
  SubagentDescriptor as ContractsSubagentDescriptor,
  RepoRuntimeRef,
  RuntimeCapabilities,
  RuntimeDescriptor,
} from "@openducktor/contracts";

export type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";

export type AgentSessionActivity = ContractsAgentSessionActivity;
export type AgentSessionContextUsage = ContractsAgentSessionContextUsage;
export type AgentSessionLiveEnvelope = ContractsAgentSessionLiveEnvelope;
export type AgentSessionLiveListInput = ContractsAgentSessionLiveListInput;
export type AgentSessionLiveLoadContextInput = ContractsAgentSessionLiveLoadContextInput;
export type AgentSessionLiveLoadContextResult = ContractsAgentSessionLiveLoadContextResult;
export type AgentSessionLivePendingApprovalRequest =
  ContractsAgentSessionLivePendingApprovalRequest;
export type AgentSessionLivePendingQuestionRequest =
  ContractsAgentSessionLivePendingQuestionRequest;
export type AgentSessionLiveReadInput = ContractsAgentSessionLiveReadInput;
export type AgentSessionLiveReadResult = ContractsAgentSessionLiveReadResult;
export type AgentSessionLiveRef = ContractsAgentSessionLiveRef;
export type AgentSessionLiveRefreshInput = ContractsAgentSessionLiveRefreshInput;
export type AgentSessionLiveReplyApprovalInput = ContractsAgentSessionLiveReplyApprovalInput;
export type AgentSessionLiveReplyQuestionInput = ContractsAgentSessionLiveReplyQuestionInput;
export type AgentSessionLiveScope = ContractsAgentSessionLiveScope;
export type AgentSessionLiveSnapshot = ContractsAgentSessionLiveSnapshot;
export type AgentSessionTranscriptEvent = ContractsAgentSessionTranscriptEvent;

export type AgentRole = ContractsAgentRole;
export type KnownGitProviderId = ContractsKnownGitProviderId;
export type AgentSessionStartMode = ContractsAgentSessionStartMode;
export type AgentToolName = ContractsAgentToolName;

export type AgentModelSelection = ContractsAgentTranscriptModelSelection;

export type AgentModelDescriptor = ContractsAgentModelDescriptor;
export type AgentDescriptor = ContractsAgentDescriptor;
export type AgentModelCatalog = ContractsAgentModelCatalog;

export type AgentRuntimeCapabilities = RuntimeCapabilities;
export type AgentRuntimeDefinition = RuntimeDescriptor;
export type AgentSkillReference = ContractsSkillDescriptor;
export type AgentSkillCatalog = ContractsSkillCatalog;
export type AgentSlashCommand = ContractsSlashCommandDescriptor;
export type AgentSlashCommandCatalog = ContractsSlashCommandCatalog;
export type AgentSubagentReference = ContractsSubagentDescriptor;
export type AgentSubagentCatalog = ContractsSubagentCatalog;
export type AgentSubagentExecutionMode = ContractsRuntimeSubagentExecutionMode;
export type AgentSubagentStatus = "pending" | "running" | "completed" | "cancelled" | "error";
export type ExternalSessionId = string;
export type RuntimeHistoryAnchor = string;
export type RuntimePendingInputRequestId = string;
export type RuntimeWorkingDirectoryRef = RepoRuntimeRef & {
  workingDirectory: string;
};
export type SessionRef = ContractsAgentSessionLiveRef;

export type AgentFileSearchResultKind =
  | "directory"
  | "css"
  | "code"
  | "image"
  | "video"
  | "default";

export type AgentFileReference = {
  id: string;
  path: string;
  name: string;
  kind: AgentFileSearchResultKind;
};

export type AgentFileSearchResult = AgentFileReference;

export type AgentAttachmentKind = "image" | "audio" | "video" | "pdf";

export type AgentModelAttachmentSupport = ContractsAgentModelAttachmentSupport;

export type AgentAttachmentReference = {
  id: string;
  path: string;
  name: string;
  kind: AgentAttachmentKind;
  mime?: string;
};

export type AgentUserMessagePart =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "slash_command";
      command: AgentSlashCommand;
    }
  | {
      kind: "file_reference";
      file: AgentFileReference;
    }
  | {
      kind: "skill_mention";
      skill: AgentSkillReference;
    }
  | {
      kind: "subagent_reference";
      subagent: AgentSubagentReference;
    }
  | {
      kind: "attachment";
      attachment: AgentAttachmentReference;
    };

export type AgentUserMessageSourceText = {
  value: string;
  start: number;
  end: number;
};

export type AgentUserMessageDisplayPart = ContractsAgentTranscriptUserMessageDisplayPart;

export type AgentUserMessagePromptFileReference = {
  file: AgentFileReference;
  sourceText: AgentUserMessageSourceText;
};

export type AgentUserMessagePromptSubagentReference = {
  subagent: AgentSubagentReference;
  sourceText: AgentUserMessageSourceText;
};

export type AgentSessionTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type AgentSessionTodoPriority = "high" | "medium" | "low";

export type AgentSessionTodoItem = ContractsAgentTranscriptSessionTodoItem;

export type AgentUserMessageState = "queued" | "read";

export type AgentApprovalMutation = "mutating" | "read_only" | "unknown";

export type AgentPendingApprovalRequest = ContractsAgentTranscriptPendingApprovalRequest;

export type AgentPendingQuestionRequest = ContractsAgentTranscriptPendingQuestionRequest;

export type AgentRuntimePendingInput = {
  approvals: AgentPendingApprovalRequest[];
  questions: AgentPendingQuestionRequest[];
};

export type AgentSessionContext = RepoRuntimeRef & {
  workingDirectory: string;
  taskId: string;
  role: AgentRole;
  systemPrompt: string;
  model?: AgentModelSelection;
};

export type AgentStreamPart = ContractsAgentTranscriptStreamPart;

export type AgentToolType =
  | "bash"
  | "read"
  | "list"
  | "search"
  | "web"
  | "todo"
  | "file_edit"
  | "workflow"
  | "question"
  | "generic";

export type AgentSessionStatus = ContractsAgentTranscriptSessionStatus;

export type AgentRoleToolPolicy = Record<AgentRole, AgentToolName[]>;

export const AGENT_ROLE_TOOL_POLICY: AgentRoleToolPolicy = {
  spec: ["odt_read_task", "odt_read_task_documents", "odt_set_spec"],
  planner: ["odt_read_task", "odt_read_task_documents", "odt_set_plan"],
  build: [
    "odt_read_task",
    "odt_read_task_documents",
    "odt_build_blocked",
    "odt_build_resumed",
    "odt_build_completed",
    "odt_set_pull_request",
  ],
  qa: ["odt_read_task", "odt_read_task_documents", "odt_qa_approved", "odt_qa_rejected"],
};

/**
 * Runtime adapters may emit this contract before a session ref is attached.
 * Host publication upgrades it to AgentSessionTranscriptEvent, where the ref is required.
 */
export type AgentEvent = ContractsAgentRuntimeEvent;
