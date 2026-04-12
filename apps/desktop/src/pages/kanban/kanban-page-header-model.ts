import type { BeadsCheck } from "@openducktor/contracts";
import { isRepoStoreReady } from "@/lib/repo-store-health";

export const isKanbanTaskCreationDisabled = (
  activeRepo: string | null,
  beadsCheck: BeadsCheck | null,
): boolean => {
  return !activeRepo || !isRepoStoreReady(beadsCheck);
};
