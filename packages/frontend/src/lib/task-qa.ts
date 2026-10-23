import type { TaskCard } from "@openducktor/contracts";

export const isQaRejectedTask = (task: TaskCard | null | undefined): boolean => {
  if (!task) {
    return false;
  }

  return (
    (task.status === "in_progress" || task.status === "blocked") &&
    task.artifactSummary.qaReport.verdict === "rejected"
  );
};
