import {
  type ChatSettings,
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_KANBAN_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  GITHUB_PROVIDER_DESCRIPTOR,
  type HostMcpBridgeStatus,
  type HostRuntimeStatus,
  type RepoGitConfig,
  repositoryGitProviderContextSchema,
  type RepositoryGitProviderContext,
  settingsRepoConfigSchema,
  type SettingsRepoConfig,
  type SettingsSnapshot,
  type TaskCard,
  type TaskStoreCheck,
  type WorkspaceRecord,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentRuntimeCatalog,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
} from "@openducktor/core";
import type { TaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import type { WorkspaceActivityObserver } from "@/features/workspace-activity/workspace-activity-observer";
import {
  UNKNOWN_WORKSPACE_ACTIVITY,
  type WorkspaceActivityState,
  type WorkspaceSessionLiveState,
} from "@/features/workspace-activity/workspace-activity-state";
import { type AgentSessionSummary, toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { createSessionMessagesFixture } from "@/test-utils/session-message-test-helpers";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";
import type {
  AgentChatMessage,
  AgentSessionState,
  SessionMessagesState,
} from "@/types/agent-orchestrator";
import type { HostRuntimeStatusMap, ObservedCheck } from "@/types/diagnostics";
import type {
  ChecksStateContextValue,
  HostRuntimeStatusContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

export type RuntimeCatalogFixtureSurfaces = {
  models?: AgentModelCatalog;
  slashCommands?: AgentSlashCommandCatalog;
  skills?: AgentSkillCatalog;
  subagents?: AgentSubagentCatalog;
};

export const createRuntimeCatalogFixture = ({
  models,
  slashCommands,
  skills,
  subagents,
}: RuntimeCatalogFixtureSurfaces = {}): AgentRuntimeCatalog => {
  const catalog: AgentRuntimeCatalog = {};
  if (models !== undefined) {
    catalog.models = { status: "available", catalog: models };
  }
  if (slashCommands !== undefined) {
    catalog.slashCommands = { status: "available", catalog: slashCommands };
  }
  if (skills !== undefined) {
    catalog.skills = { status: "available", catalog: skills };
  }
  if (subagents !== undefined) {
    catalog.subagents = { status: "available", catalog: subagents };
  }
  return catalog;
};

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

export type ChatSettingsFixtureOverrides = Partial<ChatSettings>;

export type SettingsSnapshotFixtureOverrides = Omit<
  Partial<SettingsSnapshot>,
  "appearance" | "chat" | "general" | "git" | "kanban"
> & {
  appearance?: Partial<SettingsSnapshot["appearance"]>;
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
  sessionAssociation: { kind: "workflow", taskId: "task-1", role: "spec" },
  runtimeKind: "opencode",
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: "2026-02-22T08:00:00.000Z",
  workingDirectory: "/tmp/repo/worktree",
  livePresence: "unobserved",
  historyLoadState: "loaded",
  messages: createSessionMessagesState(TEST_EXTERNAL_SESSION_IDS.default),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
};

export const createGitProviderConfigFixture = ({
  owner = "example",
  name = "repo",
  enabled = true,
}: {
  owner?: string;
  name?: string;
  enabled?: boolean;
} = {}): NonNullable<RepoGitConfig["provider"]> => ({
  id: "github",
  enabled,
  autoDetected: false,
  repository: { host: "github.com", owner, name },
});

const BASE_GIT_PROVIDER_CONTEXT_FIXTURE = {
  descriptor: GITHUB_PROVIDER_DESCRIPTOR,
  config: createGitProviderConfigFixture(),
  health: {
    providerId: "github",
    enabled: true,
    available: true,
    executablePath: "gh",
    version: "gh version 2.95.0",
    authenticated: true,
    account: "octocat",
    repositoryMappingValid: true,
  },
} satisfies NonNullable<RepositoryGitProviderContext>;

type GitProviderContextFixtureOptions = {
  available?: boolean;
  enabled?: boolean;
  supportsPullRequests?: boolean;
  supportsPullRequestReview?: boolean;
};

export const createGitProviderContextFixture = ({
  available = true,
  enabled = true,
  supportsPullRequests = true,
  supportsPullRequestReview = true,
}: GitProviderContextFixtureOptions = {}): NonNullable<RepositoryGitProviderContext> => {
  const context = {
    ...BASE_GIT_PROVIDER_CONTEXT_FIXTURE,
    descriptor: {
      ...BASE_GIT_PROVIDER_CONTEXT_FIXTURE.descriptor,
      capabilities: {
        supportsPullRequests,
        supportsPullRequestReview: supportsPullRequests && supportsPullRequestReview,
      },
    },
    config: {
      ...BASE_GIT_PROVIDER_CONTEXT_FIXTURE.config,
      enabled,
    },
    health: {
      ...BASE_GIT_PROVIDER_CONTEXT_FIXTURE.health,
      enabled,
      available,
      reason: available ? undefined : "Sign in to GitHub CLI.",
      authenticated: available,
      account: available ? "octocat" : null,
      repositoryMappingValid: available,
    },
  } satisfies NonNullable<RepositoryGitProviderContext>;

  return repositoryGitProviderContextSchema.unwrap().parse(context);
};

export const createChatSettingsFixture = (
  overrides: ChatSettingsFixtureOverrides = {},
): ChatSettings => structuredClone({ ...DEFAULT_CHAT_SETTINGS, ...overrides });

export const createSettingsSnapshotFixture = (
  overrides: SettingsSnapshotFixtureOverrides = {},
): SettingsSnapshot => {
  const { appearance, chat, general, git, kanban, notifications, ...snapshotOverrides } = overrides;
  const merged = {
    theme: "light",
    git: {
      defaultMergeMethod: "merge_commit",
      ...git,
    },
    system: {},
    general: {
      ...DEFAULT_GENERAL_SETTINGS,
      ...general,
    },
    appearance: {
      ...DEFAULT_APPEARANCE_SETTINGS,
      ...appearance,
    },
    chat: createChatSettingsFixture(chat),
    customAgentRoles: [],
    reusablePrompts: [],
    kanban: {
      ...DEFAULT_KANBAN_SETTINGS,
      ...kanban,
    },
    autopilot: {
      alwaysStartQaReviewsFresh: false,
      rules: [],
    },
    notifications: {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...notifications,
      kinds: {
        ...DEFAULT_NOTIFICATION_SETTINGS.kinds,
        ...notifications?.kinds,
      },
    },
    agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    agentModelFavorites: [],
    workspaces: {},
    globalPromptOverrides: {},
    ...snapshotOverrides,
  } satisfies SettingsSnapshot;

  return structuredClone(merged);
};

export const createRepoSettingsConfigFixture = (
  workspaceId: string,
  repoPath: string,
  provider?: RepoGitConfig["provider"],
): SettingsRepoConfig =>
  settingsRepoConfigSchema.parse({
    workspaceId,
    workspaceName: workspaceId,
    repoPath,
    git: provider === undefined ? {} : { provider },
  });

export const createDeferred = <T>() => {
  let resolve: ((value: T | PromiseLike<T>) => void) | null = null;
  let reject: ((cause?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (cause?: unknown): void => {
      reject?.(cause);
    },
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

type AgentSessionFixtureMessages = SessionMessagesState | AgentChatMessage[];

export type AgentSessionFixtureOverrides = Partial<Omit<AgentSessionState, "messages">> & {
  messages?: AgentSessionFixtureMessages;
  runId?: string | null;
};

const toAgentSessionFixtureMessages = (
  externalSessionId: string,
  messages: AgentSessionFixtureMessages | undefined,
): SessionMessagesState => {
  return structuredClone(createSessionMessagesFixture(externalSessionId, messages));
};

const assertCanonicalAgentSessionFixtureInput = (input: AgentSessionFixtureOverrides): void => {
  for (const legacyField of ["taskId", "role"] as const) {
    if (Object.hasOwn(input, legacyField)) {
      throw new Error(
        `Agent session fixture overrides must declare sessionAssociation instead of ${legacyField}.`,
      );
    }
  }
};

export const createAgentSessionFixture = (
  defaults: AgentSessionFixtureOverrides = {},
  overrides: AgentSessionFixtureOverrides = {},
): AgentSessionState => {
  assertCanonicalAgentSessionFixtureInput(defaults);
  assertCanonicalAgentSessionFixtureInput(overrides);
  const { runId: _defaultRunId, messages: defaultMessages, ...defaultSession } = defaults;
  const { runId: _overrideRunId, messages: overrideMessages, ...overrideSession } = overrides;
  const externalSessionId =
    overrideSession.externalSessionId ??
    defaultSession.externalSessionId ??
    BASE_AGENT_SESSION_FIXTURE.externalSessionId;
  const merged: AgentSessionState = {
    ...BASE_AGENT_SESSION_FIXTURE,
    ...defaultSession,
    ...overrideSession,
    messages: toAgentSessionFixtureMessages(
      externalSessionId,
      overrideMessages ?? defaultMessages ?? BASE_AGENT_SESSION_FIXTURE.messages,
    ),
  };

  const { messages, ...cloneableSession } = merged;
  return {
    ...structuredClone(cloneableSession),
    messages,
  };
};

export const createAgentSessionSummaryFixture = (
  defaults: AgentSessionFixtureOverrides = {},
  overrides: AgentSessionFixtureOverrides = {},
): AgentSessionSummary => toAgentSessionSummary(createAgentSessionFixture(defaults, overrides));

export const createHostMcpBridgeStatusFixture = (
  overrides: Partial<HostMcpBridgeStatus> = {},
): HostMcpBridgeStatus => ({
  state: "ready",
  hostUrl: "http://127.0.0.1:4000",
  failure: null,
  updatedAt: "2026-10-03T10:00:00.000Z",
  revision: 1,
  ...overrides,
});

export const createHostRuntimeStatusFixture = (
  overrides: Partial<HostRuntimeStatus> = {},
): HostRuntimeStatus =>
  structuredClone({
    kind: "opencode",
    enabled: true,
    configuredExecutablePath: "",
    effectiveExecutablePath: null,
    version: null,
    state: "ready",
    trigger: "host_startup",
    runtimeId: `${overrides.kind ?? "opencode"}-runtime-1`,
    startedAt: "2026-02-22T08:00:00.000Z",
    updatedAt: "2026-02-22T08:00:00.000Z",
    failure: null,
    revision: 1,
    ...overrides,
  } satisfies HostRuntimeStatus);

/** Every known kind is ready unless `statusByKind` replaces the map. */
export const createHostRuntimeStatusContextValue = (
  overrides: Partial<HostRuntimeStatusContextValue> = {},
): HostRuntimeStatusContextValue => {
  const statusByKind: HostRuntimeStatusMap = overrides.statusByKind ?? {
    opencode: createHostRuntimeStatusFixture({ kind: "opencode" }),
    codex: createHostRuntimeStatusFixture({ kind: "codex" }),
    claude: createHostRuntimeStatusFixture({ kind: "claude" }),
  };
  return {
    snapshot: {
      hostInstanceId: "host-1",
      runtimes: Object.values(statusByKind).filter((status) => status !== undefined),
      mcpBridge: createHostMcpBridgeStatusFixture(),
    },
    isCurrent: true,
    isLoading: false,
    readError: null,
    streamError: null,
    isRefreshing: false,
    refresh: async () => {},
    runtimeEvents: {
      subscribeEvents: () => () => {},
      getStreamHealth: () => ({ error: null, epoch: 0 }),
    },
    ...overrides,
    statusByKind,
  };
};

/**
 * A workspace activity observer that reports fixed states.
 *
 * The state objects are stable per workspace, which `useSyncExternalStore`
 * requires.
 */
export const createWorkspaceActivityObserverStub = (
  states: Readonly<Record<string, WorkspaceActivityState>> = {},
  liveStates: Readonly<Record<string, WorkspaceSessionLiveState>> = {},
): WorkspaceActivityObserver => {
  const liveSnapshot = {
    statesByWorkspaceId: new Map(Object.entries(liveStates)),
    sessionRecordsError: null,
  };
  return {
    syncWorkspaces: () => {},
    setSessionRecordsError: () => {},
    subscribe: () => () => {},
    getWorkspaceActivity: (workspaceId) => states[workspaceId] ?? UNKNOWN_WORKSPACE_ACTIVITY,
    getSessionLiveSnapshot: () => liveSnapshot,
    getWorkspaceProjection: () => null,
    dispose: () => {},
  };
};

/** Task workflow actions that do nothing, for views that only need the action context. */
export const createTaskWorkflowActionsFixture = (
  overrides: Partial<TaskWorkflowActions> = {},
): TaskWorkflowActions => ({
  onCreateTask: () => {},
  onPlan: () => {},
  onQaStart: () => {},
  onQaOpen: () => {},
  onBuild: () => {},
  onOpenSession: () => {},
  onDelegate: () => {},
  onEdit: () => {},
  onHumanApprove: () => {},
  onHumanRequestChanges: () => {},
  onResetImplementation: () => {},
  onResetTask: async () => {},
  onCloseTask: async () => {},
  onDelete: async () => {},
  onDetectPullRequest: () => {},
  onUnlinkPullRequest: () => {},
  detectingPullRequestTaskId: null,
  unlinkingPullRequestTaskId: null,
  gitProviderContext: undefined,
  gitProviderReadError: null,
  registerTaskDetailsClose: () => () => {},
  taskSessionsByTaskId: new Map(),
  activeTaskSessionContextByTaskId: new Map(),
  ...overrides,
});

export const createObservedCheckFixture = <T>(
  overrides: Partial<ObservedCheck<T>> = {},
): ObservedCheck<T> => ({
  data: null,
  error: null,
  failureKind: null,
  observedAt: null,
  ...overrides,
});

export const createChecksStateFixture = (
  overrides: Partial<ChecksStateContextValue> = {},
): ChecksStateContextValue => ({
  runtimeCheck: createObservedCheckFixture(),
  checksRepoPath: null,
  taskStoreCheck: createObservedCheckFixture(),
  isRefreshingChecks: false,
  refreshChecks: async () => undefined,
  ...overrides,
});

export const createWorkspaceRecordFixture = (
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord => ({
  workspaceId: "workspace-1",
  workspaceName: "OpenDucktor",
  abbreviation: null,
  tileColor: null,
  repoPath: "/repo",
  iconDataUrl: undefined,
  isActive: true,
  hasConfig: true,
  configuredWorktreeBasePath: null,
  defaultWorktreeBasePath: null,
  effectiveWorktreeBasePath: null,
  ...overrides,
});

/** Workspace state with one active workspace. Operations do nothing unless a test overrides them. */
export const createWorkspaceStateFixture = (
  overrides: Partial<WorkspaceStateContextValue> = {},
): WorkspaceStateContextValue => {
  const activeWorkspace = createWorkspaceRecordFixture();
  return {
    isSwitchingWorkspace: false,
    closedWorkspaces: [],
    incompleteRemovals: [],
    closeWorkspace: async () => {},
    removeWorkspace: async () => {},
    reopenWorkspace: async () => {},
    resolveWorkspacePath: async () => ({ kind: "new" }),
    isLoadingBranches: false,
    isSwitchingBranch: false,
    branchSyncDegraded: false,
    workspaces: [activeWorkspace],
    activeWorkspace,
    branches: [],
    activeBranch: null,
    addWorkspace: async () => {
      throw new Error("addWorkspace is not configured for this test.");
    },
    commitWorkspaceProviderSetup: async () => {
      throw new Error("commitWorkspaceProviderSetup is not configured for this test.");
    },
    saveWorkspaceModelDefaults: async () => {},
    selectWorkspace: async () => {},
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("loadRepoSettings is not configured for this test.");
    },
    saveRepoSettings: async () => {},
    loadSettingsSnapshot: async () => createSettingsSnapshotFixture(),
    detectGithubRepository: async () => null,
    saveGlobalGitConfig: async () => {},
    previewSettingsSnapshotRuntime: async () => {
      throw new Error("previewSettingsSnapshotRuntime is not configured for this test.");
    },
    saveSettingsSnapshot: async () => savedSettingsResult(),
    saveAgentModelFavorites: async () => {
      throw new Error("saveAgentModelFavorites is not configured for this test.");
    },
    ...overrides,
  };
};
