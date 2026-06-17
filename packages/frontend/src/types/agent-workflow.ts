import type { AgentSessionActivityState } from "@/types/agent-session-activity";

export type AgentWorkflowStepTone =
  | "done"
  | "in_progress"
  | "available"
  | "optional"
  | "blocked"
  | "rejected"
  | "waiting_input"
  | "failed";

export type AgentWorkflowStepAvailability = "available" | "optional" | "blocked";

export type AgentWorkflowStepCompletion = "not_started" | "in_progress" | "done" | "rejected";

export type AgentWorkflowStepLiveSession = AgentSessionActivityState | "none";

export type AgentWorkflowStepState = {
  tone: AgentWorkflowStepTone;
  availability: AgentWorkflowStepAvailability;
  completion: AgentWorkflowStepCompletion;
  liveSession: AgentWorkflowStepLiveSession;
};
