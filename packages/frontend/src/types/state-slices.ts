import type {
  AgentModelFavorite,
  GitBranch,
  GitCurrentBranch,
  GitProviderRepository,
  GitTargetBranch,
  GlobalGitConfig,
  GitCheck,
  PathCheck,
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
import type { RepoAgentDefaultRole, ModelDefaultDraft } from "@/lib/repo-agent-defaults";
import type { ObservedCheck } from "@openducktor/frontend-core/types/diagnostics";
import type { RepoSettingsInput } from "@openducktor/frontend-core/types/session-slices";
import type { TaskPullRequestOperations } from "./task-pull-request";

export type {
  ActiveWorkspace,
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  AgentSessionReadModelStateContextValue,
  HostRuntimeEventListener,
  HostRuntimeEvents,
  HostRuntimeStatusContextValue,
  HostRuntimeStreamHealth,
  RepoAgentDefaultInput,
  RepoSettingsInput,
} from "@openducktor/frontend-core/types/session-slices";

export type WorkspaceSelectionOperationsInput = {
  workspaceId: string;
  workspaceName: string;
  repoPath: string;
  abbreviation?: string;
  tileColor?: string;
};

export type WorkspaceModelDefaultsDraft = {
  defaultModel?: ModelDefaultDraft | undefined;
  agentDefaults: Partial<Record<RepoAgentDefaultRole, ModelDefaultDraft | undefined>>;
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
  /** True when the open and closed workspace lists both loaded and neither list is fetching. */
  workspaceRecordsAreCurrent: boolean;
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

export type TasksStateContextValue = TaskPullRequestOperations & {
  tasksAreCurrent: boolean;
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  refreshTasks: () => Promise<void>;
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
  saveSpecArtifact: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
  savePlanArtifact: (taskId: string, markdown: string) => Promise<{ updatedAt: string }>;
};

/**
 * The host result of a settings save. A written save keeps its runtime application results when
 * the local cache reload fails. `refreshError` reports that failure.
 */
export type SettingsSaveOutcome =
  | (Extract<SettingsSnapshotSaveResult, { type: "saved" }> & { refreshError: string | null })
  | Extract<SettingsSnapshotSaveResult, { type: "runtime_impact_changed" }>;
