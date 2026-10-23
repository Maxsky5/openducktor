import type { TaskCard } from "@openducktor/contracts";
import { unfilteredRepoTaskDataQueryOptions } from "@openducktor/frontend-core/queries/tasks";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { TaskCreateDestination } from "@/components/features/task-create/use-task-create-modal-controller";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { EditTaskSection } from "@/types/task-composer";

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
  | { kind: "edit"; workspaceId: string; taskId: string; section: EditTaskSection };

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
 * - Edit task belongs to its workspace and task. It closes when either one goes, so it does not
 *   open again later.
 * - Each opening has its own close handler, so an earlier save cannot close a later form.
 */
export function useTaskWorkflowComposer({
  activeWorkspace,
  tasks,
}: {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
}): TaskWorkflowComposer {
  const [state, setState] = useState<TaskComposerState>(CLOSED_TASK_COMPOSER);
  const workspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceName = activeWorkspace?.workspaceName ?? null;
  const repoPath = activeWorkspace?.repoPath ?? null;
  const editTaskId =
    state.kind === "edit" && state.workspaceId === workspaceId ? state.taskId : null;
  const onOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) setState((current) => (current === state ? CLOSED_TASK_COMPOSER : current));
    },
    [state],
  );
  const composerTasks = useComposerTasks(repoPath, editTaskId, tasks, onOpenChange);
  const editTask = composerTasks.find((task) => task.id === editTaskId) ?? null;
  if (state.kind === "edit" && state.workspaceId !== workspaceId) setState(CLOSED_TASK_COMPOSER);

  const onCreateTask = useCallback(
    (options?: { initialTitle?: string }): void => {
      setState({
        kind: "create",
        destination: workspaceId && workspaceName ? { workspaceId, workspaceName } : null,
        initialTitle: options?.initialTitle ?? "",
      });
    },
    [workspaceId, workspaceName],
  );
  const onEdit = useCallback(
    (taskId: string, section: EditTaskSection = "details"): void => {
      // Without an active workspace there is no task to edit.
      if (workspaceId !== null) setState({ kind: "edit", workspaceId, taskId, section });
    },
    [workspaceId],
  );

  return {
    onCreateTask,
    onEdit,
    composer: {
      open: state.kind === "create" || editTask !== null,
      task: editTask,
      tasks: composerTasks,
      destination: state.kind === "create" ? state.destination : null,
      initialTitle: state.kind === "create" ? state.initialTitle : "",
      initialEditSection: state.kind === "edit" ? state.section : "details",
      onOpenChange,
    },
  };
}

function useComposerTasks(
  repoPath: string | null,
  taskId: string | null,
  tasks: TaskCard[],
  onOpenChange: (open: boolean) => void,
): TaskCard[] {
  const boardTask = tasks.find((task) => task.id === taskId);
  const taskQuery = useQuery({
    ...unfilteredRepoTaskDataQueryOptions(repoPath ?? ""),
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
    onOpenChange(false);
  }, [
    editTask,
    taskId,
    repoPath,
    onOpenChange,
    taskQuery.isError,
    taskQuery.isFetching,
    taskQuery.isPending,
  ]);
  return composerTasks;
}
