export type AgentRole = "spec" | "planner" | "build" | "qa";

export type AgentScenario =
  | "spec_initial"
  | "spec_revision"
  | "planner_initial"
  | "planner_revision"
  | "build_implementation_start"
  | "build_after_qa_rejected"
  | "build_after_human_request_changes"
  | "qa_review";

export type AgentToolName =
  | "set_spec"
  | "set_plan"
  | "build_blocked"
  | "build_resumed"
  | "build_completed"
  | "qa_approved"
  | "qa_rejected";

export type AgentModelSelection = {
  providerId: string;
  modelId: string;
  variant?: string;
  opencodeAgent?: string;
};

export type AgentModelDescriptor = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  variants: string[];
};

export type AgentDescriptor = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
};

export type AgentModelCatalog = {
  models: AgentModelDescriptor[];
  defaultModelsByProvider: Record<string, string>;
  agents: AgentDescriptor[];
};

export type AgentToolCall =
  | {
      tool: "set_spec";
      args: {
        markdown: string;
      };
    }
  | {
      tool: "set_plan";
      args: {
        markdown: string;
        subtasks?: Array<{
          title: string;
          issueType?: "task" | "feature" | "bug";
          priority?: number;
          description?: string;
        }>;
      };
    }
  | {
      tool: "build_blocked";
      args: {
        reason: string;
      };
    }
  | {
      tool: "build_resumed";
      args: Record<string, never>;
    }
  | {
      tool: "build_completed";
      args: {
        summary?: string;
      };
    }
  | {
      tool: "qa_approved";
      args: {
        reportMarkdown: string;
      };
    }
  | {
      tool: "qa_rejected";
      args: {
        reportMarkdown: string;
      };
    };

export type AgentSessionContext = {
  sessionId: string;
  repoPath: string;
  workingDirectory: string;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  systemPrompt: string;
  baseUrl: string;
  model?: AgentModelSelection;
};

export type AgentStreamPart =
  | {
      kind: "text";
      messageId: string;
      partId: string;
      text: string;
      synthetic?: boolean;
      completed: boolean;
    }
  | {
      kind: "reasoning";
      messageId: string;
      partId: string;
      text: string;
      completed: boolean;
    }
  | {
      kind: "tool";
      messageId: string;
      partId: string;
      callId: string;
      tool: string;
      status: "pending" | "running" | "completed" | "error";
      title?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
    }
  | {
      kind: "step";
      messageId: string;
      partId: string;
      phase: "start" | "finish";
      reason?: string;
      cost?: number;
    }
  | {
      kind: "subtask";
      messageId: string;
      partId: string;
      agent: string;
      prompt: string;
      description: string;
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
  spec: ["set_spec"],
  planner: ["set_plan"],
  build: ["build_blocked", "build_resumed", "build_completed"],
  qa: ["qa_approved", "qa_rejected"],
};

export type AgentEvent =
  | {
      type: "session_started";
      sessionId: string;
      timestamp: string;
      message: string;
    }
  | {
      type: "assistant_delta";
      sessionId: string;
      timestamp: string;
      delta: string;
    }
  | {
      type: "assistant_message";
      sessionId: string;
      timestamp: string;
      message: string;
    }
  | {
      type: "assistant_part";
      sessionId: string;
      timestamp: string;
      part: AgentStreamPart;
    }
  | {
      type: "tool_call";
      sessionId: string;
      timestamp: string;
      call: AgentToolCall;
    }
  | {
      type: "tool_result";
      sessionId: string;
      timestamp: string;
      tool: AgentToolName;
      success: boolean;
      message: string;
    }
  | {
      type: "permission_required";
      sessionId: string;
      timestamp: string;
      requestId: string;
      permission: string;
      patterns: string[];
      metadata?: Record<string, unknown>;
    }
  | {
      type: "question_required";
      sessionId: string;
      timestamp: string;
      requestId: string;
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
      sessionId: string;
      timestamp: string;
      status: AgentSessionStatus;
    }
  | {
      type: "session_error";
      sessionId: string;
      timestamp: string;
      message: string;
    }
  | {
      type: "session_idle";
      sessionId: string;
      timestamp: string;
    }
  | {
      type: "session_finished";
      sessionId: string;
      timestamp: string;
      message: string;
    };
