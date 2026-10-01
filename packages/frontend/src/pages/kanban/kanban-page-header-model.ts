import type { TaskStoreCheck } from "@openducktor/contracts";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type { ActiveWorkspace } from "@/types/state-slices";

export const isKanbanTaskCreationDisabled = (
  activeWorkspace: ActiveWorkspace | null,
  taskStoreCheck: TaskStoreCheck | null,
): boolean => {
  // Opening a composer is local UI. A pending diagnostic must not block it.
  return !activeWorkspace || (taskStoreCheck !== null && !isRepoStoreReady(taskStoreCheck));
};
