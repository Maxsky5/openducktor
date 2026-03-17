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

export type AgentWorkflowStepLiveSession = "none" | "idle" | "running" | "waiting_input" | "stopped" | "error";

export type AgentWorkflowStepState = {
  tone: AgentWorkflowStepTone;
  availability: AgentWorkflowStepAvailability;
  completion: AgentWorkflowStepCompletion;
  liveSession: AgentWorkflowStepLiveSession;
};
