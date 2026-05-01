import type {
  AgentRole as ContractsAgentRole,
  AgentSessionStartMode as ContractsAgentSessionStartMode,
  AgentToolName as ContractsAgentToolName,
  KnownGitProviderId as ContractsKnownGitProviderId,
  RuntimeSubagentExecutionMode as ContractsRuntimeSubagentExecutionMode,
  SlashCommandCatalog as ContractsSlashCommandCatalog,
  SlashCommandDescriptor as ContractsSlashCommandDescriptor,
  RepoRuntimeRef,
  RuntimeCapabilities,
  RuntimeDescriptor,
  RuntimeKind,
  TaskPriority,
} from "@openducktor/contracts";

export type { RepoRuntimeRef, RuntimeKind } from "@openducktor/contracts";

export type AgentRole = ContractsAgentRole;
export type KnownGitProviderId = ContractsKnownGitProviderId;
export type AgentSessionStartMode = ContractsAgentSessionStartMode;
export type AgentToolName = ContractsAgentToolName;

export type AgentModelSelection = {
  runtimeKind?: RuntimeKind;
  providerId: string;
  modelId: string;
  variant?: string;
  profileId?: string;
};

export type AgentModelDescriptor = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  variants: string[];
  contextWindow?: number;
  outputLimit?: number;
  attachmentSupport?: AgentModelAttachmentSupport;
};

export type AgentDescriptor = {
  id?: string;
  label?: string;
  name?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
  color?: string;
};

export type AgentModelCatalog = {
  runtime?: RuntimeDescriptor;
  models: AgentModelDescriptor[];
  defaultModelsByProvider: Record<string, string>;
  profiles?: AgentDescriptor[];
};

export type AgentRuntimeCapabilities = RuntimeCapabilities;
export type AgentRuntimeDefinition = RuntimeDescriptor;
export type AgentSlashCommand = ContractsSlashCommandDescriptor;
export type AgentSlashCommandCatalog = ContractsSlashCommandCatalog;
export type AgentSubagentExecutionMode = ContractsRuntimeSubagentExecutionMode;
export type AgentSubagentStatus = "pending" | "running" | "completed" | "cancelled" | "error";
export type ExternalSessionId = string;
export type RuntimeHistoryAnchor = string;
export type RuntimePendingInputRequestId = string;
export type RuntimeSessionRef = {
  externalSessionId: ExternalSessionId;
  repoPath: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
};

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

export type AgentModelAttachmentSupport = {
  image: boolean;
  audio: boolean;
  video: boolean;
  pdf: boolean;
};

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
      kind: "attachment";
      attachment: AgentAttachmentReference;
    };

export type AgentUserMessageSourceText = {
  value: string;
  start: number;
  end: number;
};

export type AgentUserMessageDisplayPart =
  | {
      kind: "text";
      text: string;
      synthetic?: boolean;
    }
  | {
      kind: "file_reference";
      file: AgentFileReference;
      sourceText?: AgentUserMessageSourceText;
    }
  | {
      kind: "attachment";
      attachment: AgentAttachmentReference;
    };

export type AgentUserMessagePromptFileReference = {
  file: AgentFileReference;
  sourceText: AgentUserMessageSourceText;
};

export type AgentSessionTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type AgentSessionTodoPriority = "high" | "medium" | "low";

export type AgentSessionTodoItem = {
  id: string;
  content: string;
  status: AgentSessionTodoStatus;
  priority: AgentSessionTodoPriority;
};

export type AgentUserMessageState = "queued" | "read";

export type AgentPendingPermissionRequest = {
  requestId: RuntimePendingInputRequestId;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
};

export type AgentPendingQuestionRequest = {
  requestId: RuntimePendingInputRequestId;
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
};

export type AgentRuntimePendingInput = {
  permissions: AgentPendingPermissionRequest[];
  questions: AgentPendingQuestionRequest[];
};

