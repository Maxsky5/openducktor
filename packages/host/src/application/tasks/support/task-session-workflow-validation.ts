import { Effect } from "effect";
import type { TaskFacts, TaskWorkflow } from "@openducktor/workflows";
import { HostValidationError } from "../../../effect/host-errors";

export const validateTaskSessionWorkflowAvailable = (
  workflow: TaskWorkflow,
  task: TaskFacts,
  role: string,
  repoPath: string,
) => {
  if (workflow.project(task).agentWorkflows[role]?.available) {
    return Effect.void;
  }

  return Effect.fail(
    new HostValidationError({
      field: "role",
      message: `${role} workflow is not available for task ${task.id}.`,
      details: { repoPath, taskId: task.id, role, status: task.status },
    }),
  );
};
