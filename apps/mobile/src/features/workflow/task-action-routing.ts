import type { AgentRole } from "@openducktor/core";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import {
  SESSION_VIEW_ACTIONS,
  type TaskWorkflowAction,
} from "@openducktor/frontend-core/tasks/board/kanban-task-workflow";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import { runTaskWorkflowAction } from "@openducktor/frontend-core/tasks/workflow/run-task-workflow-action";
import { AGENT_ROLE_LABELS } from "@openducktor/frontend-core/types/agent-role-labels";
import type { StartSessionSheetAction } from "@/navigation/routes";

/** The confirmations that a task action asks for on the screen where the user starts it. */
export type TaskConfirmationAction =
  | "reset_implementation"
  | "reset_task"
  | "close_task"
  | "delete";

/** Where a task workflow action goes on mobile. */
export type TaskActionDestination =
  | { kind: "start_session"; action: StartSessionSheetAction }
  | { kind: "open_session"; role: AgentRole; options: SessionTargetOptions }
  | { kind: "no_session"; role: AgentRole }
  | { kind: "approve" }
  | { kind: "request_changes" }
  | { kind: "confirm"; action: TaskConfirmationAction };

/**
 * The mobile destination of a workflow action, through the shared action dispatch of
 * frontend-core. Actions that start a session open the start sheet, approval and Request Changes
 * open their sheets, and Reset and Close ask for confirmation.
 */
export const resolveTaskActionDestination = (
  action: TaskWorkflowAction,
  taskId: string,
  sessionOptionsOf: (role: AgentRole) => SessionTargetOptions | undefined,
): TaskActionDestination | null => {
  let destination: TaskActionDestination | null = null;
  runTaskWorkflowAction(
    action,
    taskId,
    {
      onPlan: (_taskId, planAction) => {
        destination = { kind: "start_session", action: planAction };
      },
      onQaStart: () => {
        destination = { kind: "start_session", action: "qa_start" };
      },
      onDelegate: () => {
        destination = { kind: "start_session", action: "build_start" };
      },
      onQaOpen: undefined,
      onBuild: undefined,
      onOpenSession: (_taskId, role, options) => {
        destination = options
          ? { kind: "open_session", role, options }
          : { kind: "no_session", role };
      },
      onHumanApprove: () => {
        destination = { kind: "approve" };
      },
      onHumanRequestChanges: () => {
        destination = { kind: "request_changes" };
      },
      onResetImplementation: () => {
        destination = { kind: "confirm", action: "reset_implementation" };
      },
      onResetTask: () => {
        destination = { kind: "confirm", action: "reset_task" };
      },
      onCloseTask: () => {
        destination = { kind: "confirm", action: "close_task" };
      },
    },
    { resolveSessionOptions: sessionOptionsOf },
  );
  return destination;
};

/**
 * True when the action leads to a host command: a session start, an approval, Request Changes,
 * or a confirmed change. These follow the command gate, because their sheets need the live host.
 * Opening a session reads only and stays available.
 */
export const taskActionSendsCommand = (action: TaskWorkflowAction): boolean =>
  !SESSION_VIEW_ACTIONS.has(action);

/** Tells the user that a task has no session of a role, so the action opens none. */
export const showNoSession = (feedback: ClientFeedback, taskId: string, role: AgentRole): void =>
  feedback.show("info", `${taskId} has no ${AGENT_ROLE_LABELS[role]} session.`, {
    description: "Start the session from the task workflow actions first.",
  });
