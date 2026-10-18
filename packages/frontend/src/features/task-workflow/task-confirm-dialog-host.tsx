import type { TaskCard } from "@openducktor/contracts";
import { type ReactElement, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { TaskDeleteConfirmDialog } from "@/components/features/task-details/task-delete-confirm-dialog";
import { TaskResetConfirmDialog } from "@/components/features/task-details/task-reset-confirm-dialog";
import type { TaskConfirmRequestAction } from "@/components/features/task-details/task-confirm-dialog-types";
import { useTaskConfirmDialog } from "@/components/features/task-details/use-task-confirm-dialog";
import type { TaskWorkflowActions } from "./task-workflow-actions-context";

type TaskConfirmWorkspaceIdentity = { workspaceId: string; repoPath: string };

/**
 * A confirmation for a task of the workspace that opened it. `id` changes with each request, so
 * a new request opens a new dialog.
 */
export type TaskConfirmRequest = TaskConfirmWorkspaceIdentity & {
  id: number;
  taskId: string;
  action: TaskConfirmRequestAction;
  /** The element that had focus when the request started. The dialog has no trigger. */
  returnFocus: HTMLElement | null;
};

/** The tasks and handlers of the active workspace. */
type TaskConfirmWorkspace = {
  tasks: TaskCard[];
  onResetTask: TaskWorkflowActions["onResetTask"];
  onDelete: TaskWorkflowActions["onDelete"];
  /** Called after the confirmed action succeeds. */
  onSucceeded: (taskId: string) => void;
};

export type TaskConfirmDialogHostModel = TaskConfirmWorkspace & {
  request: TaskConfirmRequest;
  /** Called after the dialog closed, so the request can go. */
  onClosed: (requestId: number) => void;
};

type TaskConfirmDialogHostState = {
  onConfirmTaskAction: (taskId: string, action: TaskConfirmRequestAction) => void;
  model: TaskConfirmDialogHostModel | null;
};

/**
 * The confirmation request of the active workspace. The tasks and handlers belong to that
 * workspace, so a workspace change drops the request before its dialog can use them.
 */
export function useTaskConfirmDialogHost({
  workspaceIdentity,
  ...workspace
}: TaskConfirmWorkspace & {
  workspaceIdentity: TaskConfirmWorkspaceIdentity | null;
}): TaskConfirmDialogHostState {
  const [request, setRequest] = useState<TaskConfirmRequest | null>(null);
  const nextRequestIdRef = useRef(0);
  const isWorkspaceCurrent =
    request !== null &&
    request.workspaceId === workspaceIdentity?.workspaceId &&
    request.repoPath === workspaceIdentity?.repoPath;
  if (request && !isWorkspaceCurrent) setRequest(null);
  const onConfirmTaskAction = useCallback(
    (taskId: string, action: TaskConfirmRequestAction): void => {
      if (!workspaceIdentity) {
        toast.error("Unable to open the confirmation", {
          description: `No workspace is active for task ${taskId}. Select its workspace and try again.`,
        });
        return;
      }
      const returnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      nextRequestIdRef.current += 1;
      const id = nextRequestIdRef.current;
      setRequest({
        id,
        taskId,
        action,
        returnFocus,
        ...workspaceIdentity,
      });
    },
    [workspaceIdentity],
  );
  const onClosed = useCallback((requestId: number): void => {
    setRequest((current) => (current?.id === requestId ? null : current));
  }, []);
  return {
    onConfirmTaskAction,
    model: request && isWorkspaceCurrent ? { ...workspace, request, onClosed } : null,
  };
}

/** The Reset Task or Delete confirmation of a task, outside a details sheet. */
export function TaskConfirmDialogHost({
  model,
}: {
  model: TaskConfirmDialogHostModel | null;
}): ReactElement | null {
  return model ? <RequestedTaskConfirmDialog key={model.request.id} {...model} /> : null;
}

function RequestedTaskConfirmDialog({
  request,
  tasks,
  onResetTask,
  onDelete,
  onSucceeded,
  onClosed,
}: TaskConfirmDialogHostModel): ReactElement {
  // A deleted task leaves the task list while its dialog closes, so keep the last task.
  const currentTask = tasks.find((entry) => entry.id === request.taskId) ?? null;
  const [lastTask, setLastTask] = useState(currentTask);
  if (currentTask && currentTask !== lastTask) setLastTask(currentTask);
  const { dialog, subtasksCount } = useTaskConfirmDialog({
    action: request.action,
    task: currentTask ?? lastTask,
    allTasks: tasks,
    enabled: true,
    initiallyOpen: true,
    run:
      request.action === "delete"
        ? (taskId) => onDelete(taskId, { deleteSubtasks: true })
        : onResetTask,
    onSucceeded: () => onSucceeded(request.taskId),
  });
  const dialogProps = {
    ...dialog,
    taskId: request.taskId,
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (request.returnFocus?.isConnected) request.returnFocus.focus({ preventScroll: true });
      onClosed(request.id);
    },
  };

  return request.action === "delete" ? (
    <TaskDeleteConfirmDialog {...dialogProps} subtasksCount={subtasksCount} />
  ) : (
    <TaskResetConfirmDialog {...dialogProps} />
  );
}
