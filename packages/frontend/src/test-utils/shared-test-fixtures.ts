import type { TaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import {
  createObservedCheckFixture,
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
} from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";
import type { TasksStateContextValue } from "@openducktor/frontend-core/types/state-slices";
import type {
  ChecksStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

export * from "@openducktor/frontend-core/test-support/shared-test-fixtures";

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
  onOpenTaskDetails: () => {},
  onHumanApprove: () => {},
  onHumanRequestChanges: () => {},
  onResetImplementation: () => {},
  onResetTask: async () => {},
  onCloseTask: async () => {},
  onDelete: async () => {},
  onConfirmTaskAction: () => {},
  onDetectPullRequest: () => {},
  onUnlinkPullRequest: () => {},
  detectingPullRequestTaskIds: new Set<string>(),
  unlinkingPullRequestTaskIds: new Set<string>(),
  gitProviderContext: undefined,
  gitProviderReadError: null,
  registerTaskDetailsClose: () => () => {},
  taskSessionsByTaskId: new Map(),
  activeTaskSessionContextByTaskId: new Map(),
  ...overrides,
});

export const createChecksStateFixture = (
  overrides: Partial<ChecksStateContextValue> = {},
): ChecksStateContextValue => ({
  pathCheck: createObservedCheckFixture(),
  gitCheck: createObservedCheckFixture(),
  checksRepoPath: null,
  taskStoreCheck: createObservedCheckFixture(),
  isRefreshingChecks: false,
  refreshChecks: async () => undefined,
  ...overrides,
});

/** Current task state with no tasks. Operations do nothing unless a test overrides them. */
export const createTasksStateFixture = (
  overrides: Partial<TasksStateContextValue> = {},
): TasksStateContextValue => ({
  tasksAreCurrent: true,
  isForegroundLoadingTasks: false,
  isRefreshingTasksInBackground: false,
  isLoadingTasks: false,
  detectingPullRequestTaskIds: new Set<string>(),
  linkingMergedPullRequestTaskId: null,
  unlinkingPullRequestTaskIds: new Set<string>(),
  pendingMergedPullRequest: null,
  tasks: [],
  refreshTasks: async () => undefined,
  syncPullRequests: async () => undefined,
  linkMergedPullRequest: async () => undefined,
  cancelLinkMergedPullRequest: () => undefined,
  unlinkPullRequest: async () => undefined,
  createTask: async () => undefined,
  updateTask: async () => undefined,
  setTaskTargetBranch: async () => undefined,
  deleteTask: async () => undefined,
  closeTask: async () => undefined,
  resetTaskImplementation: async () => undefined,
  resetTask: async () => undefined,
  transitionTask: async () => undefined,
  humanApproveTask: async () => undefined,
  humanRequestChangesTask: async () => undefined,
  ...overrides,
});

/** Loaded and current workspace lists. */
export const createWorkspacePresenceFixture = (
  overrides: Partial<WorkspacePresenceContextValue> = {},
): WorkspacePresenceContextValue => ({
  hasWorkspaces: true,
  hasLoadedWorkspaceList: true,
  workspaceRecordsAreCurrent: true,
  isLoadingWorkspaces: false,
  workspaceLoadError: null,
  retryWorkspaces: async () => {},
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
