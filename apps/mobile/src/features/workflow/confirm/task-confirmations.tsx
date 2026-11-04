import type { OnTaskCommitted } from "@openducktor/frontend-core/tasks/workflow/task-workflow-continuation";
import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
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
import { type ReactElement, useMemo, useState } from "react";
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
  onCommitted?: OnTaskCommitted | undefined;
  taskId: string;
  action: Exclude<TaskConfirmationAction, "reset_implementation">;
};

type TaskConfirmationsProps = {
  request: TaskConfirmationRequest | null;
  tasks: TaskCard[];
  /** The confirmation window closed, after a cancel or a success. */
  onClosed: (requestId: number) => void;
  /** The user confirmed the action, and it runs. */
  onStarted: (request: TaskConfirmationRequest) => void;
  /** The confirmed action succeeded. `onClosed` follows for the same request. */
  onSucceeded: (request: TaskConfirmationRequest) => void;
};

/** The desktop icon of each confirm button. */
const CONFIRM_ICONS = {
  reset_task: "rotate-ccw",
  delete: "trash-2",
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
    onCommitted: request.onCommitted,
  });
  return <TaskCloseConfirm dialog={dialog} onDismiss={() => onClosed(request.id)} />;
}

function RequestedTaskConfirm<Result>({
  request,
  action,
  tasks,
  runAction,
  onCommitted,
  onClosed,
  onStarted,
  onSucceeded,
}: Omit<TaskConfirmationsProps, "request"> & {
  request: TaskConfirmationRequest;
  action: TaskConfirmAction;
  runAction: (taskId: string) => Promise<Result>;
  onCommitted?: ((result: Result) => Promise<void>) | undefined;
}): ReactElement {
  const task = useLastKnownTask(tasks, request.taskId);
  const run = useMemo(
    () => (taskId: string) => {
      onStarted(request);
      return runAction(taskId);
    },
    [onStarted, request, runAction],
  );
  const { dialog } = useTaskConfirmDialog({
    action,
    task,
    enabled: true,
    initiallyOpen: true,
    run,
    onSucceeded: () => onSucceeded(request),
    onCommitted,
  });
  // Keep the confirmed impact while the command changes task data. A failed command shows the
  // current impact.
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
      loading={impact.isLoading || impact.isLoadingStopImpact}
      failure={error ? toFlowFailure(error, errorOutcomeUnknown, FAILURE_TITLES[action]) : null}
      icon={CONFIRM_ICONS[action]}
      onCancel={dialog.onCancel}
      onDismiss={() => onClosed(request.id)}
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
      loading={model.isLoadingImpact}
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
  const { resetTask, deleteTask } = useRequiredContext(TasksStateContext, "TaskConfirmations");
  const { request } = props;
  if (!request) return null;
  if (request.action === "close_task") {
    return <RequestedCloseConfirm key={request.id} {...props} request={request} />;
  }
  // Delete returns no task, and a reset returns the task that its continuation needs.
  return request.action === "delete" ? (
    <RequestedTaskConfirm
      key={request.id}
      {...props}
      request={request}
      action={request.action}
      runAction={deleteTask}
    />
  ) : (
    <RequestedTaskConfirm
      key={request.id}
      {...props}
      request={request}
      action={request.action}
      runAction={resetTask}
      onCommitted={request.onCommitted}
    />
  );
}
