import {
  createTaskActionRunner,
  type TaskActionRunnerHandlers,
} from "@openducktor/frontend-core/tasks/workflow/task-action-runner";
import type { TaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import {
  createObservedCheckFixture,
  createWireTaskCardFixture,
  createWorkspaceRecordFixture,
} from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import { savedSettingsResult } from "@/test-utils/settings-save-fixtures";
import type { TasksStateContextValue } from "@openducktor/frontend-core/types/state-slices";
import {
  SPEC_PLAN_BUILD_BOARD,
  type KanbanColumn,
  type ResolvedTaskCard,
} from "@openducktor/workflows";
import type {
  ChecksStateContextValue,
  WorkspacePresenceContextValue,
  WorkspaceStateContextValue,
} from "@/types/state-slices";

export * from "@openducktor/frontend-core/test-support/shared-test-fixtures";

/** A column of the built-in board with its tasks. Explicit fields win. */
export const createKanbanColumnFixture = (
  id: string,
  tasks: ResolvedTaskCard[] = [],
  overrides: Partial<Omit<KanbanColumn, "id" | "tasks">> = {},
): KanbanColumn => {
  const state = SPEC_PLAN_BUILD_BOARD.states.find((candidate) => candidate.id === id);
  if (!state) throw new Error(`The built-in board has no state "${id}".`);
  return { ...state, ...overrides, id, tasks };
};

/**
 * Task workflow actions that do nothing, for views that only need the action context. The shared
 * runner calls the context handlers of the fixture and the given runner handlers.
 */
export const createTaskWorkflowActionsFixture = (
  overrides: Partial<TaskWorkflowActions> = {},
  runner: Partial<TaskActionRunnerHandlers> = {},
): TaskWorkflowActions => {
  const actions: TaskWorkflowActions = {
    runAction: (task, action, options) =>
      createTaskActionRunner({
        onLaunch: actions.onLaunch,
        onApplyEvent: () => {},
        onOpenTaskDetails: actions.onOpenTaskDetails,
        onOpenSession: actions.onOpenSession,
        onHumanApprove: () => {},
        onHumanFeedback: () => {},
        onConfirm: (taskId, confirmation) => {
          if (confirmation !== "reset_implementation")
            actions.onConfirmTaskAction(taskId, confirmation);
        },
        continueTaskWorkflow: async () => {},
        showError: (title, description) => {
          throw new Error(`${title}: ${description}`);
        },
        ...runner,
      })(task, action, options),
    onLaunch: () => {},
    onCreateTask: () => {},
    onOpenSession: () => {},
    onEdit: () => {},
    onOpenTaskDetails: () => {},
    onResetTask: async (taskId) => createWireTaskCardFixture({ id: taskId }),
    onCloseTask: async (taskId) => createWireTaskCardFixture({ id: taskId, status: "closed" }),
    onRemoveTaskWorktree: async () => {},
    onDelete: async () => {},
    onConfirmTaskAction: () => {},
    onDetectPullRequest: () => {},
    onUnlinkPullRequest: () => {},
    detectingPullRequestTaskIds: new Set<string>(),
    unlinkingPullRequestTaskIds: new Set<string>(),
    gitProviderContext: undefined,
    gitProviderReadError: null,
    registerTaskDetailsClose: () => () => {},
    claimWorkflowDialog: (_owner, run) => run(),
    taskSessionsByTaskId: new Map(),
    activeTaskSessionContextByTaskId: new Map(),
    ...overrides,
  };
  return actions;
};

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
  closeTask: async (taskId) => createWireTaskCardFixture({ id: taskId, status: "closed" }),
  removeTaskWorktree: async () => undefined,
  resetTaskImplementation: async (taskId) => createWireTaskCardFixture({ id: taskId }),
  resetTask: async (taskId) => createWireTaskCardFixture({ id: taskId }),
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
    commitWorkspaceProviderSetup: async () => {
      throw new Error("commitWorkspaceProviderSetup is not configured for this test.");
    },
    selectWorkspace: async () => {},
    reorderWorkspaces: async () => {},
    refreshBranches: async () => {},
    switchBranch: async () => {},
    loadRepoSettings: async () => {
      throw new Error("loadRepoSettings is not configured for this test.");
    },
    detectGithubRepository: async () => null,
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
