import type {
  AgentKickoffScenario as ContractsAgentKickoffScenario,
  AgentRole as ContractsAgentRole,
  AgentScenario as ContractsAgentScenario,
  AgentToolName as ContractsAgentToolName,
  TaskPriority,
} from "@openducktor/contracts";
import { isAgentKickoffScenario as isContractsAgentKickoffScenario } from "@openducktor/contracts";

export type AgentRole = ContractsAgentRole;
export type AgentScenario = ContractsAgentScenario;
export type AgentKickoffScenario = ContractsAgentKickoffScenario;
export type AgentToolName = ContractsAgentToolName;
export const isAgentKickoffScenario = isContractsAgentKickoffScenario;

export const assertAgentKickoffScenario = (
  scenario: AgentScenario,
): AgentKickoffScenario => {
  if (!isContractsAgentKickoffScenario(scenario)) {
    throw new Error(`Scenario "${scenario}" does not support kickoff prompts.`);
  }

  return scenario;
};

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
  contextWindow?: number;
  outputLimit?: number;
};

export type AgentDescriptor = {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
  color?: string;
};

export type AgentModelCatalog = {
  models: AgentModelDescriptor[];
  defaultModelsByProvider: Record<string, string>;
  agents: AgentDescriptor[];
};

export type AgentSessionTodoStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type AgentSessionTodoPriority = "high" | "medium" | "low";

export type AgentSessionTodoItem = {
  id: string;
  content: string;
  status: AgentSessionTodoStatus;
  priority: AgentSessionTodoPriority;
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
      metadata?: Record<string, unknown>;
      startedAtMs?: number;
      endedAtMs?: number;
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
  spec: ["odt_read_task", "odt_set_spec"],
  planner: ["odt_read_task", "odt_set_plan"],
  build: ["odt_read_task", "odt_build_blocked", "odt_build_resumed", "odt_build_completed"],
  qa: ["odt_read_task", "odt_qa_approved", "odt_qa_rejected"],
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
      totalTokens?: number;
    }
  | {
      type: "assistant_part";
      sessionId: string;
      timestamp: string;
      part: AgentStreamPart;
    }
  | {
      type: "session_todos_updated";
      sessionId: string;
      timestamp: string;
      todos: AgentSessionTodoItem[];
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
