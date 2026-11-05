import {
  resolveWorkflowAction,
  type ResolvedTaskCard,
  type TaskWorkflow,
  type TaskWorkflowAction,
} from "@openducktor/workflows";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { TaskWorkflowContinuation } from "./task-workflow-continuation";

/**
 * A workflow action that asks for confirmation before its host command. Close Task and Reset Task
 * are core task actions, so they open their confirmations without a workflow action.
 */
export type TaskActionConfirmation = "reset_implementation";

/** The client operation of a workflow action. Each client runs it with its own controls. */
export type TaskActionDestination =
  | { kind: "launch"; launchActionId: string }
  | { kind: "event"; eventId: string; launchActionIds: readonly string[] }
  | { kind: "details" }
  | { kind: "cleanup" }
  | { kind: "open_session"; role: string; options: SessionTargetOptions }
  | { kind: "no_session"; role: string }
  | { kind: "approve" }
  | { kind: "feedback"; eventId: string; continuation?: TaskWorkflowContinuation | undefined }
  | {
      kind: "confirm";
      action: TaskActionConfirmation;
      eventId: string;
      continuation?: TaskWorkflowContinuation | undefined;
    };

/** The sessions that a surface can open for a role. */
export type SessionOptionsOf = (role: string) => SessionTargetOptions | undefined;

/**
 * The client operation of a declared workflow action. An event with the `worktree.reset` effect
 * asks for confirmation first. An event whose following launch collects human feedback opens the
 * feedback form. An unavailable action fails with the fix.
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
  if (command.kind === "approval") return { kind: "approve" };
  const continuation: TaskWorkflowContinuation | undefined = command.launchActionIds.length
    ? { workflow: task.workflow, launchActionIds: command.launchActionIds }
    : undefined;
  if (command.effects.includes("worktree.reset"))
    return {
      kind: "confirm",
      action: "reset_implementation",
      eventId: command.eventId,
      continuation,
    };
  if (command.collectsFeedback) return { kind: "feedback", eventId: command.eventId, continuation };
  return { kind: "event", eventId: command.eventId, launchActionIds: command.launchActionIds };
};

/**
 * What the client does for an event action before its host command: confirm the worktree reset,
 * collect human feedback, or nothing. Other actions give null.
 */
export const eventActionStep = (
  workflow: TaskWorkflow,
  actionId: TaskWorkflowAction,
): "confirm" | "feedback" | "none" | null => {
  const action = workflow.action(actionId);
  if (action.kind !== "event") return null;
  if (workflow.eventEffects(action.eventId).includes("worktree.reset")) return "confirm";
  return (action.launchActionIds ?? []).some(
    (id) => workflow.launchAction(id).context === "human_feedback",
  )
    ? "feedback"
    : "none";
};

/**
 * The event of an available event action that resets the task worktree, or null when the task
 * offers no such action.
 */
export const availableWorktreeResetEvent = (task: ResolvedTaskCard): string | null => {
  for (const id of task.availableActions) {
    const action = task.taskWorkflow.action(id);
    if (
      action.kind === "event" &&
      task.taskWorkflow.eventEffects(action.eventId).includes("worktree.reset")
    )
      return action.eventId;
  }
  return null;
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
