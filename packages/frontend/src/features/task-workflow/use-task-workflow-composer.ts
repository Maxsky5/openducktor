import { unfilteredRepoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { TaskCreateDestination } from "@openducktor/frontend-core/tasks/create/use-task-create-modal-controller";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { EditTaskSection } from "@openducktor/frontend-core/tasks/create/task-composer-types";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

export type TaskWorkflowTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  destination: TaskCreateDestination | null;
  initialTitle: string;
  initialEditSection?: EditTaskSection;
  onOpenChange: (open: boolean) => void;
};

type TaskComposerState =
  | { kind: "closed" }
  | { kind: "create"; destination: TaskCreateDestination | null; initialTitle: string }
  | {
      kind: "edit";
      workspaceId: string;
      workspaceName: string;
      repoPath: string;
      taskId: string;
      section: EditTaskSection;
    };

const CLOSED_TASK_COMPOSER: TaskComposerState = { kind: "closed" };

type TaskWorkflowComposer = {
  onCreateTask: (options?: { initialTitle?: string }) => void;
  onEdit: (taskId: string, section?: EditTaskSection) => void;
  composer: TaskWorkflowTaskComposerModel;
};

/**
 * The New task and Edit task form of the task workflow actions.
 * - New task keeps the workspace that was active when it opened. The form blocks a save in
 *   another workspace.
 * - Edit task keeps its workspace and last saved task while local drafts remain open.
 * - Each opening has its own close handler, so an earlier save cannot close a later form.
 */
export function useTaskWorkflowComposer({
  activeWorkspace,
  tasks,
}: {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
}): TaskWorkflowComposer {
  // A state object is one opening of the form. A task refresh keeps it, so the close handler that
  // a save captured still closes the form.
  const [state, setState] = useState<TaskComposerState>(CLOSED_TASK_COMPOSER);
  const [lastSavedEditTask, setLastSavedEditTask] = useState<{
    opening: TaskComposerState;
    task: TaskCard;
  } | null>(null);
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceName = activeWorkspace?.workspaceName ?? null;
  const repoPath = activeWorkspace?.repoPath ?? null;
  const editTaskId = state.kind === "edit" ? state.taskId : null;
  const editingActiveWorkspace = state.kind !== "edit" || state.workspaceId === workspaceId;
  const onOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) setState((current) => (current === state ? CLOSED_TASK_COMPOSER : current));
    },
    [state],
  );
  const composerTasks = useComposerTasks(
    editingActiveWorkspace && activeWorkspace ? activeWorkspace : null,
    editTaskId,
    editingActiveWorkspace ? tasks : [],
  );
  const savedEditTask = composerTasks.find((task) => task.id === editTaskId) ?? null;
  useEffect(() => {
    if (!savedEditTask) return;
    setLastSavedEditTask((current) =>
      current?.opening === state && current.task === savedEditTask
        ? current
        : { opening: state, task: savedEditTask },
    );
  }, [savedEditTask, state]);
  const editTask =
    savedEditTask ?? (lastSavedEditTask?.opening === state ? lastSavedEditTask.task : null);

  const onCreateTask = useCallback(
    (options?: { initialTitle?: string }): void => {
      setState({
        kind: "create",
        destination:
          workspaceId && workspaceName && repoPath
            ? { workspaceId, workspaceName, repoPath }
            : null,
        initialTitle: options?.initialTitle ?? "",
      });
    },
    [workspaceId, workspaceName, repoPath],
  );
  const onEdit = useCallback(
    (taskId: string, section: EditTaskSection = "details"): void => {
      // Without an active workspace there is no task to edit.
      if (workspaceId !== null && workspaceName !== null && repoPath !== null)
        setState({
          kind: "edit",
          workspaceId,
          workspaceName,
          repoPath,
          taskId,
          section,
        });
    },
    [workspaceId, workspaceName, repoPath],
  );

  return {
    onCreateTask,
    onEdit,
    composer: taskComposerModel(state, composerTasks, editTask, onOpenChange),
  };
}

function taskComposerModel(
  state: TaskComposerState,
  composerTasks: TaskCard[],
  editTask: TaskCard | null,
  onOpenChange: (open: boolean) => void,
): TaskWorkflowTaskComposerModel {
  return {
    open: state.kind === "create" || editTask !== null,
    task: editTask,
    tasks: composerTasks,
    destination:
      state.kind === "closed"
        ? null
        : state.kind === "create"
          ? state.destination
          : {
              workspaceId: state.workspaceId,
              workspaceName: state.workspaceName,
              repoPath: state.repoPath,
            },
    initialTitle: state.kind === "create" ? state.initialTitle : "",
    initialEditSection: state.kind === "edit" ? state.section : "details",
    onOpenChange,
  };
}

function useComposerTasks(
  workspace: ActiveWorkspace | null,
  taskId: string | null,
  tasks: TaskCard[],
): TaskCard[] {
  const repoPath = workspace?.repoPath ?? null;
  const boardTask = tasks.find((task) => task.id === taskId);
  const taskQuery = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(workspace ?? { workspaceId: "", repoPath: "" }),
    enabled: repoPath !== null && taskId !== null && !boardTask,
  });
  const composerTasks = boardTask || !taskQuery.isSuccess ? tasks : taskQuery.data.tasks;
  const editTask = composerTasks.find((task) => task.id === taskId);
  useEffect(() => {
    if (!taskId || editTask || taskQuery.isPending || taskQuery.isFetching) return;
    toast.error(taskQuery.isError ? "Could not load the task" : "The task no longer exists", {
      id: `task-edit-unavailable:${repoPath}:${taskId}`,
      description: taskQuery.isError
        ? "Reload and open the task again."
        : "The task was removed from this workspace.",
    });
  }, [editTask, taskId, repoPath, taskQuery.isError, taskQuery.isFetching, taskQuery.isPending]);
  return composerTasks;
}
