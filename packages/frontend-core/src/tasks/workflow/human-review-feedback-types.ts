export type HumanReviewFeedbackModalModel = {
  open: boolean;
  taskId: string;
  message: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => Promise<void>;
};

export type HumanReviewFeedbackState = {
  taskId: string;
  message: string;
};
