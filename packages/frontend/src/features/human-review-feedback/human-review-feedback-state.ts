import type { TaskCard } from "@openducktor/contracts";
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";

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
