import type { AgentRole, TaskCard } from "@openducktor/contracts";
import { Effect } from "effect";
import { deriveAgentWorkflows } from "../../../domain/task";
import { HostValidationError } from "../../../effect/host-errors";

export const validateTaskSessionWorkflowAvailable = (
  task: TaskCard,
  role: AgentRole,
  repoPath: string,
) => {
  const workflows = deriveAgentWorkflows(task);
  const workflow = role === "build" ? workflows.builder : workflows[role];
  if (workflow.available) {
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
