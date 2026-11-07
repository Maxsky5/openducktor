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

/**
 * What the feedback form does: start a feedback launch, or apply an event whose following launch
 * collects the feedback.
 */
export type HumanReviewFeedbackRequest =
  | { kind: "launch"; launchActionId: string }
  | { kind: "event"; eventId: string; continuation?: TaskWorkflowContinuation | undefined };

export type HumanReviewFeedbackLaunch = {
  role: string;
  roleLabel: string;
  launchActionId: string;
  postStartAction: "kickoff" | "send_message";
};

export type HumanReviewFeedbackState = {
  /** The session that receives the feedback. An event without a following launch has none. */
  launch: HumanReviewFeedbackLaunch | null;
  /** The event that the host commits, before the launch starts when there is one. */
  eventId: string | null;
  confirmLabel: string;
  taskId: string;
  message: string;
};
