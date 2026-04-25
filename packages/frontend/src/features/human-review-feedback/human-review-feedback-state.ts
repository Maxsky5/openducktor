import type { TaskCard } from "@openducktor/contracts";
import {
  type BuildRequestChangesScenario,
  resolveBuildRequestChangesScenario,
} from "@/lib/build-scenarios";
import type {
  HumanReviewFeedbackModalModel,
  HumanReviewFeedbackState,
} from "./human-review-feedback-types";

const resolveRequestChangesScenario = (task: TaskCard | undefined): BuildRequestChangesScenario => {
  return resolveBuildRequestChangesScenario(task);
};

export const createHumanReviewFeedbackState = (
  tasks: TaskCard[],
  taskId: string,
): HumanReviewFeedbackState => {
  const task = tasks.find((entry) => entry.id === taskId);
  const scenario = resolveRequestChangesScenario(task);

  return {
    taskId,
    scenario,
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
