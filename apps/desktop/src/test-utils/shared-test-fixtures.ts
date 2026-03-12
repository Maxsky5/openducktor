import type { TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const BASE_TASK_CARD_FIXTURE: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  acceptanceCriteria: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  assignee: undefined,
  pullRequest: undefined,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  agentWorkflows: {
    spec: { required: false, canSkip: true, available: true, completed: false },
    planner: { required: false, canSkip: true, available: true, completed: false },
    builder: { required: true, canSkip: false, available: true, completed: false },
    qa: { required: false, canSkip: true, available: false, completed: false },
  },
  updatedAt: "2026-02-22T08:00:00.000Z",
  createdAt: "2026-02-22T08:00:00.000Z",
};

const BASE_AGENT_SESSION_FIXTURE: AgentSessionState = {
  sessionId: "session-1",
  externalSessionId: "external-1",
  taskId: "task-1",
  role: "spec",
  scenario: "spec_initial",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  runtimeId: null,
  runId: null,
  runtimeEndpoint: "http://127.0.0.1:4444",
  workingDirectory: "/tmp/repo/worktree",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingPermissions: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
};

export const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  };
};

export const createTaskCardFixture = (
  defaults: Partial<TaskCard> = {},
  overrides: Partial<TaskCard> = {},
): TaskCard => ({
  ...BASE_TASK_CARD_FIXTURE,
  ...defaults,
  ...overrides,
});

export const createAgentSessionFixture = (
  defaults: Partial<AgentSessionState> = {},
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState => ({
  ...BASE_AGENT_SESSION_FIXTURE,
  ...defaults,
  ...overrides,
});
