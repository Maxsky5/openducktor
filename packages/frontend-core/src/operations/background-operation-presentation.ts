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

export const canFinishClosingTask = ({ target, progress }: BackgroundAttempt): boolean => {
  if (target.kind !== "task" || !progress) return false;

  const { steps } = progress;
  return (
    steps.some((step) => step.id === "pr-link" && step.state === "completed") &&
    !steps.some((step) => step.id === "task-close" && step.state === "completed")
  );
};
