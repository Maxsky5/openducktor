import type { BackgroundOperationStep } from "@openducktor/contracts";
import type { BackgroundAttempt } from "./background-operation-store";

export const backgroundOperationStatus = {
  running: "In progress",
  succeeded: "Complete",
  failed: "Failed",
  unconfirmed: "Result unconfirmed",
} as const;

export const backgroundStepStatus = {
  pending: "Pending",
  waiting: "Waiting",
  running: "In progress",
  completed: "Complete",
  failed: "Failed",
  not_run: "Did not run",
} satisfies Record<BackgroundOperationStep["state"], string>;

export const canFinishClosingTask = (attempt: BackgroundAttempt) =>
  attempt.action === "Link merged pull request" &&
  attempt.progress?.steps.some((step) => step.id === "pr-link" && step.state === "completed") ===
    true &&
  !attempt.progress.steps.some((step) => step.id === "task-close" && step.state === "completed");
