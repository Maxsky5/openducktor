import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useState } from "react";
import type { TaskCreateDestination } from "@/components/features/task-create/use-task-create-modal-controller";
import type { ActiveWorkspace } from "@/types/state-slices";

export type TaskWorkflowTaskComposerModel = {
  open: boolean;
  task: TaskCard | null;
  tasks: TaskCard[];
  destination: TaskCreateDestination | null;
  initialTitle: string;
  onOpenChange: (open: boolean) => void;
};

type TaskComposerState =
  | { kind: "closed" }
  | { kind: "create"; destination: TaskCreateDestination | null; initialTitle: string }
  | { kind: "edit"; workspaceId: string; taskId: string };

const CLOSED_TASK_COMPOSER: TaskComposerState = { kind: "closed" };

type TaskWorkflowComposer = {
  onCreateTask: (options?: { initialTitle?: string }) => void;
  onEdit: (taskId: string) => void;
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
  const editTask =
    state.kind === "edit" && state.workspaceId === workspaceId
      ? (tasks.find((task) => task.id === state.taskId) ?? null)
      : null;
  if (state.kind === "edit" && !editTask) setState(CLOSED_TASK_COMPOSER);

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
    (taskId: string): void => {
      // Without an active workspace there is no task to edit.
      if (workspaceId !== null) setState({ kind: "edit", workspaceId, taskId });
    },
    [workspaceId],
  );
  const onOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) setState((current) => (current === state ? CLOSED_TASK_COMPOSER : current));
    },
    [state],
  );

  return {
    onCreateTask,
    onEdit,
    composer: {
      open: state.kind === "create" || editTask !== null,
      task: editTask,
      tasks,
      destination: state.kind === "create" ? state.destination : null,
      initialTitle: state.kind === "create" ? state.initialTitle : "",
      onOpenChange,
    },
  };
}
