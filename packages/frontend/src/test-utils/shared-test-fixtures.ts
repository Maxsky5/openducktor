import {
  type ChatSettings,
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KANBAN_SETTINGS,
  type SettingsSnapshot,
  type TaskCard,
  type TaskStoreCheck,
} from "@openducktor/contracts";
import { createRepoScopedAgentSessionState } from "@/state/repo-scoped-agent-session";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { RepoRuntimeHealthCheck } from "@/types/diagnostics";

const BASE_TASK_STORE_CHECK_FIXTURE: TaskStoreCheck = {
  taskStoreOk: true,
  taskStorePath: "/repo/.openducktor/task-stores/workspace-1/database.sqlite",
  taskStoreError: null,
  repoStoreHealth: {
    category: "healthy",
    status: "ready",
    isReady: true,
    detail: "SQLite task store is ready.",
    databasePath: "/repo/.openducktor/task-stores/workspace-1/database.sqlite",
  },
};

type RepoStoreHealthFixtureOverrides = Partial<TaskStoreCheck["repoStoreHealth"]>;

export type TaskStoreCheckFixtureOverrides = Omit<Partial<TaskStoreCheck>, "repoStoreHealth"> & {
  repoStoreHealth?: RepoStoreHealthFixtureOverrides;
};

export type RepoRuntimeHealthFixtureOverrides = Omit<
  Partial<RepoRuntimeHealthCheck>,
  "runtime" | "mcp"
> & {
  runtime?: Partial<RepoRuntimeHealthCheck["runtime"]>;
  mcp?: Partial<NonNullable<RepoRuntimeHealthCheck["mcp"]>>;
};

export type ChatSettingsFixtureOverrides = Partial<ChatSettings>;

export type SettingsSnapshotFixtureOverrides = Omit<
  Partial<SettingsSnapshot>,
  "chat" | "general" | "git" | "kanban"
> & {
  chat?: ChatSettingsFixtureOverrides;
  general?: Partial<SettingsSnapshot["general"]>;
  git?: Partial<SettingsSnapshot["git"]>;
  kanban?: Partial<SettingsSnapshot["kanban"]>;
};

const BASE_TASK_CARD_FIXTURE: TaskCard = {
  id: "task-1",
  title: "Task",
  description: "",
  status: "open",
  priority: 2,
  issueType: "task",
  aiReviewEnabled: true,
  availableActions: [],
  labels: [],
  parentId: undefined,
  subtaskIds: [],
  agentSessions: [],
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

export const TEST_EXTERNAL_SESSION_IDS = {
  default: "external-1",
  secondary: "external-2",
  chatDefault: "ext-1",
} as const;

const BASE_AGENT_SESSION_FIXTURE: AgentSessionState = {
  externalSessionId: TEST_EXTERNAL_SESSION_IDS.default,
  taskId: "task-1",
  repoPath: "/repo",
  runtimeKind: "opencode",
  role: "spec",
  status: "idle",
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  historyLoadState: "loaded",
  messages: [],
  draftAssistantText: "",
  draftAssistantMessageId: null,
  draftReasoningText: "",
  draftReasoningMessageId: null,
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  todos: [],
  modelCatalog: null,
  selectedModel: null,
  isLoadingModelCatalog: false,
};

const BASE_REPO_RUNTIME_HEALTH_FIXTURE: RepoRuntimeHealthCheck = {
  status: "ready",
  checkedAt: "2026-02-22T08:00:00.000Z",
  runtime: {
    status: "ready",
    stage: "runtime_ready",
    observation: null,
    instance: null,
    startedAt: null,
    updatedAt: "2026-02-22T08:00:00.000Z",
    elapsedMs: null,
    attempts: null,
    detail: null,
    failureKind: null,
    failureReason: null,
  },
  mcp: null,
};

const BASE_REPO_RUNTIME_MCP_FIXTURE: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
  supported: true,
  status: "connected",
  serverName: "openducktor",
  serverStatus: "connected",
  toolIds: [],
  detail: null,
  failureKind: null,
};

export const createChatSettingsFixture = (
  overrides: ChatSettingsFixtureOverrides = {},
): ChatSettings => structuredClone({ ...DEFAULT_CHAT_SETTINGS, ...overrides });

