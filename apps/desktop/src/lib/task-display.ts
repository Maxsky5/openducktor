import type { TaskCard } from "@openducktor/contracts";

export { statusBadgeClassName, statusLabel } from "./task-status-presentation";

const hasPullRequestManageableStatus = (status: TaskCard["status"]): boolean =>
  status === "in_progress" || status === "ai_review" || status === "human_review";

export const canDetectTaskPullRequest = (task: TaskCard): boolean =>
  hasPullRequestManageableStatus(task.status) && task.agentWorkflows.builder.completed;

export const canUnlinkTaskPullRequest = (status: TaskCard["status"]): boolean =>
  hasPullRequestManageableStatus(status);

export const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};
