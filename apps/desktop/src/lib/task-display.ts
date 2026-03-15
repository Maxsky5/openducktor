import type { RunSummary, TaskCard } from "@openducktor/contracts";

export { statusBadgeClassName, statusLabel } from "./task-status-presentation";

const hasPullRequestManageableStatus = (status: TaskCard["status"]): boolean =>
  status === "in_progress" || status === "ai_review" || status === "human_review";

const hasActiveBuilderRun = (taskId: string, runs: RunSummary[]): boolean =>
  runs.some(
    (run) =>
      run.taskId === taskId &&
      (run.state === "starting" ||
        run.state === "running" ||
        run.state === "blocked" ||
        run.state === "awaiting_done_confirmation"),
  );

export const canDetectTaskPullRequest = (task: TaskCard, runs: RunSummary[]): boolean =>
  hasPullRequestManageableStatus(task.status) &&
  (task.agentWorkflows.builder.completed || hasActiveBuilderRun(task.id, runs));

export const canUnlinkTaskPullRequest = (status: TaskCard["status"]): boolean =>
  hasPullRequestManageableStatus(status);

export const humanDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString();
};
