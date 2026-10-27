import { type ReactElement, useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { TaskCloseConfirmDialog } from "@/components/features/task-details/task-close-confirm-dialog";
import { TaskDeleteConfirmDialog } from "@/components/features/task-details/task-delete-confirm-dialog";
import { TaskResetConfirmDialog } from "@/components/features/task-details/task-reset-confirm-dialog";
import type {
  TaskConfirmAction,
  TaskConfirmRequestAction,
} from "@openducktor/frontend-core/tasks/workflow/task-confirm-actions";
import { useTaskCloseConfirmDialog } from "@openducktor/frontend-core/tasks/details/use-task-close-confirm-dialog";
import { useTaskConfirmDialog } from "@openducktor/frontend-core/tasks/details/use-task-confirm-dialog";
import { useLastKnownTask } from "@openducktor/frontend-core/tasks/details/use-last-known-task";
import type { TaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

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
  onCloseTask: TaskWorkflowActions["onCloseTask"];
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

/** The Reset Task, Close Task, or Delete confirmation of a task, outside a details sheet. */
export function TaskConfirmDialogHost({
  model,
}: {
  model: TaskConfirmDialogHostModel | null;
}): ReactElement | null {
  if (!model) return null;
  const { request } = model;
  if (request.action === "close") {
    return <RequestedTaskCloseDialog key={request.id} {...model} />;
  }
  return (
    <RequestedTaskConfirmDialog
      key={request.id}
      {...model}
      request={{ ...request, action: request.action }}
    />
  );
}

function RequestedTaskCloseDialog({
  request,
  tasks,
  onCloseTask,
  onSucceeded,
  onClosed,
}: TaskConfirmDialogHostModel): ReactElement | null {
  const task = useLastKnownTask(tasks, request.taskId);
  if (!task) return null;
  return (
    <TaskCloseDialogForTask
      task={task}
      onCloseTask={onCloseTask}
      onSucceeded={() => onSucceeded(request.taskId)}
      onCloseAutoFocus={restoreFocusOnClose(request, onClosed)}
    />
  );
}

function TaskCloseDialogForTask({
  task,
  onCloseTask,
  onSucceeded,
  onCloseAutoFocus,
}: {
  task: TaskCard;
  onCloseTask: TaskWorkflowActions["onCloseTask"];
  onSucceeded: () => void;
  onCloseAutoFocus: (event: Event) => void;
}): ReactElement {
  const { dialog } = useTaskCloseConfirmDialog({
    task,
    enabled: true,
    initiallyOpen: true,
    run: onCloseTask,
    onSucceeded,
  });
  return <TaskCloseConfirmDialog {...dialog} onCloseAutoFocus={onCloseAutoFocus} />;
}

function RequestedTaskConfirmDialog({
  request,
  tasks,
  onResetTask,
  onDelete,
  onSucceeded,
  onClosed,
}: TaskConfirmDialogHostModel & {
  request: TaskConfirmRequest & { action: TaskConfirmAction };
}): ReactElement {
  const task = useLastKnownTask(tasks, request.taskId);
  const { dialog } = useTaskConfirmDialog({
    action: request.action,
    task,
    enabled: true,
    initiallyOpen: true,
    run: request.action === "delete" ? onDelete : onResetTask,
    onSucceeded: () => onSucceeded(request.taskId),
  });
  const dialogProps = {
    ...dialog,
    task: { id: request.taskId, title: task?.title ?? null },
    onCloseAutoFocus: restoreFocusOnClose(request, onClosed),
  };

  return request.action === "delete" ? (
    <TaskDeleteConfirmDialog {...dialogProps} />
  ) : (
    <TaskResetConfirmDialog {...dialogProps} />
  );
}

const restoreFocusOnClose =
  (request: TaskConfirmRequest, onClosed: (requestId: number) => void) =>
  (event: Event): void => {
    event.preventDefault();
    if (request.returnFocus?.isConnected) request.returnFocus.focus({ preventScroll: true });
    onClosed(request.id);
  };
