import type { TaskCard, TaskUpdatePatch } from "@openducktor/contracts";

export const WORKSPACE_REQUIRED_ERROR = "Select a workspace first.";
export const DEFERRED_BY_USER_REASON = "Deferred by user";

export const requireActiveRepo = (activeRepo: string | null): string => {
  if (!activeRepo) {
    throw new Error(WORKSPACE_REQUIRED_ERROR);
  }
  return activeRepo;
};

export const toVisibleTasks = (taskList: TaskCard[]): TaskCard[] =>
  taskList.filter((task) => task.status !== "deferred");

export const toNormalizedTitle = (title: string): string => title.trim();

export const toUpdateSuccessDescription = (taskId: string, patch: TaskUpdatePatch): string => {
  const nextTitle = patch.title?.trim();
  return nextTitle && nextTitle.length > 0 ? nextTitle : taskId;
};
