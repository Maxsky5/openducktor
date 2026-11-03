import { type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

export const canUnlinkTaskPullRequest = (task: TaskCard): boolean =>
  (() => {
    const workflow = task.taskWorkflow;
    const event = workflow.effectEvent("pull_request.manage");
    return event !== undefined && workflow.isEventAvailable(event, task);
  })();

export const canDetectTaskPullRequest = (task: TaskCard): boolean =>
  canUnlinkTaskPullRequest(task) &&
  task.workflowSteps.some(
    (step) =>
      step.kind === "agent" && step.completed && task.taskWorkflow.usesWorktree(step.roleId),
  );

export const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};
