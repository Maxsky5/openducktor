import type { BeadsCheck } from "@openducktor/contracts";
import { isRepoStoreReady } from "@/lib/repo-store-health";
import type { ActiveWorkspace } from "@/types/state-slices";

export const isKanbanTaskCreationDisabled = (
  activeWorkspace: ActiveWorkspace | null,
  beadsCheck: BeadsCheck | null,
): boolean => {
  return !activeWorkspace || !isRepoStoreReady(beadsCheck);
};