export type AgentToolCall =
  | {
      tool: "odt_set_spec";
      args: {
        taskId: string;
        markdown: string;
      };
    }
  | {
      tool: "odt_set_plan";
      args: {
        taskId: string;
        markdown: string;
        subtasks?: Array<{
          title: string;
          issueType?: "task" | "feature" | "bug";
          priority?: TaskPriority;
          description?: string;
        }>;
      };
    }
  | {
      tool: "odt_build_blocked";
      args: {
        taskId: string;
        reason: string;
      };
    }
  | {
      tool: "odt_build_resumed";
      args: {
        taskId: string;
      };
    }
  | {
      tool: "odt_build_completed";
      args: {
        taskId: string;
        summary?: string;
      };
    }
  | {
      tool: "odt_set_pull_request";
      args: {
        taskId: string;
        providerId: KnownGitProviderId;
        number: number;
      };
    }
  | {
      tool: "odt_qa_approved";
      args: {
        taskId: string;
        reportMarkdown: string;
      };
    }
  | {
      tool: "odt_qa_rejected";
      args: {
        taskId: string;
        reportMarkdown: string;
      };
    };

export type AgentSessionContext = RepoRuntimeRef & {
  runtimeId?: string;
  workingDirectory: string;
  taskId: string;
  role: AgentRole;
  systemPrompt: string;
  model?: AgentModelSelection;
};

export type AgentStreamPart =
  | {
      kind: "text";
      messageId: RuntimeHistoryAnchor;
      partId: string;
      text: string;
      synthetic?: boolean;
      completed: boolean;
    }
  | {
      kind: "reasoning";
      messageId: RuntimeHistoryAnchor;
      partId: string;
      text: string;
      completed: boolean;
    }
  | {
      kind: "tool";
      messageId: RuntimeHistoryAnchor;
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
    }
  | {
      kind: "step";
      messageId: RuntimeHistoryAnchor;
      partId: string;
      phase: "start" | "finish";
      reason?: string;
      cost?: number;
      totalTokens?: number;
    }
  | {
      kind: "subagent";
      messageId: RuntimeHistoryAnchor;
      partId: string;
      correlationKey: string;
      status: AgentSubagentStatus;
      agent?: string;
      prompt?: string;
      description?: string;
      externalSessionId?: ExternalSessionId;
      executionMode?: AgentSubagentExecutionMode;
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
    };

export type AgentSessionStatus =
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

export type AgentEvent =
  | {
      type: "session_started";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      message: string;
    }
  | {
      type: "assistant_delta";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      channel: "text" | "reasoning";
      messageId?: RuntimeHistoryAnchor;
      delta: string;
    }
  | {
      type: "assistant_message";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      messageId: RuntimeHistoryAnchor;
      message: string;
      totalTokens?: number;
      model?: AgentModelSelection;
    }
  | {
      type: "user_message";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      messageId: RuntimeHistoryAnchor;
      message: string;
      parts: AgentUserMessageDisplayPart[];
      state: AgentUserMessageState;
      model?: AgentModelSelection;
    }
  | {
      type: "assistant_part";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      part: AgentStreamPart;
    }
  | {
      type: "session_todos_updated";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      todos: AgentSessionTodoItem[];
    }
  | {
      type: "tool_call";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      call: AgentToolCall;
    }
  | {
      type: "tool_result";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      tool: AgentToolName;
      success: boolean;
      message: string;
    }
  | {
      type: "permission_required";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      requestId: RuntimePendingInputRequestId;
      permission: string;
      patterns: string[];
      metadata?: Record<string, unknown>;
      parentExternalSessionId?: string;
      childExternalSessionId?: string;
      subagentCorrelationKey?: string;
    }
  | {
      type: "question_required";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      requestId: RuntimePendingInputRequestId;
      parentExternalSessionId?: string;
      childExternalSessionId?: string;
      subagentCorrelationKey?: string;
      questions: Array<{
        header: string;
        question: string;
        options: Array<{ label: string; description: string }>;
        multiple?: boolean;
        custom?: boolean;
      }>;
    }
  | {
      type: "session_status";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      status: AgentSessionStatus;
    }
  | {
      type: "session_error";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      message: string;
    }
  | {
      type: "session_idle";
      externalSessionId: ExternalSessionId;
      timestamp: string;
    }
  | {
      type: "session_finished";
      externalSessionId: ExternalSessionId;
      timestamp: string;
      message: string;
    };
