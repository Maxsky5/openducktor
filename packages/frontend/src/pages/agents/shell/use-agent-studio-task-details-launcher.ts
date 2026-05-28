import { type ComponentProps, type RefObject, useCallback, useMemo, useRef } from "react";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type {
  TaskDetailsSheetController,
  TaskDetailsSheetControllerHandle,
} from "@/components/features/task-details/task-details-sheet-controller";
import type { useTasksState, useWorkspaceState } from "@/state/app-state-provider";

type UseAgentStudioTaskDetailsLauncherArgs = {
  activeWorkspace: ReturnType<typeof useWorkspaceState>["activeWorkspace"];
  tasks: ReturnType<typeof useTasksState>["tasks"];
  selectedTaskId: string | null;
  detectingPullRequestTaskId: ReturnType<typeof useTasksState>["detectingPullRequestTaskId"];
  unlinkingPullRequestTaskId: ReturnType<typeof useTasksState>["unlinkingPullRequestTaskId"];
  onDetectPullRequest: (taskId: string) => void;
  onUnlinkPullRequest: (taskId: string) => void;
};

export type AgentStudioTaskDetailsSheetProps = Omit<
  ComponentProps<typeof TaskDetailsSheetController>,
  "ref"
>;

export type AgentStudioTaskDetailsLauncherModel = {
  openTaskDetails: () => void;
  taskDetailsSheetRef: RefObject<TaskDetailsSheetControllerHandle | null>;
  taskDetailsSheetProps: AgentStudioTaskDetailsSheetProps;
};

const EMPTY_TASK_SESSIONS_BY_TASK_ID = new Map<string, KanbanTaskSession[]>();
const EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID: ActiveTaskSessionContextByTaskId = new Map();

export function useAgentStudioTaskDetailsLauncher({
  activeWorkspace,
  tasks,
  selectedTaskId,
  detectingPullRequestTaskId,
  unlinkingPullRequestTaskId,
  onDetectPullRequest,
  onUnlinkPullRequest,
}: UseAgentStudioTaskDetailsLauncherArgs): AgentStudioTaskDetailsLauncherModel {
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);

  const openTaskDetails = useCallback((): void => {
    if (!selectedTaskId) {
      return;
    }
    taskDetailsSheetRef.current?.openTask(selectedTaskId);
  }, [selectedTaskId]);

  const taskDetailsSheetProps = useMemo<AgentStudioTaskDetailsSheetProps>(
    () => ({
      activeWorkspace,
      allTasks: tasks,
      taskSessionsByTaskId: EMPTY_TASK_SESSIONS_BY_TASK_ID,
      activeTaskSessionContextByTaskId: EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID,
      workflowActionsEnabled: false,
      onOpenSession: () => undefined,
      onDetectPullRequest,
      onUnlinkPullRequest,
      detectingPullRequestTaskId,
      unlinkingPullRequestTaskId,
    }),
    [
      activeWorkspace,
      detectingPullRequestTaskId,
      onDetectPullRequest,
      onUnlinkPullRequest,
      tasks,
      unlinkingPullRequestTaskId,
    ],
  );

  return useMemo(
    () => ({
      openTaskDetails,
      taskDetailsSheetRef,
      taskDetailsSheetProps,
    }),
    [openTaskDetails, taskDetailsSheetProps],
  );
}
