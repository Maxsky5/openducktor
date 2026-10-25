import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";
import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

export const createHumanReviewFeedbackState = (
  _tasks: TaskCard[],
  taskId: string,
): HumanReviewFeedbackState => {
  return {
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
  description:
    "Describe the changes you want the Builder to make. The next step will use the standard session-start flow to choose whether to reuse an existing Builder session or start a new one.",
  messageLabel: "Your feedback",
  messagePlaceholder: "Describe the changes you want the Builder to make.",
  cancelLabel: "Cancel",
  confirmLabel: "Request Changes",
} as const;

/** Request Changes needs feedback text and waits while its start runs. */
export const isHumanReviewFeedbackConfirmDisabled = (
  model: Pick<HumanReviewFeedbackModalModel, "message" | "isSubmitting">,
): boolean => model.isSubmitting || model.message.trim().length === 0;
