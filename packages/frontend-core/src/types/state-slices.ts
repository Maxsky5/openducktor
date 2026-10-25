import type {
  GitTargetBranch,
  TaskAssetDescriptionMutation,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
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
