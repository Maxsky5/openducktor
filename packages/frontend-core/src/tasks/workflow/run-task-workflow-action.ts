import {
  sessionRoleForViewAction,
  type SessionRoleViewAction,
  type TaskWorkflowAction,
  type BuiltinRoleId as AgentRole,
} from "@openducktor/workflows";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { TaskWorkflowActions } from "./task-workflow-actions-context";

type TaskWorkflowCallbacks = {
  onPlan: TaskWorkflowActions["onPlan"] | undefined;
  onQaStart: TaskWorkflowActions["onQaStart"] | undefined;
  onQaOpen: TaskWorkflowActions["onQaOpen"] | undefined;
  onBuild: TaskWorkflowActions["onBuild"] | undefined;
  onOpenSession?: TaskWorkflowActions["onOpenSession"] | undefined;
  onDelegate: TaskWorkflowActions["onDelegate"] | undefined;
  onHumanApprove: TaskWorkflowActions["onHumanApprove"] | undefined;
  onHumanRequestChanges: TaskWorkflowActions["onHumanRequestChanges"] | undefined;
  onResetImplementation: TaskWorkflowActions["onResetImplementation"] | undefined;
  // The details sheet passes its confirmation dialogs here, not the handlers of the context.
  onResetTask?: ((taskId: string) => void) | undefined;
  onCloseTask?: ((taskId: string) => void) | undefined;
  onRemoveTaskWorktree?: ((taskId: string) => void) | undefined;
};

type TaskWorkflowActionContext = {
  resolveSessionOptions?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
};

/** Run one workflow action of a task through its handler in `callbacks`. */
export const runTaskWorkflowAction = (
  action: TaskWorkflowAction,
  taskId: string | null,
  callbacks: TaskWorkflowCallbacks,
  context?: TaskWorkflowActionContext,
): void => {
  if (!taskId) {
    return;
  }

  switch (action) {
    case "set_spec":
    case "set_plan":
      callbacks.onPlan?.(taskId, action);
      return;
    case "qa_start":
      callbacks.onQaStart?.(taskId);
      return;
    case "open_spec":
    case "open_planner":
    case "open_qa":
    case "open_builder":
      openRoleSession(action, taskId, callbacks, context);
      return;
    case "build_start":
      callbacks.onDelegate?.(taskId);
      return;
    case "human_approve":
      callbacks.onHumanApprove?.(taskId);
      return;
    case "human_request_changes":
      callbacks.onHumanRequestChanges?.(taskId);
      return;
    case "reset_implementation":
      callbacks.onResetImplementation?.(taskId, { closeDetailsAfterReset: true });
      return;
    case "reset_task":
      callbacks.onResetTask?.(taskId);
      return;
    case "close_task":
      callbacks.onCloseTask?.(taskId);
      return;
    case "remove_worktree":
      callbacks.onRemoveTaskWorktree?.(taskId);
      return;
    default:
      return;
  }
};

const openRoleSession = (
  action: SessionRoleViewAction,
  taskId: string,
  callbacks: TaskWorkflowCallbacks,
  context: TaskWorkflowActionContext | undefined,
): void => {
  const role = sessionRoleForViewAction(action);
  if (role === undefined) return;

  if (callbacks.onOpenSession) {
    callbacks.onOpenSession(taskId, role, context?.resolveSessionOptions?.(role));
    return;
  }

  if (action === "open_qa") callbacks.onQaOpen?.(taskId);
  if (action === "open_builder") callbacks.onBuild?.(taskId);
};
