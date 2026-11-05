import {
  resolveWorkflowAction,
  type ResolvedTaskCard,
  type TaskWorkflowAction,
} from "@openducktor/workflows";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { TaskWorkflowContinuation } from "./task-workflow-continuation";

/** A workflow action that asks for confirmation before its host command. */
export type TaskActionConfirmation = "reset_implementation" | "reset_task" | "close";

/** The client operation of a workflow action. Each client runs it with its own controls. */
export type TaskActionDestination =
  | { kind: "launch"; launchActionId: string }
  | { kind: "event"; eventId: string; launchActionIds: readonly string[] }
  | { kind: "details" }
  | { kind: "cleanup" }
  | { kind: "open_session"; role: string; options: SessionTargetOptions }
  | { kind: "no_session"; role: string }
  | { kind: "approve"; continuation?: TaskWorkflowContinuation | undefined }
  | { kind: "request_changes"; continuation?: TaskWorkflowContinuation | undefined }
  | {
      kind: "confirm";
      action: TaskActionConfirmation;
      continuation?: TaskWorkflowContinuation | undefined;
    };

/** The sessions that a surface can open for a role. */
export type SessionOptionsOf = (role: string) => SessionTargetOptions | undefined;

/**
 * The client operation of a declared workflow action. An unavailable action and a host effect
 * without a client operation fail with the fix.
 */
export const resolveTaskActionDestination = (
  task: ResolvedTaskCard,
  action: TaskWorkflowAction,
  sessionOptionsOf?: SessionOptionsOf,
): TaskActionDestination => {
  const role = task.taskWorkflow.viewActionRole(action);
  const options = role ? sessionOptionsOf?.(role) : undefined;
  const command = resolveWorkflowAction(task, action, options ? role : undefined);
  if (command.kind === "session") return { kind: "launch", launchActionId: command.launchActionId };
  if (command.kind === "view") {
    if (command.target === "session")
      return options
        ? { kind: "open_session", role: command.role, options }
        : { kind: "no_session", role: command.role };
    return command.target === "task_details" ? { kind: "details" } : { kind: "cleanup" };
  }
  const continuation: TaskWorkflowContinuation | undefined = command.launchActionIds.length
    ? { workflow: task.workflow, launchActionIds: command.launchActionIds }
    : undefined;
  switch (command.effect) {
    case undefined:
      return { kind: "event", eventId: command.eventId, launchActionIds: command.launchActionIds };
    case "review.approve":
      return { kind: "approve", continuation };
    case "review.request_changes":
      return { kind: "request_changes", continuation };
    case "implementation.reset":
      return { kind: "confirm", action: "reset_implementation", continuation };
    case "task.reset":
      return { kind: "confirm", action: "reset_task", continuation };
    case "task.close":
      return { kind: "confirm", action: "close", continuation };
    default:
      throw new Error(
        `Action "${action}" uses unsupported host effect "${command.effect}". Update the client to use this action.`,
      );
  }
};

/** Whether the action sends a host command, so its control shows pending feedback. */
export const taskActionSendsCommand = (
  task: ResolvedTaskCard,
  action: TaskWorkflowAction,
): boolean => {
  if (task.taskWorkflow.viewActionRole(action)) return false;
  const declaration = task.taskWorkflow.action(action);
  return !(
    declaration.kind === "view" &&
    declaration.stepId === undefined &&
    (declaration.target ?? "task_details") === "task_details"
  );
};
