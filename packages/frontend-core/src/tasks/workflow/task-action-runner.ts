import { errorMessage } from "../../lib/errors";
import { resolveTaskActionDestination } from "./task-action-destination";
import type { TaskWorkflowActions } from "./task-workflow-actions-context";

/** The shared controls that run each destination of a workflow action. */
export type TaskActionRunnerHandlers = Pick<
  TaskWorkflowActions,
  | "onLaunch"
  | "onApplyEvent"
  | "onOpenTaskDetails"
  | "onOpenSession"
  | "onHumanApprove"
  | "onHumanRequestChanges"
  | "onResetImplementation"
  | "onConfirmTaskAction"
> & { showError: (title: string, description: string) => void };

/**
 * The one runner of declared workflow actions for every desktop and web surface. A surface adds
 * only its session options and, when it must keep focus, its own confirmations.
 */
export const createTaskActionRunner =
  (handlers: TaskActionRunnerHandlers): TaskWorkflowActions["runAction"] =>
  (task, action, options) => {
    try {
      const destination = resolveTaskActionDestination(task, action, options?.sessionOptionsOf);
      switch (destination.kind) {
        case "launch":
          handlers.onLaunch(task.id, destination.launchActionId);
          return;
        case "event":
          handlers.onApplyEvent(task.id, destination.eventId, destination.launchActionIds);
          return;
        case "details":
          handlers.onOpenTaskDetails(task.id);
          return;
        case "cleanup":
          // The task details read the worktree, so they own its removal.
          if (options?.onRemoveWorktree) options.onRemoveWorktree();
          else handlers.onOpenTaskDetails(task.id);
          return;
        case "open_session":
          handlers.onOpenSession(task.id, destination.role, destination.options);
          return;
        case "no_session":
          handlers.onOpenSession(task.id, destination.role);
          return;
        case "approve":
          handlers.onHumanApprove(task.id, destination.continuation);
          return;
        case "request_changes":
          handlers.onHumanRequestChanges(task.id, destination.continuation);
          return;
        case "confirm": {
          const { action: confirmation, continuation } = destination;
          if (confirmation === "reset_implementation")
            handlers.onResetImplementation(task.id, { closeDetailsAfterReset: true, continuation });
          else if (options?.confirm) options.confirm(confirmation, continuation);
          else
            handlers.onConfirmTaskAction(
              task.id,
              confirmation === "close_task" ? "close" : "reset_task",
              continuation,
            );
          return;
        }
      }
    } catch (cause) {
      handlers.showError("Workflow action failed", errorMessage(cause));
    }
  };
