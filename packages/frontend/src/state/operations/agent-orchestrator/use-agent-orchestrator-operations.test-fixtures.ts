import {
  type AgentSessionRecord,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeInstanceSummary,
  type TaskCard,
} from "@openducktor/contracts";

export const taskFixture: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  notes: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  subtaskIds: [],
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

export const taskFixture2: TaskCard = {
  ...taskFixture,
  id: "task-2",
  title: "Task 2",
};

export const createUnavailableBuildTaskFixture = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  ...taskFixture,
  status: "open",
  agentWorkflows: {
    spec: { required: true, canSkip: false, available: true, completed: false },
    planner: { required: true, canSkip: false, available: false, completed: false },
    builder: { required: true, canSkip: false, available: false, completed: false },
    qa: { required: true, canSkip: false, available: false, completed: false },
  },
  ...overrides,
});

export const persistedSessionFixture: AgentSessionRecord = {
  runtimeKind: "opencode",
  externalSessionId: "external-1",
  role: "build",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  selectedModel: null,
};

export const taskFixtureWithPersistedBuildSession: TaskCard = {
  ...taskFixture,
  agentSessions: [persistedSessionFixture],
};

export const taskFixture2WithPersistedBuildSession: TaskCard = {
  ...taskFixture2,
  agentSessions: [
    {
      ...persistedSessionFixture,
      externalSessionId: "external-2",
    },
  ],
};

export const buildBootstrapFixture = {
  runtimeKind: "opencode",
  runtimeId: "runtime-build",
  runtimeRoute: {
    type: "local_http" as const,
    endpoint: "http://127.0.0.1:4444",
  },
  workingDirectory: "/tmp/repo/worktree",
} as const;

export const createWorktreeRuntimeFixture = (
  overrides: Partial<RuntimeInstanceSummary> = {},
): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId: "runtime-1",
  repoPath: "/tmp/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/tmp/repo/worktree",
  runtimeRoute: {
    type: "local_http",
    endpoint: "http://127.0.0.1:4444",
  },
  startedAt: "2026-02-22T08:00:00.000Z",
  descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
  ...overrides,
});

export const BUILD_SELECTION = {
  runtimeKind: "opencode" as const,
  providerId: "openai",
  modelId: "gpt-5",
  variant: "default",
  profileId: "build",
};
