import {
  BACKGROUND_OPERATION_PR_ALREADY_LINKED,
  type BackgroundOperationStep,
} from "@openducktor/contracts";
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

export const canFinishClosingTask = ({ target, progress }: BackgroundAttempt): boolean => {
  if (target.kind !== "task" || progress?.phase !== "failed") return false;

  const { steps } = progress;
  return (
    (progress.failure.code === BACKGROUND_OPERATION_PR_ALREADY_LINKED ||
      steps.some((step) => step.id === "pr-link" && step.state === "completed")) &&
    !steps.some((step) => step.id === "task-close" && step.state === "completed")
  );
};
