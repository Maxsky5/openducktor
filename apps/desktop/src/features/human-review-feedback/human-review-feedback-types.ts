import type { AgentSessionSummary } from "@/state/agent-sessions-store";

export type HumanReviewFeedbackTargetOption = {
  value: string;
  label: string;
  description: string;
  secondaryLabel?: string;
};

export type HumanReviewFeedbackModalModel = {
  open: boolean;
  taskId: string;
  selectedTarget: string;
  targetOptions: HumanReviewFeedbackTargetOption[];
  message: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onTargetChange: (value: string) => void;
  onMessageChange: (message: string) => void;
  onConfirm: () => Promise<void>;
};

export type HumanReviewFeedbackState = {
  taskId: string;
  scenario: "build_after_qa_rejected" | "build_after_human_request_changes";
  message: string;
  builderSessions: AgentSessionSummary[];
  selectedTarget: string;
};

export type PendingHumanReviewHydration = {
  taskId: string;
  baselineSessions: AgentSessionSummary[];
};
