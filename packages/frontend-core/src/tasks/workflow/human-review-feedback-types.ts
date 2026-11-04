import type { TaskWorkflowContinuation } from "./task-workflow-continuation";
export type HumanReviewFeedbackModalModel = {
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

/** What the feedback form does: start a feedback launch, or run Request Changes. */
export type HumanReviewFeedbackRequest =
  | { kind: "launch"; launchActionId: string }
  | { kind: "request_changes"; continuation?: TaskWorkflowContinuation | undefined };

export type HumanReviewFeedbackLaunch = {
  role: string;
  roleLabel: string;
  launchActionId: string;
  postStartAction: "kickoff" | "send_message";
};

export type HumanReviewFeedbackState = {
  /** The session that receives the feedback. Request Changes without a following launch has none. */
  launch: HumanReviewFeedbackLaunch | null;
  /** The host commits Request Changes, before the launch starts when there is one. */
  requestChanges: boolean;
  confirmLabel: string;
  taskId: string;
  message: string;
};
