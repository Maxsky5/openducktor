import type { TaskCard } from "@openducktor/contracts";
import { isQaRejectedTask } from "./task-qa";

type BuildContinuationScenario =
  | "build_implementation_start"
  | "build_after_qa_rejected"
  | "build_after_human_request_changes";

export type BuildRequestChangesScenario = "build_after_human_request_changes";

export const resolveBuildContinuationScenario = (
  task: TaskCard | null | undefined,
): BuildContinuationScenario => {
  if (task?.status === "human_review") {
    return "build_after_human_request_changes";
  }
  return isQaRejectedTask(task) ? "build_after_qa_rejected" : "build_implementation_start";
};

export const resolveBuildRequestChangesScenario = (
  _task: TaskCard | null | undefined,
): BuildRequestChangesScenario => {
  return "build_after_human_request_changes";
};
