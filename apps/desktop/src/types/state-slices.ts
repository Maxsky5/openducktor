import type { BuildRespondInput } from "@openducktor/adapters-tauri-host";
import type {
  BeadsCheck,
  GitBranch,
  GitCurrentBranch,
  GitProviderRepository,
  GitTargetBranch,
  GlobalGitConfig,
  PullRequest,
  RepoDevServerScript,
  RunEvent,
  RunSummary,
  RuntimeCheck,
  RuntimeKind,
  SettingsSnapshot,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type {
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentRuntimeConnection,
  AgentScenario,
  AgentSessionStartMode,
  AgentSessionTodoItem,
} from "@openducktor/core";
import type { AgentSessionLoadOptions, AgentSessionState } from "./agent-orchestrator";
import type { RepoRuntimeHealthMap } from "./diagnostics";

export type RepoAgentDefaultInput = {
  runtimeKind?: RuntimeKind;
  providerId: string;
  modelId: string;
  variant: string;
  profileId: string;
};

export type RepoSettingsInput = {
  defaultRuntimeKind: RuntimeKind;
  worktreeBasePath: string;
  branchPrefix: string;
  /** Default branch used for ahead/behind comparison, rebase, and PR creation. */
  defaultTargetBranch: GitTargetBranch;
  trustedHooks: boolean;
  preStartHooks: string[];
  postCompleteHooks: string[];
  devServers: RepoDevServerScript[];
  /** Files copied from the main repo into a new worktree on creation. */
  worktreeFileCopies: string[];
  agentDefaults: {
    spec: RepoAgentDefaultInput | null;
    planner: RepoAgentDefaultInput | null;
    build: RepoAgentDefaultInput | null;
    qa: RepoAgentDefaultInput | null;
  };
};

export type WorkspaceStateContextValue = {
  isSwitchingWorkspace: boolean;
  isLoadingBranches: boolean;
  isSwitchingBranch: boolean;
  branchSyncDegraded: boolean;
  workspaces: WorkspaceRecord[];
  activeRepo: string | null;
  activeWorkspace: WorkspaceRecord | null;
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  addWorkspace: (repoPath: string) => Promise<void>;
  selectWorkspace: (repoPath: string) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  saveGlobalGitConfig: (git: GlobalGitConfig) => Promise<void>;
  saveSettingsSnapshot: (snapshot: SettingsSnapshot) => Promise<void>;
};

export type ChecksStateContextValue = {
  runtimeCheck: RuntimeCheck | null;
  beadsCheck: BeadsCheck | null;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type TasksStateContextValue = {
  isLoadingTasks: boolean;
  detectingPullRequestTaskId: string | null;
  linkingMergedPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
  pendingMergedPullRequest: {
    taskId: string;
    pullRequest: PullRequest;
  } | null;
  tasks: TaskCard[];
  runs: RunSummary[];
  refreshTasks: () => Promise<void>;
  syncPullRequests: (taskId: string) => Promise<void>;
  linkMergedPullRequest: () => Promise<void>;
  cancelLinkMergedPullRequest: () => void;
  unlinkPullRequest: (taskId: string) => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  deleteTask: (taskId: string, deleteSubtasks?: boolean) => Promise<void>;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  deferTask: (taskId: string) => Promise<void>;
  resumeDeferredTask: (taskId: string) => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
};

export type DelegationStateContextValue = {
  events: RunEvent[];
  delegateTask: (taskId: string) => Promise<void>;
  delegateRespond: (runId: string, input: BuildRespondInput) => Promise<void>;
  delegateStop: (runId: string) => Promise<void>;
  delegateCleanup: (runId: string, mode: "success" | "failure") => Promise<void>;
};

export type SpecStateContextValue = {
  loadSpec: (taskId: string) => Promise<string>;
  loadSpecDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadPlanDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  loadQaReportDocument: (taskId: string) => Promise<{ markdown: string; updatedAt: string | null }>;
  saveSpec: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  saveSpecDocument: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  savePlanDocument: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};

export type AgentStateContextValue = {
  sessions: AgentSessionState[];
  bootstrapTaskSessions: (
    taskId: string,
    persistedRecords?: import("@openducktor/contracts").AgentSessionRecord[],
  ) => Promise<void>;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
    persistedRecords?: import("@openducktor/contracts").AgentSessionRecord[];
  }) => Promise<void>;
  reconcileLiveTaskSessions: (input: {
    taskId: string;
    persistedRecords?: import("@openducktor/contracts").AgentSessionRecord[];
    preloadedRuns?: import("@openducktor/contracts").RunSummary[];
    preloadedRuntimeLists?: Map<
      import("@openducktor/contracts").RuntimeKind,
      import("@openducktor/contracts").RuntimeInstanceSummary[]
    >;
    preloadedRuntimeConnectionsByKey?: Map<
      string,
      import("@openducktor/core").AgentRuntimeConnection
    >;
    preloadedLiveAgentSessionsByKey?: Map<
      string,
      import("@openducktor/core").LiveAgentSessionSnapshot[]
    >;
    allowRuntimeEnsure?: boolean;
  }) => Promise<void>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  readSessionModelCatalog: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    runtimeKind: RuntimeKind,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentRole[] }) => void;
  startAgentSession: (input: {
    taskId: string;
    role: AgentRole;
    runtimeKind?: RuntimeKind;
    scenario?: AgentScenario;
    selectedModel?: AgentModelSelection | null;
    sendKickoff?: boolean;
    startMode?: AgentSessionStartMode;
    reuseSessionId?: string | null;
    requireModelReady?: boolean;
    workingDirectoryOverride?: string | null;
    builderContext?: {
      sessionId?: string | null;
      workingDirectory: string;
    } | null;
  }) => Promise<string>;
  forkAgentSession: (input: {
    parentSessionId: string;
    selectedModel?: AgentModelSelection | null;
  }) => Promise<string>;
  sendAgentMessage: (sessionId: string, content: string) => Promise<void>;
  stopAgentSession: (sessionId: string) => Promise<void>;
  updateAgentSessionModel: (sessionId: string, selection: AgentModelSelection | null) => void;
  replyAgentPermission: (
    sessionId: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>;
};
