import type { AgentSessionRecord, RepositoryGitProviderContext } from "@openducktor/contracts";
import { type ComponentProps, type RefObject, useCallback, useMemo, useRef, useState } from "react";
import type {
  ActiveTaskSessionContextByTaskId,
  KanbanTaskSession,
} from "@/components/features/kanban/kanban-task-activity";
import type { TaskCreateModal } from "@/components/features/task-create/task-create-modal";
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
  gitProviderContext?: RepositoryGitProviderContext | undefined;
  gitProviderReadError?: string | null;
};

export type AgentStudioTaskDetailsSheetProps = Omit<
  ComponentProps<typeof TaskDetailsSheetController>,
  "ref"
>;

export type AgentStudioTaskDetailsLauncherModel = {
  taskEditor: ComponentProps<typeof TaskCreateModal> | null;
  openTaskDetails: () => void;
  taskDetailsSheetRef: RefObject<TaskDetailsSheetControllerHandle | null>;
  taskDetailsSheetProps: AgentStudioTaskDetailsSheetProps;
};

const EMPTY_TASK_SESSIONS_BY_TASK_ID = new Map<string, KanbanTaskSession[]>();
const EMPTY_HISTORICAL_SESSIONS_BY_TASK_ID = new Map<string, AgentSessionRecord[]>();
const EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID: ActiveTaskSessionContextByTaskId = new Map();

export function useAgentStudioTaskDetailsLauncher({
  activeWorkspace,
  tasks,
  selectedTaskId,
  detectingPullRequestTaskId,
  unlinkingPullRequestTaskId,
  onDetectPullRequest,
  onUnlinkPullRequest,
  gitProviderContext,
  gitProviderReadError = null,
}: UseAgentStudioTaskDetailsLauncherArgs): AgentStudioTaskDetailsLauncherModel {
  const taskDetailsSheetRef = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const [editTarget, setEditTarget] = useState<{ workspaceId: string; taskId: string } | null>(
    null,
  );
  const workspaceId = activeWorkspace?.workspaceId;
  const editingTask =
    editTarget?.workspaceId === workspaceId
      ? tasks.find((task) => task.id === editTarget?.taskId)
      : undefined;

  if (editTarget && !editingTask) {
    setEditTarget(null);
  }

  const onEdit = useCallback(
    (taskId: string): void => {
      if (!workspaceId || !tasks.some((task) => task.id === taskId)) {
        return;
      }
      taskDetailsSheetRef.current?.close();
      setEditTarget({ workspaceId, taskId });
    },
    [tasks, workspaceId],
  );

  const onEditorOpenChange = useCallback((open: boolean): void => {
    if (!open) {
      setEditTarget(null);
    }
  }, []);

  const taskEditor = useMemo<AgentStudioTaskDetailsLauncherModel["taskEditor"]>(
    () =>
      editingTask
        ? { open: true, task: editingTask, tasks, onOpenChange: onEditorOpenChange }
        : null,
    [editingTask, onEditorOpenChange, tasks],
  );

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
      historicalSessionsByTaskId: EMPTY_HISTORICAL_SESSIONS_BY_TASK_ID,
      activeTaskSessionContextByTaskId: EMPTY_ACTIVE_TASK_SESSION_CONTEXT_BY_TASK_ID,
      workflowActionsEnabled: false,
      onEdit,
      onDetectPullRequest,
      gitProviderContext,
      gitProviderReadError,
      onUnlinkPullRequest,
      detectingPullRequestTaskId,
      unlinkingPullRequestTaskId,
    }),
    [
      activeWorkspace,
      detectingPullRequestTaskId,
      gitProviderContext,
      gitProviderReadError,
      onDetectPullRequest,
      onEdit,
      onUnlinkPullRequest,
      tasks,
      unlinkingPullRequestTaskId,
    ],
  );

  return useMemo(
    () => ({
      openTaskDetails,
      taskEditor,
      taskDetailsSheetRef,
      taskDetailsSheetProps,
    }),
    [openTaskDetails, taskDetailsSheetProps, taskEditor],
  );
}
