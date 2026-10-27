import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { CloseTaskOptions } from "@openducktor/frontend-core/types/task-close";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { confirmButtonState } from "@openducktor/frontend-core/tasks/details/task-cleanup-impact-model";
import {
  buildTaskDeleteConfirmCopy,
  buildTaskResetConfirmCopy,
  buildTaskResetImplementationConfirmCopy,
  taskResetImplementationConfirmState,
} from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { useTaskCloseConfirmDialog } from "@openducktor/frontend-core/tasks/details/use-task-close-confirm-dialog";
import { useTaskConfirmDialog } from "@openducktor/frontend-core/tasks/details/use-task-confirm-dialog";
import { useLastKnownTask } from "@openducktor/frontend-core/tasks/details/use-last-known-task";
import type { TaskConfirmAction } from "@openducktor/frontend-core/tasks/workflow/task-confirm-actions";
import type { TaskResetImplementationModalModel } from "@openducktor/frontend-core/tasks/workflow/use-task-reset-flow";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import type { IconName } from "@/ui/icon";
import { toFlowFailure } from "@/host-session/command-outcome";
import { TaskCloseConfirm } from "../close/task-close-confirm";
import type { TaskConfirmationAction } from "../task-action-routing";
import { TaskConfirmView } from "./task-confirm-view";

/**
 * One confirmation that the user asked for. A new request opens a new confirmation. Reset
 * Implementation opens its own flow in `useTaskActions`.
 */
export type TaskConfirmationRequest = {
  id: number;
  taskId: string;
  action: Exclude<TaskConfirmationAction, "reset_implementation">;
};

type TaskConfirmationsProps = {
  request: TaskConfirmationRequest | null;
  tasks: TaskCard[];
  /** The confirmation closed, after a cancel or a success. It runs after the close rendered. */
  onClosed: (requestId: number) => void;
  /** The user confirmed the action, and it runs. */
  onStarted: (request: TaskConfirmationRequest) => void;
  /** The confirmed action succeeded. `onClosed` follows for the same request. */
  onSucceeded: (request: TaskConfirmationRequest) => void;
};

/** The desktop icon of each confirm button. */
const CONFIRM_ICONS = {
  reset_task: "rotate-ccw",
  delete: "trash",
} as const satisfies Record<TaskConfirmAction, IconName>;

const FAILURE_TITLES = {
  reset_task: "Reset failed",
  delete: "Delete failed",
} as const satisfies Record<TaskConfirmAction, string>;

/** The Close Task confirmation, with the cleanup choice of the close. */
function RequestedCloseConfirm({
  request,
  tasks,
  onClosed,
  onStarted,
  onSucceeded,
}: Omit<TaskConfirmationsProps, "request"> & {
  request: TaskConfirmationRequest;
}): ReactElement {
  const { closeTask } = useRequiredContext(TasksStateContext, "RequestedCloseConfirm");
  const task = useLastKnownTask(tasks, request.taskId) ?? {
    id: request.taskId,
    title: "",
    removeWorktreeOnClose: null,
  };
  const run = useMemo(
    () => (taskId: string, options: CloseTaskOptions) => {
      onStarted(request);
      return closeTask(taskId, options);
    },
    [closeTask, onStarted, request],
  );
  const { dialog } = useTaskCloseConfirmDialog({
    task,
    enabled: true,
    initiallyOpen: true,
    run,
    onSucceeded: () => onSucceeded(request),
  });
  useEffect(() => {
    if (!dialog.open) onClosed(request.id);
  }, [dialog.open, onClosed, request.id]);
  return <TaskCloseConfirm dialog={dialog} />;
}

function RequestedTaskConfirm({
  request,
  action,
  tasks,
  onClosed,
  onStarted,
  onSucceeded,
}: Omit<TaskConfirmationsProps, "request"> & {
  request: TaskConfirmationRequest;
  action: TaskConfirmAction;
}): ReactElement {
  const { resetTask, deleteTask } = useRequiredContext(TasksStateContext, "RequestedTaskConfirm");
  const task = useLastKnownTask(tasks, request.taskId);
  const run = useMemo(() => {
    const runAction = (taskId: string): Promise<void> =>
      action === "delete" ? deleteTask(taskId) : resetTask(taskId);
    return (taskId: string) => {
      onStarted(request);
      return runAction(taskId);
    };
  }, [action, deleteTask, onStarted, request, resetTask]);
  const { dialog } = useTaskConfirmDialog({
    action,
    task,
    enabled: true,
    initiallyOpen: true,
    run,
    onSucceeded: () => onSucceeded(request),
  });
  useEffect(() => {
    if (!dialog.open) onClosed(request.id);
  }, [dialog.open, onClosed, request.id]);
  // After Confirm, the sheet keeps the impact that the user confirmed until it closes. The action
  // changes the task and its worktrees, so the impact reads again while it runs, and each new read
  // changed the text and the button of the sheet. A failure shows the current impact again.
  const [confirmed, setConfirmed] = useState<typeof dialog.impact | null>(null);
  const { error, errorOutcomeUnknown } = dialog.operation;
  const impact = confirmed && error === null ? confirmed : dialog.impact;
  const subject = { id: request.taskId, title: task?.title ?? null };
  const copy =
    action === "delete"
      ? buildTaskDeleteConfirmCopy(subject, impact)
      : buildTaskResetConfirmCopy(subject, impact);
  const confirm = confirmButtonState(impact, dialog.operation, copy.confirmLabel);
  return (
    <TaskConfirmView
      visible={dialog.open}
      copy={copy}
      confirm={confirm}
      isPending={dialog.operation.isPending}
      impactError={impact.error}
      failure={error ? toFlowFailure(error, errorOutcomeUnknown, FAILURE_TITLES[action]) : null}
      icon={CONFIRM_ICONS[action]}
      onCancel={dialog.onCancel}
      onConfirm={() => {
        setConfirmed(dialog.impact);
        dialog.onConfirm();
      }}
    />
  );
}

/** The Reset Implementation confirmation of the flow that `useTaskActions` opens. */
export function ResetImplementationConfirmation({
  model,
}: {
  model: TaskResetImplementationModalModel;
}): ReactElement {
  const copy = buildTaskResetImplementationConfirmCopy(model);
  const confirm = taskResetImplementationConfirmState(model, copy);
  return (
    <TaskConfirmView
      visible={model.open}
      copy={copy}
      confirm={confirm}
      isPending={model.isSubmitting}
      impactError={model.impactError}
      failure={
        model.errorMessage
          ? toFlowFailure(model.errorMessage, model.errorOutcomeUnknown, "Reset failed")
          : null
      }
      icon="rotate-ccw"
      onCancel={model.onCancel}
      onConfirm={model.onConfirm}
    />
  );
}

/**
 * The confirmation of a Reset Task, Close Task, or Delete request on the screen where the user
 * started it. Each states what the host keeps and removes.
 */
export function TaskConfirmations(props: TaskConfirmationsProps): ReactElement | null {
  const { request } = props;
  if (!request) return null;
  if (request.action === "close_task") {
    return <RequestedCloseConfirm key={request.id} {...props} request={request} />;
  }
  return (
    <RequestedTaskConfirm key={request.id} {...props} request={request} action={request.action} />
  );
}
