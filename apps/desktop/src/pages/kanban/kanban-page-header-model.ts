import type { BeadsCheck } from "@openducktor/contracts";

export const isKanbanTaskCreationDisabled = (
  activeRepo: string | null,
  beadsCheck: BeadsCheck | null,
): boolean => {
  return !activeRepo || beadsCheck?.beadsOk !== true;
};
