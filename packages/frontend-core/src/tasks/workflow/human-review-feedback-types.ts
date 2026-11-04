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
