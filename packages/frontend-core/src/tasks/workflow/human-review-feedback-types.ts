import type { TaskWorkflowContinuation } from "./task-workflow-continuation";
export type HumanReviewFeedbackModalModel = {
  hasContinuation?: boolean;
  roleLabel: string | null;
  confirmLabel: string;
  open: boolean;
  taskId: string;
  message: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => Promise<void>;
};

export type HumanReviewFeedbackLaunch = {
  role: string;
  roleLabel: string;
  launchActionId: string;
  postStartAction: "kickoff" | "send_message";
};

export type HumanReviewFeedbackState = {
  launch: HumanReviewFeedbackLaunch | null;
  confirmLabel: string;
  taskId: string;
  message: string;
  continuation?: TaskWorkflowContinuation;
};
