import type {
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
  SettingsSnapshotSaveInput,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskStoreCheck,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentUserMessagePart,
  LoadAgentSessionHistoryInput,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import type {
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionContextLoadTarget,
  AgentSessionIdentity,
  AgentSessionState,
} from "./agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "./agent-session-read-model";
import type { StartAgentSessionInput, StartAgentSessionResult } from "./agent-session-start";
import type { AgentSessionTransientFault } from "./agent-session-transient-fault";
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
  saveSettingsSnapshot: (snapshot: SettingsSnapshotSaveInput) => Promise<void>;
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
  isLoadingChecks: boolean;
  refreshChecks: () => Promise<void>;
};

export type RepoRuntimeHealthContextValue = {
  runtimeHealthByRuntime: RepoRuntimeHealthMap;
  isLoadingRepoRuntimeHealth: boolean;
  refreshRepoRuntimeHealth: () => Promise<RepoRuntimeHealthMap>;
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
  closeTask: (taskId: string) => Promise<void>;
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
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  reloadSessionReadModel: () => void;
  getSessionFault: (session: AgentSessionIdentity | null) => AgentSessionTransientFault | null;
};

export type AgentSessionHistoryLoadContextValue = {
  loadSelectedSessionBaselineHistory: (
    session: AgentSessionIdentity,
  ) => Promise<AgentSessionState | null>;
};

export type AgentOperationsContextValue = {
  readSessionTodos: (session: PolicyBoundSessionRef) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  loadAgentSessionContext: (session: AgentSessionContextLoadTarget) => Promise<void>;
  startAgentSession: (input: StartAgentSessionInput) => Promise<StartAgentSessionResult>;
  sendAgentMessage: (session: AgentSessionIdentity, parts: AgentUserMessagePart[]) => Promise<void>;
  stopAgentSession: (session: AgentSessionIdentity) => Promise<void>;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => void;
  replyAgentApproval: (
    session: AgentSessionIdentity,
    request: AgentApprovalRequest,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  answerAgentQuestion: (
    session: AgentSessionIdentity,
    request: AgentQuestionRequest,
    answers: string[][],
  ) => Promise<void>;
};
