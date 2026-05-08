import type { TaskCard } from "@openducktor/contracts";

export const collectTaskDeletionIds = (
  tasks: TaskCard[],
  taskId: string,
  deleteSubtasks: boolean,
): string[] => {
  if (!deleteSubtasks) {
    return [taskId];
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const collectedIds: string[] = [];
  const pendingIds = [taskId];
  const seenIds = new Set<string>();

  while (pendingIds.length > 0) {
    const currentId = pendingIds.shift();
    if (!currentId || seenIds.has(currentId)) {
      continue;
    }

    seenIds.add(currentId);
    collectedIds.push(currentId);

    for (const subtaskId of taskById.get(currentId)?.subtaskIds ?? []) {
      if (!seenIds.has(subtaskId)) {
        pendingIds.push(subtaskId);
      }
    }
  }

  return collectedIds;
};
