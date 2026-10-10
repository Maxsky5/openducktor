import type { TaskCard } from "@openducktor/contracts";
import { toDisplayTaskLabels } from "@/lib/task-labels";

export const toTaskLabels = toDisplayTaskLabels;

export const toSubtasks = (task: TaskCard | null, taskById: Map<string, TaskCard>): TaskCard[] => {
  if (!task) {
    return [];
  }

  return task.subtaskIds.reduce<TaskCard[]>((subtasks, subtaskId) => {
    const subtask = taskById.get(subtaskId);
    if (subtask) {
      subtasks.push(subtask);
    }
    return subtasks;
  }, []);
};

export const collectDeleteImpactTaskIds = (
  task: TaskCard | null,
  taskById: Map<string, TaskCard>,
): string[] => {
  if (!task) {
    return [];
  }

  const collectedIds: string[] = [];
  const pendingIds = [task.id];
  const seenIds = new Set<string>();

  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift();
    if (!currentId || seenIds.has(currentId)) {
      continue;
    }

    seenIds.add(currentId);
    collectedIds.push(currentId);

    const currentTask = taskById.get(currentId);
    if (!currentTask) {
      continue;
    }

    for (const subtaskId of currentTask.subtaskIds) {
      if (!seenIds.has(subtaskId)) {
        pendingIds.push(subtaskId);
      }
    }
  }

  return collectedIds;
};

export const collectSingleTaskCleanupImpactTaskIds = (task: TaskCard | null): string[] => {
  if (!task) {
    return [];
  }

  return [task.id];
};

/** Which documents the task summary reports, and when each one changed. */
export const toDocumentSummaryState = (task: TaskCard | null) => {
  const summary = task?.documentSummary;
  return {
    specHasDocument: summary?.spec.has,
    planHasDocument: summary?.plan.has,
    qaHasDocument: summary?.qaReport.has,
    specUpdatedAt: summary?.spec.updatedAt ?? null,
    planUpdatedAt: summary?.plan.updatedAt ?? null,
    qaUpdatedAt: summary?.qaReport.updatedAt ?? null,
  };
};

export const shouldLoadDocumentSection = (hasDocument: boolean | undefined): boolean =>
  Boolean(hasDocument);
