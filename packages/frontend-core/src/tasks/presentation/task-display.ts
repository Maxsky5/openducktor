import { isTaskEventAvailable, type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";

export const canUnlinkTaskPullRequest = (task: TaskCard): boolean =>
  isTaskEventAvailable("manage-pull-request", task);

export const canDetectTaskPullRequest = (task: TaskCard): boolean =>
  canUnlinkTaskPullRequest(task) && task.agentWorkflows.build.completed;

export const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};
