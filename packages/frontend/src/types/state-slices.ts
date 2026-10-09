import type {
  AgentModelFavorite,
  GitBranch,
  GitCurrentBranch,
  GitProviderRepository,
  GitTargetBranch,
  GlobalGitConfig,
  PullRequest,
  RepoActions,
  RuntimeApprovalReplyOutcome,
  HostRuntimeEvent,
  GitCheck,
  PathCheck,
  RuntimeKind,
  SettingsRepoConfig,
  SettingsSnapshot,
  SettingsSnapshotRuntimePreview,
  SettingsSnapshotSaveInput,
  SettingsSnapshotSaveResult,
  TaskAssetDescriptionMutation,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskStoreCheck,
  IncompleteWorkspaceRemoval,
  TaskUpdatePatch,
  WorkspacePathResolution,
  WorkspaceRecord,
  WorkspaceLifecycleTargetInput,
  WorkspaceRemovalInput,
  WorkspaceProviderSetupCommit,
  WorkspaceProviderSetupProgress,
} from "@openducktor/contracts";
import type {
  AgentModelSelection,
  AgentSessionScope,
  AgentSessionHistoryMessage,
  AgentSessionTodoItem,
  AgentUserMessagePart,
  LoadAgentSessionHistoryInput,
  PolicyBoundSessionRef,
} from "@openducktor/core";
import type {
  AgentMessageSendOptions,
  AgentMessageSendReceipt,
  AgentApprovalRequest,
  AgentQuestionRequest,
  AgentSessionContextLoadTarget,
  AgentSessionIdentity,
  AgentSessionState,
} from "./agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "./agent-session-read-model";
import type { StartAgentSessionInput, StartAgentSessionResult } from "./agent-session-start";
import type { AgentSessionTransientFault } from "./agent-session-transient-fault";
import type { HostRuntimeStatusMap, HostStatusSnapshot, ObservedCheck } from "./diagnostics";

export type WorkspaceSelectionOperationsInput = {
  workspaceId: string;
  workspaceName: string;
  repoPath: string;
  abbreviation?: string;
  tileColor?: string;
};

export type ActiveWorkspace = Pick<WorkspaceRecord, "workspaceId" | "workspaceName" | "repoPath">;

export type RepoAgentDefaultInput = {
  runtimeKind?: RuntimeKind | null;
  providerId: string;
  modelId: string;
  variant: string;
  profileId: string;
};

export type WorkspaceModelDefaultsDraft = Pick<
  SettingsRepoConfig,
  "defaultModel" | "agentDefaults"
>;

export type RepoSettingsInput = {
  defaultModel: RepoAgentDefaultInput | null;
  worktreeBasePath: string;
  branchPrefix: string;
  /** Default branch used for ahead/behind comparison, rebase, and PR creation. */
  defaultTargetBranch: GitTargetBranch;
  postCompleteHooks: string[];
  actions: RepoActions;
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
  closedWorkspaces: WorkspaceRecord[];
  incompleteRemovals: IncompleteWorkspaceRemoval[];
  activeWorkspace: WorkspaceRecord | null;
  branches: GitBranch[];
  activeBranch: GitCurrentBranch | null;
  addWorkspace: (input: WorkspaceSelectionOperationsInput) => Promise<WorkspaceRecord>;
  commitWorkspaceProviderSetup: (
    input: WorkspaceProviderSetupCommit,
  ) => Promise<WorkspaceProviderSetupProgress>;
  saveWorkspaceModelDefaults: (
    workspaceId: string,
    draft: WorkspaceModelDefaultsDraft,
  ) => Promise<void>;
  selectWorkspace: (workspaceId: string, onSelected?: () => void) => Promise<void>;
  closeWorkspace: (input: WorkspaceLifecycleTargetInput) => Promise<void>;
  removeWorkspace: (input: WorkspaceRemovalInput) => Promise<void>;
  reopenWorkspace: (input: WorkspaceLifecycleTargetInput) => Promise<void>;
  resolveWorkspacePath: (repoPath: string) => Promise<WorkspacePathResolution>;
  reorderWorkspaces: (workspaceIds: string[]) => Promise<void>;
  refreshBranches: (force?: boolean) => Promise<void>;
  switchBranch: (branchName: string, onSwitched?: () => void) => Promise<void>;
  loadRepoSettings: () => Promise<RepoSettingsInput>;
  saveRepoSettings: (input: RepoSettingsInput) => Promise<void>;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
  detectGithubRepository: (repoPath: string) => Promise<GitProviderRepository | null>;
  saveGlobalGitConfig: (git: GlobalGitConfig) => Promise<void>;
  /** Validates a save and returns the live sessions it would stop. It writes nothing. */
  previewSettingsSnapshotRuntime: (
    snapshot: SettingsSnapshotSaveInput,
  ) => Promise<SettingsSnapshotRuntimePreview>;
  saveSettingsSnapshot: (
    snapshot: SettingsSnapshotSaveInput,
    runtimeConfirmation?: string,
  ) => Promise<SettingsSaveOutcome>;
  saveAgentModelFavorites: (favorites: AgentModelFavorite[]) => Promise<SettingsSnapshot>;
};

