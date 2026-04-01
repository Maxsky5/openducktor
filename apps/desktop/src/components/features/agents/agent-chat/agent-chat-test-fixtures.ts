import type { TaskCard } from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentSessionTodoItem,
} from "@openducktor/core";
import { Bot, ShieldCheck, Sparkles, Wrench } from "lucide-react";
import { AGENT_ROLE_LABELS } from "@/types";
import type {
  AgentChatMessage,
  AgentPermissionRequest,
  AgentQuestionRequest,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { AgentRoleOption } from "./agent-chat.types";
import { createEmptyComposerDraft, createTextSegment } from "./agent-chat-composer-draft";

const baseTask: TaskCard = {
  id: "task-1",
  title: "Add social login",
  description: "",
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
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: true, canSkip: false, available: true, completed: false },
    planner: { required: true, canSkip: false, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
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
  profiles: [{ name: "Hephaestus (Deep Agent)", mode: "primary", color: "#f59e0b" }],
};

const baseSelection: AgentModelSelection = {
  runtimeKind: "opencode",
  providerId: "openai",
  modelId: "gpt-5.3-codex",
  variant: "high",
  profileId: "Hephaestus (Deep Agent)",
};

const baseMessage: AgentChatMessage = {
  id: "msg-1",
  role: "assistant",
  content: "Initial response",
  timestamp: "2026-02-20T10:01:00.000Z",
  meta: {
    kind: "assistant",
    agentRole: "spec",
    isFinal: true,
    providerId: "openai",
    modelId: "gpt-5.3-codex",
    profileId: "Hephaestus (Deep Agent)",
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
  runtimeEndpoint: "http://127.0.0.1:49480",
  workingDirectory: "/repo",
  messages: [baseMessage],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: baseCatalog,
  selectedModel: baseSelection,
  isLoadingModelCatalog: false,
};

export const TEST_ROLE_OPTIONS: AgentRoleOption[] = [
  { role: "spec", label: AGENT_ROLE_LABELS.spec, icon: Sparkles },
  { role: "planner", label: AGENT_ROLE_LABELS.planner, icon: Bot },
  { role: "build", label: AGENT_ROLE_LABELS.build, icon: Wrench },
  { role: "qa", label: AGENT_ROLE_LABELS.qa, icon: ShieldCheck },
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

export const createComposerDraft = (text: string) => ({
  segments: [createTextSegment(text)],
  attachments: [],
});

export const buildFileSearchResult = (
  overrides: Partial<AgentFileSearchResult> = {},
): AgentFileSearchResult => ({
  id: "src/main.ts",
  path: "src/main.ts",
  name: "main.ts",
  kind: "code",
  ...overrides,
});

export { createEmptyComposerDraft };

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

export const buildPermissionRequest = (
  overrides: Partial<AgentPermissionRequest> = {},
): AgentPermissionRequest => ({
  requestId: "permission-1",
  permission: "shell",
  patterns: ["*"],
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
