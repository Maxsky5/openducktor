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