export const createSettingsSnapshotFixture = (
  overrides: SettingsSnapshotFixtureOverrides = {},
): SettingsSnapshot => {
  const { chat, general, git, kanban, ...snapshotOverrides } = overrides;
  const merged = {
    theme: "light",
    git: {
      defaultMergeMethod: "merge_commit",
      ...git,
    },
    general: {
      ...DEFAULT_GENERAL_SETTINGS,
      ...general,
    },
    chat: createChatSettingsFixture(chat),
    reusablePrompts: [],
    kanban: {
      ...DEFAULT_KANBAN_SETTINGS,
      ...kanban,
    },
    autopilot: {
      rules: [],
    },
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    workspaces: {},
    globalPromptOverrides: {},
    ...snapshotOverrides,
  } satisfies SettingsSnapshot;

  return structuredClone(merged);
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

export const createTaskStoreCheckFixture = (
  defaults: TaskStoreCheckFixtureOverrides = {},
  overrides: TaskStoreCheckFixtureOverrides = {},
): TaskStoreCheck => {
  const merged = {
    ...BASE_TASK_STORE_CHECK_FIXTURE,
    ...defaults,
    ...overrides,
    repoStoreHealth: {
      ...BASE_TASK_STORE_CHECK_FIXTURE.repoStoreHealth,
      ...defaults.repoStoreHealth,
      ...overrides.repoStoreHealth,
    },
  } satisfies TaskStoreCheck;

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

type LegacyAgentSessionOverrides = Partial<AgentSessionState> & {
  runId?: string | null;
};

export const createAgentSessionFixture = (
  defaults: LegacyAgentSessionOverrides = {},
  overrides: LegacyAgentSessionOverrides = {},
): AgentSessionState => {
  const repoPath =
    overrides.repoPath ?? defaults.repoPath ?? BASE_AGENT_SESSION_FIXTURE.repoPath ?? "/repo";
  const { repoPath: _baseRepoPath, ...baseSession } = BASE_AGENT_SESSION_FIXTURE;
  const { repoPath: _defaultRepoPath, runId: _defaultRunId, ...defaultSession } = defaults;
  const { repoPath: _overrideRepoPath, runId: _overrideRunId, ...overrideSession } = overrides;
  const sessionWithoutRepo: Omit<AgentSessionState, "repoPath"> = {
    ...baseSession,
    ...defaultSession,
    ...overrideSession,
  };
  const merged = createRepoScopedAgentSessionState(sessionWithoutRepo, repoPath);

  return structuredClone(merged);
};

export const createRepoRuntimeHealthFixture = (
  defaults: RepoRuntimeHealthFixtureOverrides = {},
  overrides: RepoRuntimeHealthFixtureOverrides = {},
): RepoRuntimeHealthCheck => {
  const checkedAt =
    overrides.checkedAt ?? defaults.checkedAt ?? BASE_REPO_RUNTIME_HEALTH_FIXTURE.checkedAt;
  const runtimeDefaults = defaults.runtime ?? {};
  const runtimeOverrides = overrides.runtime ?? {};
  const mcpDefaults = defaults.mcp ?? {};
  const mcpOverrides = overrides.mcp ?? {};
  const mergedMcp = {
    ...BASE_REPO_RUNTIME_MCP_FIXTURE,
    ...mcpDefaults,
    ...mcpOverrides,
  };
  const runtime: RepoRuntimeHealthCheck["runtime"] = {
    ...BASE_REPO_RUNTIME_HEALTH_FIXTURE.runtime,
    ...runtimeDefaults,
    ...runtimeOverrides,
    updatedAt: runtimeOverrides.updatedAt ?? runtimeDefaults.updatedAt ?? checkedAt,
  };
  const mcp: NonNullable<RepoRuntimeHealthCheck["mcp"]> = {
    supported: mergedMcp.supported ?? BASE_REPO_RUNTIME_MCP_FIXTURE.supported,
    status: mergedMcp.status ?? BASE_REPO_RUNTIME_MCP_FIXTURE.status,
    serverName: mergedMcp.serverName ?? BASE_REPO_RUNTIME_MCP_FIXTURE.serverName,
    serverStatus: mergedMcp.serverStatus ?? BASE_REPO_RUNTIME_MCP_FIXTURE.serverStatus,
    toolIds: mergedMcp.toolIds ?? BASE_REPO_RUNTIME_MCP_FIXTURE.toolIds,
    detail: mergedMcp.detail ?? BASE_REPO_RUNTIME_MCP_FIXTURE.detail,
    failureKind: mergedMcp.failureKind ?? BASE_REPO_RUNTIME_MCP_FIXTURE.failureKind,
  };
  const merged = {
    ...BASE_REPO_RUNTIME_HEALTH_FIXTURE,
    ...defaults,
    ...overrides,
    status:
      overrides.status ??
      defaults.status ??
      (runtime.status === "error" || mcp.status === "error"
        ? "error"
        : mcp.status === "checking" ||
            mcp.status === "reconnecting" ||
            mcp.status === "waiting_for_runtime"
          ? "checking"
          : runtime.status),
    checkedAt,
    runtime,
    mcp,
  } satisfies RepoRuntimeHealthCheck;

  return structuredClone(merged);
};
