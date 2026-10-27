import type { AgentSessionActivityState } from "./agent-session-activity";

export type WorkflowStepTone =
  | "done"
  | "in_progress"
  | "available"
  | "optional"
  | "blocked"
  | "rejected"
  | "waiting_input"
  | "failed";

export type WorkflowStepAvailability = "available" | "optional" | "blocked";

export type WorkflowStepCompletion = "not_started" | "in_progress" | "done" | "rejected";

export type WorkflowStepLiveSession = AgentSessionActivityState | "none";

export type WorkflowStepPresentation = {
  tone: WorkflowStepTone;
  availability: WorkflowStepAvailability;
  completion: WorkflowStepCompletion;
  liveSession: WorkflowStepLiveSession;
};

export type WorkflowStepAttentionVariant = "none" | "session_waiting_input" | "blocked_task";

export type WorkflowStepRailState = {
  hint: string;
  attentionVariant: WorkflowStepAttentionVariant;
};
