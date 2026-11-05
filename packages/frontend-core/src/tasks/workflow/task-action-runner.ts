import type { ResolvedTaskCard, TaskWorkflowAction } from "@openducktor/workflows";
import { errorMessage } from "../../lib/errors";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import {
  resolveTaskActionDestination,
  type SessionOptionsOf,
  type TaskActionConfirmation,
} from "./task-action-destination";
import type {
  ContinueTaskWorkflow,
  OnTaskCommitted,
  TaskWorkflowContinuation,
} from "./task-workflow-continuation";

/** The client controls that run each destination of a workflow action. */
export type TaskActionRunnerHandlers = {
  onLaunch: (taskId: string, launchActionId: string) => void;
  onApplyEvent: (taskId: string, eventId: string, launchActionIds: readonly string[]) => void;
  onOpenTaskDetails: (taskId: string) => void;
  /** Without options, the role has no session that the surface can open. */
  onOpenSession: (taskId: string, role: string, options?: SessionTargetOptions) => void;
  /** Approval and Request Changes open their own forms, which can be routes, so they get the continuation. */
  onHumanApprove: (taskId: string, continuation?: TaskWorkflowContinuation) => void;
  onHumanRequestChanges: (taskId: string, continuation?: TaskWorkflowContinuation) => void;
  onConfirm: (
    taskId: string,
    action: TaskActionConfirmation,
    onCommitted?: OnTaskCommitted,
  ) => void;
  continueTaskWorkflow: ContinueTaskWorkflow;
  showError: (title: string, description: string) => void;
};

/** The surface parts of a workflow action run. Without them, the shared controls run it. */
export type TaskActionRunOptions = {
  sessionOptionsOf?: SessionOptionsOf | undefined;
  /** The details sheet reads the worktree, so it owns the removal. Other surfaces open the details. */
  onRemoveWorktree?: (() => void) | undefined;
};

export type RunTaskAction = (
  task: ResolvedTaskCard,
  action: TaskWorkflowAction,
  options?: TaskActionRunOptions,
) => void;

/**
 * The one runner of declared workflow actions for every client and surface. A committed effect
 * continues into its declared launch here, so no effect owner adapts the continuation itself.
 */
export const createTaskActionRunner =
  (handlers: TaskActionRunnerHandlers): RunTaskAction =>
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
      }
      const { continuation } = destination;
      const onCommitted: OnTaskCommitted | undefined = continuation
        ? (committed) => handlers.continueTaskWorkflow(committed, continuation)
        : undefined;
      handlers.onConfirm(task.id, destination.action, onCommitted);
    } catch (cause) {
      handlers.showError("Workflow action failed", errorMessage(cause));
    }
  };
