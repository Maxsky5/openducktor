import type {
  GitTargetBranch,
  TaskAssetDescriptionMutation,
  TaskCreateInput,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import type {
  BuiltinStateId as TaskStatus,
  BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import type { TaskPullRequestOperations } from "./task-pull-request";

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
  deleteTask: (taskId: string) => Promise<void>;
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

/** Reads and saves the workflow documents of the active workspace by artifact code. */
export type DocumentStateContextValue = {
  loadDocument: (
    taskId: string,
    code: string,
  ) => Promise<{ markdown: string; updatedAt: string | null }>;
  saveDocument: (taskId: string, code: string, markdown: string) => Promise<{ updatedAt: string }>;
};
