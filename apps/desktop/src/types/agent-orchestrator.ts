import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
} from "@openblueprint/core";

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "thinking" | "tool";
  content: string;
  timestamp: string;
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
