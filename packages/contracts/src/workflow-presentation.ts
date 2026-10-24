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

export type WorkflowStepLiveSession =
  | "waiting_input"
  | "starting"
  | "running"
  | "idle"
  | "stopped"
  | "error"
  | "none";

export type WorkflowStepPresentation = {
  tone: WorkflowStepTone;
  availability: WorkflowStepAvailability;
  completion: WorkflowStepCompletion;
  liveSession: WorkflowStepLiveSession;
};