export type WorkspaceBranchStateContextValue = Pick<
  WorkspaceStateContextValue,
  | "activeWorkspace"
  | "branches"
  | "activeBranch"
  | "isLoadingBranches"
  | "isSwitchingBranch"
  | "branchSyncDegraded"
  | "switchBranch"
>;

export type WorkspacePresenceContextValue = {
  hasWorkspaces: boolean;
  hasLoadedWorkspaceList: boolean;
  isLoadingWorkspaces: boolean;
  workspaceLoadError: Error | null;
  retryWorkspaces: () => Promise<void>;
};

export type ChecksStateContextValue = {
  pathCheck: ObservedCheck<PathCheck>;
  gitCheck: ObservedCheck<GitCheck>;
  /** The selected workspace repository that the task store check below describes. */
  checksRepoPath: string | null;
  taskStoreCheck: ObservedCheck<TaskStoreCheck>;
  isRefreshingChecks: boolean;
  /** Reruns host checks and, when a workspace is selected, workspace checks. Never starts a runtime. */
  refreshChecks: () => Promise<void>;
};

/** The health of live host runtime updates. */
export type HostRuntimeStreamHealth = {
  /** Live runtime updates are unavailable. */
  error: string | null;
  /** Changes each time live updates fail or recover. */
  epoch: number;
};

export type HostRuntimeEventListener = {
  onEvent: (event: HostRuntimeEvent) => void;
  /** Live updates failed or recovered. `getStreamHealth` returns the new state. */
  onStreamChange: () => void;
};

/** The host runtime event stream. The host runtime status owner is its only subscriber. */
export type HostRuntimeEvents = {
  subscribeEvents: (listener: HostRuntimeEventListener) => () => void;
  getStreamHealth: () => HostRuntimeStreamHealth;
};

export type HostRuntimeStatusContextValue = {
  snapshot: HostStatusSnapshot | null;
  statusByKind: HostRuntimeStatusMap;
  /** True only with live updates and a successful baseline read. */
  isCurrent: boolean;
  isLoading: boolean;
  readError: string | null;
  streamError: string | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  runtimeEvents: HostRuntimeEvents;
};

export type TasksStateContextValue = {
  tasksAreCurrent: boolean;
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
  createTask: (input: TaskCreateInput, assets?: TaskAssetDescriptionMutation) => Promise<void>;
  updateTask: (
    taskId: string,
    patch: TaskUpdatePatch,
    assets?: TaskAssetDescriptionMutation,
  ) => Promise<void>;
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
  workspaceSessionRecordsError: string | null;
  reloadSessionReadModel: () => void;
  getSessionFault: (session: AgentSessionIdentity | null) => AgentSessionTransientFault | null;
};

export type AgentSessionHistoryLoadContextValue = {
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
};

export type AgentOperationsContextValue = {
  describeGeneratedImages: import("@openducktor/core").AgentEnginePort["describeGeneratedImages"];
  beginGeneratedImageBatch: import("@openducktor/core").AgentEnginePort["beginGeneratedImageBatch"];
  releaseGeneratedImageBatch: import("@openducktor/core").AgentEnginePort["releaseGeneratedImageBatch"];
  readGeneratedImage: import("@openducktor/core").AgentEnginePort["readGeneratedImage"];
  readSessionTodos: (session: PolicyBoundSessionRef) => Promise<AgentSessionTodoItem[]>;
  readSessionHistory: (
    session: LoadAgentSessionHistoryInput,
  ) => Promise<AgentSessionHistoryMessage[]>;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<AgentSessionState | null>;
  loadAgentSessionContext: (session: AgentSessionContextLoadTarget) => Promise<void>;
  startAgentSession: (input: StartAgentSessionInput) => Promise<StartAgentSessionResult>;
  sendAgentMessage: (
    session: AgentSessionIdentity,
    parts: AgentUserMessagePart[],
    options?: AgentMessageSendOptions,
  ) => Promise<AgentMessageSendReceipt | null>;
  stopAgentSession: (session: AgentSessionIdentity) => Promise<void>;
  continueInterruptedTurn: (session: AgentSessionIdentity) => Promise<void>;
  updateAgentSessionModel: (
    session: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ) => Promise<void>;
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
    sessionScope?: AgentSessionScope,
  ) => Promise<void>;
};

/**
 * The host result of a settings save. A written save keeps its runtime application results when
 * the local cache reload fails. `refreshError` reports that failure.
 */
export type SettingsSaveOutcome =
  | (Extract<SettingsSnapshotSaveResult, { type: "saved" }> & { refreshError: string | null })
  | Extract<SettingsSnapshotSaveResult, { type: "runtime_impact_changed" }>;
