import type {
  AgentChatMessage,
  AgentQuestionRequest,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import type { AgentRoleOption } from "./agent-chat.types";

const baseTask: TaskCard = {
  id: "task-1",
  title: "Add social login",
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "epic",
  aiReviewEnabled: true,
  availableActions: ["set_spec"],
  labels: [],
  assignee: undefined,
  parentId: undefined,
  subtaskIds: [],
  createdAt: "2026-02-20T10:00:00.000Z",
  updatedAt: "2026-02-20T10:00:00.000Z",
};

const baseCatalog: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5.3-codex",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5.3-codex",
      modelName: "GPT-5.3 Codex",
      variants: ["high", "low"],
      contextWindow: 400_000,
      outputLimit: 128_000,
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5.3-codex",
  },
  agents: [{ name: "Hephaestus (Deep Agent)", mode: "primary", color: "#f59e0b" }],
};

const baseSelection: AgentModelSelection = {
  providerId: "openai",
  modelId: "gpt-5.3-codex",
  variant: "high",
  opencodeAgent: "Hephaestus (Deep Agent)",
};

const baseMessage: AgentChatMessage = {
  id: "msg-1",
  role: "assistant",
  content: "Initial response",
  timestamp: "2026-02-20T10:01:00.000Z",
  meta: {
    kind: "assistant",
    agentRole: "spec",
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    opencodeAgent: "Hephaestus (Deep Agent)",
    durationMs: 1_200,
  },
};

const baseSession: AgentSessionState = {
  sessionId: "session-1",
  externalSessionId: "ext-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "running",
  startedAt: "2026-02-20T10:00:30.000Z",
  runtimeId: "runtime-1",
  runId: "run-1",
  baseUrl: "http://127.0.0.1:49480",
  workingDirectory: "/repo",
  messages: [baseMessage],
  draftAssistantText: "",
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: baseCatalog,
  selectedModel: baseSelection,
  isLoadingModelCatalog: false,
};

export const TEST_ROLE_OPTIONS: AgentRoleOption[] = [
  { role: "spec", label: "Spec", icon: Sparkles },
  { role: "planner", label: "Planner", icon: Bot },
  { role: "build", label: "Build", icon: Wrench },
  { role: "qa", label: "QA", icon: ShieldCheck },
];

export const buildTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  ...baseTask,
  ...overrides,
});

export const buildSession = (overrides: Partial<AgentSessionState> = {}): AgentSessionState => ({
  ...baseSession,
  ...overrides,
});

export const buildMessage = (
  role: AgentChatMessage["role"],
  content: string,
  overrides: Partial<AgentChatMessage> = {},
): AgentChatMessage => ({
  ...baseMessage,
  role,
  content,
  ...overrides,
});

export const buildModelSelection = (
  overrides: Partial<AgentModelSelection> = {},
): AgentModelSelection => ({
  ...baseSelection,
  ...overrides,
});

export const buildQuestionRequest = (
  overrides: Partial<AgentQuestionRequest> = {},
): AgentQuestionRequest => ({
  requestId: "request-1",
  questions: [
    {
      header: "Next Topic",
      question: "What should I focus on?",
      options: [
        { label: "Frontend", description: "UI and browser work" },
        { label: "Backend", description: "Server and APIs" },
      ],
      multiple: false,
      custom: true,
    },
  ],
  ...overrides,
});

export const buildTodoItem = (
  overrides: Partial<AgentSessionTodoItem> = {},
): AgentSessionTodoItem => ({
  id: "todo-1",
  content: "Analyze current styling",
  status: "in_progress",
  priority: "medium",
  ...overrides,
});

export const buildRole = (role: AgentRole): AgentRole => role;
