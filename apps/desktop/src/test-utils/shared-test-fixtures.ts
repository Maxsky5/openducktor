import type { BeadsCheck, TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const BASE_BEADS_CHECK_FIXTURE: BeadsCheck = {
  beadsOk: true,
  beadsPath: "/repo/.beads",
  beadsError: null,
  repoStoreHealth: {
    category: "healthy",
    status: "ready",
    isReady: true,
    detail: "Beads attachment and shared Dolt server are healthy.",
    attachment: {
      path: "/repo/.beads",
      databaseName: "repo_db",
    },
    sharedServer: {
      host: "127.0.0.1",
      port: 3307,
      ownershipState: "owned_by_current_process",
    },
  },
};

type RepoStoreHealthFixtureOverrides = Omit<
  Partial<BeadsCheck["repoStoreHealth"]>,
  "attachment" | "sharedServer"
> & {
  attachment?: Partial<BeadsCheck["repoStoreHealth"]["attachment"]>;
  sharedServer?: Partial<BeadsCheck["repoStoreHealth"]["sharedServer"]>;
};

export type BeadsCheckFixtureOverrides = Omit<Partial<BeadsCheck>, "repoStoreHealth"> & {
  repoStoreHealth?: RepoStoreHealthFixtureOverrides;
};

const BASE_TASK_CARD_FIXTURE: TaskCard = {
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
  parentId: undefined,
  subtaskIds: [],
  agentSessions: [],
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
  historyHydrationState: "hydrated",
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

export const createBeadsCheckFixture = (
  defaults: BeadsCheckFixtureOverrides = {},
  overrides: BeadsCheckFixtureOverrides = {},
): BeadsCheck => {
  const merged = {
    ...BASE_BEADS_CHECK_FIXTURE,
    ...defaults,
    ...overrides,
    repoStoreHealth: {
      ...BASE_BEADS_CHECK_FIXTURE.repoStoreHealth,
      ...defaults.repoStoreHealth,
      ...overrides.repoStoreHealth,
      attachment: {
        ...BASE_BEADS_CHECK_FIXTURE.repoStoreHealth.attachment,
        ...defaults.repoStoreHealth?.attachment,
        ...overrides.repoStoreHealth?.attachment,
      },
      sharedServer: {
        ...BASE_BEADS_CHECK_FIXTURE.repoStoreHealth.sharedServer,
        ...defaults.repoStoreHealth?.sharedServer,
        ...overrides.repoStoreHealth?.sharedServer,
      },
    },
  } satisfies BeadsCheck;

  return structuredClone(merged);
};

export const createTaskCardFixture = (
  defaults: Partial<TaskCard> = {},
  overrides: Partial<TaskCard> = {},
): TaskCard => {
  const merged = {
    ...BASE_TASK_CARD_FIXTURE,
    ...defaults,
    ...overrides,
    documentSummary: {
      ...BASE_TASK_CARD_FIXTURE.documentSummary,
      ...defaults.documentSummary,
      ...overrides.documentSummary,
      spec: {
        ...BASE_TASK_CARD_FIXTURE.documentSummary.spec,
        ...defaults.documentSummary?.spec,
        ...overrides.documentSummary?.spec,
      },
      plan: {
        ...BASE_TASK_CARD_FIXTURE.documentSummary.plan,
        ...defaults.documentSummary?.plan,
        ...overrides.documentSummary?.plan,
      },
      qaReport: {
        ...BASE_TASK_CARD_FIXTURE.documentSummary.qaReport,
        ...defaults.documentSummary?.qaReport,
        ...overrides.documentSummary?.qaReport,
      },
    },
    agentWorkflows: {
      ...BASE_TASK_CARD_FIXTURE.agentWorkflows,
      ...defaults.agentWorkflows,
      ...overrides.agentWorkflows,
      spec: {
        ...BASE_TASK_CARD_FIXTURE.agentWorkflows.spec,
        ...defaults.agentWorkflows?.spec,
        ...overrides.agentWorkflows?.spec,
      },
      planner: {
        ...BASE_TASK_CARD_FIXTURE.agentWorkflows.planner,
        ...defaults.agentWorkflows?.planner,
        ...overrides.agentWorkflows?.planner,
      },
      builder: {
        ...BASE_TASK_CARD_FIXTURE.agentWorkflows.builder,
        ...defaults.agentWorkflows?.builder,
        ...overrides.agentWorkflows?.builder,
      },
      qa: {
        ...BASE_TASK_CARD_FIXTURE.agentWorkflows.qa,
        ...defaults.agentWorkflows?.qa,
        ...overrides.agentWorkflows?.qa,
      },
    },
  } satisfies TaskCard;

  return structuredClone(merged);
};

export const createAgentSessionFixture = (
  defaults: Partial<AgentSessionState> = {},
  overrides: Partial<AgentSessionState> = {},
): AgentSessionState => {
  const merged = {
    ...BASE_AGENT_SESSION_FIXTURE,
    ...defaults,
    ...overrides,
  } satisfies AgentSessionState;

  return structuredClone(merged);
};
