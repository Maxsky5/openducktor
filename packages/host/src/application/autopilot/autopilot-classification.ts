import type { AutopilotEventId, TaskEventStatusChange } from "@openducktor/contracts";
import type { TaskMutationOperation } from "../tasks/task-mutation-operation";

/**
 * Names the Autopilot rule of one committed status change, or null. Only forward workflow steps
 * qualify. The operation proves a QA rejection, because a task status alone cannot.
 */
export const classifyCommittedStatusChange = (
  operation: TaskMutationOperation,
  { previousStatus, task: { status } }: TaskEventStatusChange,
): AutopilotEventId | null => {
  switch (operation) {
    case "set-spec":
      return previousStatus === "open" && status === "spec_ready"
        ? "taskProgressedToSpecReady"
        : null;
    case "set-plan":
      return (previousStatus === "open" || previousStatus === "spec_ready") &&
        status === "ready_for_dev"
        ? "taskProgressedToReadyForDev"
        : null;
    case "build-completed":
      if (status === "ai_review") return "taskProgressedToAiReview";
      return status === "human_review" ? "taskProgressedToHumanReview" : null;
    case "qa-rejected":
      return status === "in_progress" &&
        (previousStatus === "blocked" ||
          previousStatus === "ai_review" ||
          previousStatus === "human_review")
        ? "taskRejectedByQa"
        : null;
    case "qa-approved":
      return status === "human_review" ? "taskProgressedToHumanReview" : null;
    default:
      return null;
  }
};
