import type { TaskWorkflowContinuation } from "./task-workflow-continuation";
import {
  resolveWorkflowAction,
  sessionRoleForViewAction,
  type ResolvedTaskCard,
  type TaskWorkflowAction,
  type WorkflowRoleId as AgentRole,
} from "@openducktor/workflows";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { TaskWorkflowActions } from "./task-workflow-actions-context";

type TaskWorkflowCallbacks = {
  [
    Key in keyof Pick<
      TaskWorkflowActions,
      | "onOpenSession"
      | "onHumanApprove"
      | "onHumanRequestChanges"
      | "onResetImplementation"
      | "onOpenTaskDetails"
      | "onLaunch"
      | "onApplyEvent"
    >
  ]?: TaskWorkflowActions[Key] | undefined;
} & {
  onResetTask?: ((taskId: string, continuation?: TaskWorkflowContinuation) => void) | undefined;
  onCloseTask?: ((taskId: string, continuation?: TaskWorkflowContinuation) => void) | undefined;
  onRemoveTaskWorktree?: ((taskId: string) => void) | undefined;
};
type TaskWorkflowActionContext = {
  task: ResolvedTaskCard;
  resolveSessionOptions?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
};

/** Resolve declared behavior and use the existing operation or confirmation. */
export const runTaskWorkflowAction = (
  action: TaskWorkflowAction,
  taskId: string | null,
  callbacks: TaskWorkflowCallbacks,
  context: TaskWorkflowActionContext,
): void => {
  if (!taskId || taskId !== context.task.id)
    throw new Error("Workflow action task does not match its context. Reload the task.");
  const role = sessionRoleForViewAction(action, context.task);
  const sessionOptions = role ? context.resolveSessionOptions?.(role) : undefined;
  const operation = resolveWorkflowAction(context.task, action, sessionOptions ? role : undefined);
  const requireHandler = <Args extends unknown[]>(
    handler: ((...args: Args) => void) | undefined,
    ...args: Args
  ) => {
    if (!handler)
      throw new Error(
        `Action "${action}" needs a host capability that this client does not support. Update the client.`,
      );
    handler(...args);
  };
  if (operation.kind === "session") {
    requireHandler(callbacks.onLaunch, taskId, operation.launchActionId);
    return;
  }
  if (operation.kind === "view") {
    switch (operation.target) {
      case "session":
        requireHandler(callbacks.onOpenSession, taskId, operation.role!, sessionOptions);
        return;
      case "task_details":
        requireHandler(callbacks.onOpenTaskDetails, taskId);
        return;
      case "worktree_cleanup":
        requireHandler(callbacks.onRemoveTaskWorktree, taskId);
        return;
    }
  }
  const continuation: TaskWorkflowContinuation | undefined = operation.launchActionIds.length
    ? { workflow: context.task.workflow, launchActionIds: operation.launchActionIds }
    : undefined;
  switch (operation.effect) {
    // A status.set event has no host effect beyond its transition, so the event command runs it.
    case undefined:
    case "status.set":
      requireHandler(callbacks.onApplyEvent, taskId, operation.eventId, operation.launchActionIds);
      return;
    case "review.approve":
      requireHandler(callbacks.onHumanApprove, taskId, ...(continuation ? [continuation] : []));
      return;
    case "review.request_changes":
      requireHandler(
        callbacks.onHumanRequestChanges,
        taskId,
        ...(continuation ? [continuation] : []),
      );
      return;
    case "implementation.reset": {
      const options = continuation
        ? { closeDetailsAfterReset: true, continuation }
        : { closeDetailsAfterReset: true };
      requireHandler(callbacks.onResetImplementation, taskId, options);
      return;
    }
    case "task.reset":
      requireHandler(callbacks.onResetTask, taskId, ...(continuation ? [continuation] : []));
      return;
    case "task.close":
      requireHandler(callbacks.onCloseTask, taskId, ...(continuation ? [continuation] : []));
      return;
    default:
      throw new Error(
        `Action "${action}" uses unsupported host effect "${operation.effect}". Update the client to use this action.`,
      );
  }
};
