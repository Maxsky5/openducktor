import type { TaskStoreCheck } from "@openducktor/contracts";
import {
  buildRepoStoreUnavailableDescription,
  isRepoStoreReady,
} from "@openducktor/frontend-core/lib/repo-store-health";
import type { ActiveWorkspace } from "@/types/state-slices";

/** The last task store check, and the message of a failed check read. */
export type TaskStoreCheckRead = { data: TaskStoreCheck | null; error: string | null };

/**
 * Why task creation is blocked, or null. A failed check read and a task store that is not ready
 * block it. A pending read does not.
 */
export const taskCreationBlockedReason = ({ data, error }: TaskStoreCheckRead): string | null => {
  if (error !== null) return `Could not check the task store. ${error}`;
  if (data !== null && !isRepoStoreReady(data)) {
    return buildRepoStoreUnavailableDescription(data.repoStoreHealth);
  }
  return null;
};

export const isKanbanTaskCreationDisabled = (
  activeWorkspace: ActiveWorkspace | null,
  taskStoreCheck: TaskStoreCheckRead,
): boolean => !activeWorkspace || taskCreationBlockedReason(taskStoreCheck) !== null;
