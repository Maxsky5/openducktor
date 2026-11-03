import type { TaskWorkflowContinuation } from "@openducktor/frontend-core/tasks/workflow/task-workflow-continuation";
import type { ClientFeedback } from "@openducktor/frontend-core/platform/client-feedback";
import type { SessionTargetOptions } from "@openducktor/frontend-core/tasks/board/session-target-resolution";
import { runTaskWorkflowAction } from "@openducktor/frontend-core/tasks/workflow/run-task-workflow-action";
import {
  sessionRoleForViewAction,
  type ResolvedTaskCard,
  type TaskWorkflowAction,
  workflowAction,
} from "@openducktor/workflows";

export type TaskConfirmationAction =
  | "reset_implementation"
  | "reset_task"
  | "close_task"
  | "delete";
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
      action: TaskConfirmationAction;
      continuation?: TaskWorkflowContinuation | undefined;
    };

export const resolveTaskActionDestination = (
  action: TaskWorkflowAction,
  task: ResolvedTaskCard,
  sessionOptionsOf: (role: string) => SessionTargetOptions | undefined,
): TaskActionDestination | null => {
  let destination: TaskActionDestination | null = null;
  runTaskWorkflowAction(
    action,
    task.id,
    {
      onLaunch: (_id, launchActionId) => {
        destination = { kind: "launch", launchActionId };
      },
      onApplyEvent: (_id, eventId, launchActionIds) => {
        destination = { kind: "event", eventId, launchActionIds };
      },
      onOpenTaskDetails: () => {
        destination = { kind: "details" };
      },
      onRemoveTaskWorktree: () => {
        destination = { kind: "cleanup" };
      },
      onOpenSession: (_id, role, options) => {
        destination = options
          ? { kind: "open_session", role, options }
          : { kind: "no_session", role };
      },
      onHumanApprove: (_id, continuation) => {
        destination = { kind: "approve", continuation };
      },
      onHumanRequestChanges: (_id, continuation) => {
        destination = { kind: "request_changes", continuation };
      },
      onResetImplementation: (_id, options) => {
        destination = {
          kind: "confirm",
          action: "reset_implementation",
          continuation: options?.continuation,
        };
      },
      onResetTask: (_id, continuation) => {
        destination = {
          kind: "confirm",
          action: "reset_task",
          continuation,
        };
      },
      onCloseTask: (_id, continuation) => {
        destination = {
          kind: "confirm",
          action: "close_task",
          continuation,
        };
      },
    },
    { task, resolveSessionOptions: sessionOptionsOf },
  );
  return destination;
};

export const taskActionSendsCommand = (
  action: TaskWorkflowAction,
  task: ResolvedTaskCard,
): boolean => !sessionRoleForViewAction(action, task) && !opensTaskDetails(task, action);
const opensTaskDetails = (task: ResolvedTaskCard, action: TaskWorkflowAction): boolean => {
  const declaration = workflowAction(task.taskWorkflow, action);
  return (
    declaration.kind === "view" &&
    declaration.stepId === undefined &&
    (declaration.target ?? "task_details") === "task_details"
  );
};
export const showNoSession = (
  feedback: ClientFeedback,
  task: ResolvedTaskCard,
  role: string,
): void =>
  feedback.show("info", `${task.id} has no ${task.taskWorkflow.role(role).label} session.`, {
    description: "Start a session from the task workflow actions.",
  });
