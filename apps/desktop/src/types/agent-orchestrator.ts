import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openblueprint/core";

export type AgentChatMessageMeta =
  | {
      kind: "reasoning";
      partId: string;
      completed: boolean;
    }
  | {
      kind: "tool";
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
      kind: "assistant";
      agentRole: AgentRole;
      providerId?: string;
      modelId?: string;
      variant?: string;
      opencodeAgent?: string;
      durationMs?: number;
    }
  | {
      kind: "step";
      partId: string;
      phase: "start" | "finish";
      reason?: string;
      cost?: number;
    }
  | {
      kind: "subtask";
      partId: string;
      agent: string;
      prompt: string;
      description: string;
    };

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "tool";
  content: string;
  timestamp: string;
  meta?: AgentChatMessageMeta;
};

export type AgentPermissionRequest = {
  requestId: string;
  permission: string;
  patterns: string[];
  metadata?: Record<string, unknown>;
};

export type AgentQuestionRequest = {
  requestId: string;
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    multiple?: boolean;
    custom?: boolean;
  }>;
};

export type AgentSessionState = {
  sessionId: string;
  externalSessionId: string;
  taskId: string;
  role: AgentRole;
  scenario: AgentScenario;
  status: "starting" | "running" | "idle" | "error" | "stopped";
  startedAt: string;
  runtimeId: string | null;
  runId: string | null;
  baseUrl: string;
  workingDirectory: string;
  messages: AgentChatMessage[];
  draftAssistantText: string;
  pendingPermissions: AgentPermissionRequest[];
  pendingQuestions: AgentQuestionRequest[];
  modelCatalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
  isLoadingModelCatalog: boolean;
};
