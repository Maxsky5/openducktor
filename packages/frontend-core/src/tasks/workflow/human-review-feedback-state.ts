import type { TaskWorkflowContinuation } from "./task-workflow-continuation";
import type {
  HumanReviewFeedbackLaunch,
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";
import { type ResolvedTaskCard as TaskCard, launchSessionCommand } from "@openducktor/workflows";

export const createHumanReviewFeedbackState = (
  tasks: TaskCard[],
  taskId: string,
  launchActionId?: string,
  requestChanges = false,
  continuation?: TaskWorkflowContinuation,
): HumanReviewFeedbackState => {
  const task = tasks.find(({ id }) => id === taskId);
  if (!task)
    throw new Error("Task workflow is unavailable. Reload the task before requesting changes.");
  if (!launchActionId && !requestChanges)
    throw new Error(`Task "${taskId}" feedback launch is missing. Open the action again.`);
  const toLaunch = (id: string): HumanReviewFeedbackLaunch => {
    const launch = task.taskWorkflow.launchAction(id);
    return {
      role: launch.role,
      roleLabel: task.taskWorkflow.role(launch.role).label,
      launchActionId: launch.id,
      postStartAction: launchSessionCommand(launch),
    };
  };
  if (!requestChanges)
    return {
      confirmLabel: task.taskWorkflow.launchAction(launchActionId!).label,
      launch: toLaunch(launchActionId!),
      requestChanges: false,
      taskId,
      message: "",
    };
  const eventId = task.taskWorkflow.effectEvent("review.request_changes");
  if (!eventId)
    throw new Error(`Task "${taskId}" declares no Request Changes effect. Reload the task.`);
  if (
    continuation &&
    (continuation.workflow.id !== task.workflow.id ||
      continuation.workflow.revision !== task.workflow.revision)
  )
    throw new Error("The task workflow changed. Reload the task before requesting changes.");
  const candidates = continuation?.launchActionIds ?? (launchActionId ? [launchActionId] : []);
  // The launch is selected in the state that Request Changes gives, so the host can commit the
  // change only after the session start succeeds.
  const following = candidates.length
    ? task.taskWorkflow.launchAfterEvent(eventId, task, candidates)
    : null;
  return {
    confirmLabel: HUMAN_REVIEW_FEEDBACK_COPY.confirmLabel,
    launch: following ? toLaunch(following) : null,
    requestChanges: true,
    taskId,
    message: "",
  };
};

type BuildHumanReviewFeedbackModalModelInput = {
  state: HumanReviewFeedbackState;
  isSubmitting: boolean;
  onDismiss: () => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => Promise<void>;
};

export const buildHumanReviewFeedbackModalModel = ({
  state,
  isSubmitting,
  onDismiss,
  onMessageChange,
  onConfirm,
}: BuildHumanReviewFeedbackModalModelInput): HumanReviewFeedbackModalModel => {
  return {
    open: true,
    taskId: state.taskId,
    roleLabel: state.launch?.roleLabel ?? null,
    confirmLabel: state.confirmLabel,
    message: state.message,
    isSubmitting,
    onOpenChange: (nextOpen: boolean) => {
      if (!nextOpen) {
        onDismiss();
      }
    },
    onMessageChange,
    onConfirm,
  };
};

/** The text of the Request Changes feedback step. */
export const HUMAN_REVIEW_FEEDBACK_COPY = {
  title: "Send Human Feedback",
  description: (roleLabel: string | null) =>
    roleLabel
      ? `Describe the changes you want the ${roleLabel} to make. The next step will use the standard session-start flow to choose whether to reuse an existing ${roleLabel} session or start a new one.`
      : "Describe the changes you want. This action updates the task without starting an agent session.",
  messageLabel: "Your feedback",
  messagePlaceholder: (roleLabel: string | null) =>
    roleLabel
      ? `Describe the changes you want the ${roleLabel} to make.`
      : "Describe the changes you want.",
  cancelLabel: "Cancel",
  confirmLabel: "Request changes",
} as const;

/** Request Changes needs feedback text and waits while its start runs. */
export const isHumanReviewFeedbackConfirmDisabled = (
  model: Pick<HumanReviewFeedbackModalModel, "message" | "isSubmitting">,
): boolean => model.isSubmitting || model.message.trim().length === 0;
