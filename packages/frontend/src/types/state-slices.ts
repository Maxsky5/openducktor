import type {
  AgentSessionRecord,
  GitBranch,
  GitCurrentBranch,
  GitProviderRepository,
  GitTargetBranch,
  GlobalGitConfig,
  PullRequest,
  RepoDevServerScript,
  RuntimeApprovalReplyOutcome,
  RuntimeCheck,
  RuntimeKind,
  SettingsSnapshot,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskStoreCheck,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type {
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentUserMessagePart,
} from "@openducktor/core";
import type { SessionRepoReadinessState } from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type {
  AgentSessionLoadOptions,
  AgentSessionState,
  EnsureSessionReadyForViewResult,
  InitialSessionStatusReleasePolicy,
} from "./agent-orchestrator";
import type { RepoRuntimeFailureKind, RepoRuntimeHealthMap } from "./diagnostics";

export type WorkspaceSelectionOperationsInput = {
  workspaceId: string;
  workspaceName: string;
  repoPath: string;
};

export type ActiveWorkspace = Pick<WorkspaceRecord, "workspaceId" | "workspaceName" | "repoPath">;

export type RepoAgentDefaultInput = {
  runtimeKind?: RuntimeKind | null;
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
  preStartHooks: string[];
  postCompleteHooks: string[];
  devServers: RepoDevServerScript[];
  /** Paths copied from the main repo into a new worktree on creation. */
  worktreeCopyPaths: string[];
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
  activeWorkspace: WorkspaceRecord | null;
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<void>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string) => Promise<void>;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  saveGlobalGitConfig: (git: GlobalGitConfig) => Promise<void>;
  saveSettingsSnapshot: (snapshot: SettingsSnapshot) => Promise<void>;
};

export type WorkspaceBranchStateContextValue = Pick<
  WorkspaceStateContextValue,
  | "activeWorkspace"
  | "branches"
  | "activeBranch"
  | "isSwitchingWorkspace"
  | "isLoadingBranches"
  | "isSwitchingBranch"
  | "branchSyncDegraded"
  | "switchBranch"
>;

export type WorkspacePresenceContextValue = {
  hasWorkspaces: boolean;
};

export type ChecksStateContextValue = {
  runtimeCheck: RuntimeCheck | null;
  taskStoreCheck: TaskStoreCheck | null;
  runtimeCheckFailureKind: RepoRuntimeFailureKind;
  taskStoreCheckFailureKind: RepoRuntimeFailureKind;
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type TasksStateContextValue = {
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  detectingPullRequestTaskId: string | null;
  linkingMergedPullRequestTaskId: string | null;
  unlinkingPullRequestTaskId: string | null;
  pendingMergedPullRequest: {
    taskId: string;
    pullRequest: PullRequest;
  } | null;
  tasks: TaskCard[];
  refreshTasks: () => Promise<void>;
  syncPullRequests: (taskId: string) => Promise<void>;
  linkMergedPullRequest: () => Promise<void>;
  cancelLinkMergedPullRequest: () => void;
  unlinkPullRequest: (taskId: string) => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  updateTask: (taskId: string, patch: TaskUpdatePatch) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  deleteTask: (taskId: string, deleteSubtasks?: boolean) => Promise<void>;
  resetTaskImplementation: (taskId: string) => Promise<void>;
  resetTask: (taskId: string) => Promise<void>;
  transitionTask: (taskId: string, status: TaskStatus, reason?: string) => Promise<void>;
  humanApproveTask: (taskId: string) => Promise<void>;
  humanRequestChangesTask: (taskId: string, note?: string) => Promise<void>;
};

export type DelegationStateContextValue = {
  delegateTask: (taskId: string) => Promise<void>;
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

export type AgentSessionReadModelStateContextValue = {
  sessionReadModelError: string | null;
};

export type AgentOperationsContextValue = {
  loadRequestedTaskSessionHistory: (input: {
    taskId: string;
    externalSessionId: string;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<void>;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
  }) => Promise<EnsureSessionReadyForViewResult>;
  loadAgentSessions: (taskId: string, options?: AgentSessionLoadOptions) => Promise<void>;
  readSessionModelCatalog: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentModelCatalog>;
  readSessionTodos: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    externalSessionId: string,
  ) => Promise<AgentSessionHistoryMessage[]>;
  readSessionSlashCommands: (
    repoPath: string,
    runtimeKind: RuntimeKind,
  ) => Promise<AgentSlashCommandCatalog>;
  readSessionSkills?: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
  ) => Promise<AgentSkillCatalog>;
  readSessionFileSearch: (
    repoPath: string,
    runtimeKind: RuntimeKind,
    workingDirectory: string,
    query: string,
  ) => Promise<AgentFileSearchResult[]>;
  removeAgentSession: (externalSessionId: string) => Promise<void>;
  removeAgentSessions: (input: { taskId: string; roles?: AgentRole[] }) => Promise<void>;
  startAgentSession: (
    input:
      | {
          taskId: string;
          role: AgentRole;
          runtimeKind?: RuntimeKind;
          startMode: "reuse";
          sourceExternalSessionId: string;
        }
      | {
          taskId: string;
          role: AgentRole;
          runtimeKind?: RuntimeKind;
          selectedModel: AgentModelSelection;
          startMode: "fresh";
          targetWorkingDirectory?: string | null;
          initialStatusRelease?: InitialSessionStatusReleasePolicy;
        }
      | {
          taskId: string;
          role: AgentRole;
          runtimeKind?: RuntimeKind;
          selectedModel: AgentModelSelection;
          startMode: "fork";
          sourceExternalSessionId: string;
          initialStatusRelease?: InitialSessionStatusReleasePolicy;
        },
  ) => Promise<string>;
  settleStartedAgentSession: (externalSessionId: string) => void;
  sendAgentMessage: (externalSessionId: string, parts: AgentUserMessagePart[]) => Promise<void>;
  stopAgentSession: (externalSessionId: string) => Promise<void>;
  updateAgentSessionModel: (
    externalSessionId: string,
    selection: AgentModelSelection | null,
  ) => void;
  replyAgentApproval: (
    externalSessionId: string,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    externalSessionId: string,
    requestId: string,
    answers: string[][],
  ) => Promise<void>;
};

export type AgentStateContextValue = AgentSessionReadModelStateContextValue &
  AgentOperationsContextValue & {
    sessions: AgentSessionState[];
  };
