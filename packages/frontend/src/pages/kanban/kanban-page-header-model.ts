import type { TaskStoreCheck } from "@openducktor/contracts";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type { ActiveWorkspace } from "@/types/state-slices";

export const isKanbanTaskCreationDisabled = (
  activeWorkspace: ActiveWorkspace | null,
  taskStoreCheck: TaskStoreCheck | null,
): boolean => {
  return !activeWorkspace || !isRepoStoreReady(taskStoreCheck);
};
