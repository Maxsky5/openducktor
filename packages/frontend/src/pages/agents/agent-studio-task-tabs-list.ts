import type { TaskCard } from "@openducktor/contracts";

export const ensureActiveTaskTab = (openTaskTabs: string[], activeTaskId: string): string[] => {
  if (!activeTaskId || openTaskTabs.includes(activeTaskId)) {
    return openTaskTabs;
  }
  return [...openTaskTabs, activeTaskId];
};

export const reorderTaskTabs = (params: {
  tabTaskIds: string[];
  draggedTaskId: string;
  targetTaskId: string;
  position: "before" | "after";
}): string[] => {
  const { tabTaskIds, draggedTaskId, targetTaskId, position } = params;
  const sourceIndex = tabTaskIds.indexOf(draggedTaskId);
  const targetIndex = tabTaskIds.indexOf(targetTaskId);

  if (sourceIndex < 0 || targetIndex < 0 || draggedTaskId === targetTaskId) {
    return tabTaskIds;
  }

  const nextTabTaskIds = tabTaskIds.filter((taskId) => taskId !== draggedTaskId);
  const nextTargetIndex = nextTabTaskIds.indexOf(targetTaskId);

  if (nextTargetIndex < 0) {
    return tabTaskIds;
  }

  const insertionIndex = position === "before" ? nextTargetIndex : nextTargetIndex + 1;
  nextTabTaskIds.splice(insertionIndex, 0, draggedTaskId);
  return nextTabTaskIds;
};

export const resolveFallbackTaskId = (params: {
  tabTaskIds: string[];
  persistedActiveTaskId: string | null;
}): string | null => {
  if (params.persistedActiveTaskId && params.tabTaskIds.includes(params.persistedActiveTaskId)) {
    return params.persistedActiveTaskId;
  }
  return params.tabTaskIds[0] ?? null;
};

export const getAvailableTabTasks = (tasks: TaskCard[], tabTaskIds: string[]): TaskCard[] => {
  return tasks.filter((task) => !tabTaskIds.includes(task.id));
};

export const closeTaskTab = (params: {
  tabTaskIds: string[];
  taskIdToClose: string;
  activeTaskId: string;
}): { nextTabTaskIds: string[]; nextActiveTaskId: string | null } => {
  const closeIndex = params.tabTaskIds.indexOf(params.taskIdToClose);
  if (closeIndex < 0) {
    return {
      nextTabTaskIds: params.tabTaskIds,
      nextActiveTaskId: params.activeTaskId || null,
    };
  }

  const nextTabTaskIds = params.tabTaskIds.filter((taskId) => taskId !== params.taskIdToClose);
  if (params.taskIdToClose !== params.activeTaskId) {
    return {
      nextTabTaskIds,
      nextActiveTaskId: params.activeTaskId || null,
    };
  }

  const adjacentTab =
    closeIndex >= nextTabTaskIds.length
      ? (nextTabTaskIds[nextTabTaskIds.length - 1] ?? null)
      : (nextTabTaskIds[closeIndex] ?? null);

  return {
    nextTabTaskIds,
    nextActiveTaskId: adjacentTab,
  };
};
