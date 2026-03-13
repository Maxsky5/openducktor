import type { RunSummary, TaskCard } from "@openducktor/contracts";

type ToneVariant = "secondary" | "warning" | "danger" | "success";

const PRIORITY_FALLBACK = "P4";
const PRIORITY_LABELS = ["P0", "P1", "P2", "P3", "P4"] as const;

export const priorityLabel = (priority: number): string => {
  if (!Number.isFinite(priority)) {
    return PRIORITY_FALLBACK;
  }

  if (priority < 0) {
    return PRIORITY_LABELS[0];
  }

  if (priority >= PRIORITY_LABELS.length) {
    return PRIORITY_FALLBACK;
  }

  return PRIORITY_LABELS[priority] ?? PRIORITY_FALLBACK;
};

export const statusLabel = (status: TaskCard["status"]): string => {
  switch (status) {
    case "open":
      return "Backlog";
    case "spec_ready":
      return "Spec ready";
    case "ready_for_dev":
      return "Ready for dev";
    case "in_progress":
      return "In progress";
    case "blocked":
      return "Blocked needs input";
    case "ai_review":
      return "AI review";
    case "human_review":
      return "Human review";
    case "closed":
      return "Done";
    case "deferred":
      return "Deferred";
  }
};

export const statusBadgeVariant = (status: TaskCard["status"]): ToneVariant => {
  if (status === "blocked") {
    return "danger";
  }
  if (status === "in_progress" || status === "ai_review" || status === "human_review") {
    return "warning";
  }
  if (status === "deferred") {
    return "warning";
  }
  if (status === "spec_ready" || status === "ready_for_dev") {
    return "secondary";
  }
  if (status === "closed") {
    return "success";
  }
  return "secondary";
};

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
