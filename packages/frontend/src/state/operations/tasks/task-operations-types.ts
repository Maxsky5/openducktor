import type {
  GitTargetBranch,
  TaskAssetDescriptionMutation,
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import type { TaskRefreshOptions } from "@/state/app-state-contexts";
import type { AgentSessionReadPort } from "@openducktor/frontend-core/queries/agent-sessions";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { TaskPullRequestOperations } from "@/types/task-pull-request";

export type UseTaskOperationsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  agentSessionReadPort?: AgentSessionReadPort;
};

export type UseTaskOperationsResult = TaskPullRequestOperations & {
  tasks: TaskCard[];
  tasksAreCurrent: boolean;
  isForegroundLoadingTasks: boolean;
  isRefreshingTasksInBackground: boolean;
  isLoadingTasks: boolean;
  setIsLoadingTasks: (value: boolean) => void;
  clearTaskData: () => void;
  refreshTaskData: (repoPath: string, taskIdOrIds?: string | string[]) => Promise<void>;
  loadWorkspaceTasks: (repoPath: string) => Promise<void>;
  refreshTasksWithOptions: (options?: TaskRefreshOptions) => Promise<void>;
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
