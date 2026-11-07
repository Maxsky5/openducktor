import type {
  HumanReviewFeedbackLaunch,
  HumanReviewFeedbackRequest,
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";
import { type ResolvedTaskCard as TaskCard, launchSessionCommand } from "@openducktor/workflows";

export const createHumanReviewFeedbackState = (
  tasks: readonly TaskCard[],
  taskId: string,
  request: HumanReviewFeedbackRequest,
): HumanReviewFeedbackState => {
  const task = tasks.find(({ id }) => id === taskId);
  if (!task)
    throw new Error("Task workflow is unavailable. Reload the task before requesting changes.");
  const toLaunch = (id: string): HumanReviewFeedbackLaunch => {
    const launch = task.taskWorkflow.launchAction(id);
    return {
      role: launch.role,
      roleLabel: task.taskWorkflow.role(launch.role).label,
      launchActionId: launch.id,
      postStartAction: launchSessionCommand(launch),
    };
  };
  if (request.kind === "launch") {
    // A launch that an available event action starts next also commits the event of that action,
    // so the task moves as it does from the action.
    let eventId: string | null = null;
    for (const id of task.availableActions) {
      const action = task.taskWorkflow.action(id);
      if (action.kind === "event" && action.launchActionIds?.includes(request.launchActionId)) {
        eventId = action.eventId;
        break;
      }
    }
    return {
      confirmLabel:
        eventId !== null
          ? HUMAN_REVIEW_FEEDBACK_COPY.confirmLabel
          : task.taskWorkflow.launchAction(request.launchActionId).label,
      launch: toLaunch(request.launchActionId),
      eventId,
      taskId,
      message: "",
    };
  }
  const { continuation, eventId } = request;
  if (
    continuation &&
    (continuation.workflow.id !== task.workflow.id ||
      continuation.workflow.revision !== task.workflow.revision)
  )
    throw new Error("The task workflow changed. Reload the task before requesting changes.");
  const candidates = continuation?.launchActionIds ?? [];
  // The launch is selected in the state that the event gives, so the host can commit the event
  // only after the session start succeeds.
  const following = candidates.length
    ? task.taskWorkflow.launchAfterEvent(eventId, task, candidates)
    : null;
  return {
    confirmLabel: HUMAN_REVIEW_FEEDBACK_COPY.confirmLabel,
    launch: following ? toLaunch(following) : null,
    eventId,
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
  title: "Request changes",
  description: (roleLabel: string | null) =>
    roleLabel
      ? `Describe the changes you want the ${roleLabel} to make. Next, you choose to continue an existing ${roleLabel} session or start a new one.`
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
