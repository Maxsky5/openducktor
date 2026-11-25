import { TASK_CLOSED_STATE } from "@openducktor/contracts";
import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

/**
 * Pull request management is an OpenDucktor feature, so no workflow event controls it. The host
 * allows it for a task that is not closed.
 */
export const canUnlinkTaskPullRequest = (task: TaskCard): boolean =>
  task.status !== TASK_CLOSED_STATE;

/**
 * Detection searches the task branch. Every agent session of the task works in the task worktree,
 * so a completed agent step created that branch.
 */
export const canDetectTaskPullRequest = (task: TaskCard): boolean =>
  canUnlinkTaskPullRequest(task) &&
  task.workflowSteps.some((step) => step.kind === "agent" && step.completed);

export const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};
