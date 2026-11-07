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
  /** The approval of OpenDucktor opens its own form, which can be a route. */
  onHumanApprove: (taskId: string) => void;
  /**
   * An event whose following launch collects human feedback opens its own form, which can be a
   * route, so it gets the event and the continuation.
   */
  onHumanFeedback: (
    taskId: string,
    eventId: string,
    continuation?: TaskWorkflowContinuation,
  ) => void;
  onConfirm: (
    taskId: string,
    action: TaskActionConfirmation,
    eventId: string,
    onCommitted?: OnTaskCommitted,
  ) => void;
  continueTaskWorkflow: ContinueTaskWorkflow;
  showError: (title: string, description: string) => void;
};

/** The surface parts of a workflow action run. Without them, the shared controls run it. */
export type TaskActionRunOptions = {
  sessionOptionsOf?: SessionOptionsOf | undefined;
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
        case "open_session":
          handlers.onOpenSession(task.id, destination.role, destination.options);
          return;
        case "no_session":
          handlers.onOpenSession(task.id, destination.role);
          return;
        case "approve":
          handlers.onHumanApprove(task.id);
          return;
        case "feedback":
          handlers.onHumanFeedback(task.id, destination.eventId, destination.continuation);
          return;
      }
      const { continuation } = destination;
      const onCommitted: OnTaskCommitted | undefined = continuation
        ? (committed) => handlers.continueTaskWorkflow(committed, continuation)
        : undefined;
      handlers.onConfirm(task.id, destination.action, destination.eventId, onCommitted);
    } catch (cause) {
      handlers.showError("Workflow action failed", errorMessage(cause));
    }
  };
