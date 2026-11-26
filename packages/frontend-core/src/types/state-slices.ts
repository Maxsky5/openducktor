import type { TaskCard as WireTaskCard } from "@openducktor/contracts";
import type {
  GitTargetBranch,
  TaskAssetDescriptionMutation,
  TaskCreateInput,
  TaskUpdatePatch,
  WorkspaceRecord,
} from "@openducktor/contracts";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import type { CloseTaskOptions } from "./task-close";
import type { TaskPullRequestOperations } from "./task-pull-request";

/** The workspace that a new task goes to. Its name names it in the result message. */
export type TaskCreateWorkspace = Pick<
  WorkspaceRecord,
  "workspaceId" | "workspaceName" | "repoPath"
>;

export type TaskMutationCommands = {
  /** Creates the task in `workspace`, which can be a workspace other than the active one. */
  createTask: (
    workspace: TaskCreateWorkspace,
    input: TaskCreateInput,
    assets?: TaskAssetDescriptionMutation,
  ) => Promise<void>;
  updateTask: (
    taskId: string,
    patch: TaskUpdatePatch,
    assets?: TaskAssetDescriptionMutation,
  ) => Promise<void>;
  setTaskTargetBranch: (taskId: string, targetBranch: GitTargetBranch) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  closeTask: (taskId: string, options: CloseTaskOptions) => Promise<WireTaskCard>;
  /** Removes the worktree and local branches of a closed task. */
  removeTaskWorktree: (taskId: string) => Promise<void>;
};

export type TasksStateContextValue = TaskPullRequestOperations &
  TaskMutationCommands & {
    tasksAreCurrent: boolean;
    isForegroundLoadingTasks: boolean;
    isRefreshingTasksInBackground: boolean;
    isLoadingTasks: boolean;
    tasks: TaskCard[];
    refreshTasks: () => Promise<void>;
    resetTaskImplementation: (taskId: string, eventId: string) => Promise<WireTaskCard>;
    resetTask: (taskId: string) => Promise<WireTaskCard>;
  };

/** Reads and saves the workflow documents of the active workspace by artifact code. */
export type DocumentStateContextValue = {
  loadDocument: (
    taskId: string,
    code: string,
  ) => Promise<{ markdown: string; updatedAt: string | null }>;
  saveDocument: (taskId: string, code: string, markdown: string) => Promise<{ updatedAt: string }>;
};
