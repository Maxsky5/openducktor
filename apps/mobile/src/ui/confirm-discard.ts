import { useCallback } from "react";
import { useConfirm } from "./confirm-dialog";

/** What the discard question names, such as "Discard Changes?" and "Your edits are not saved." */
export type DiscardCopy = { title: string; message: string };

/**
 * Asks before an action drops unsaved input, with Discard and Keep Editing. True means the user
 * accepts to lose the input. Close, Android Back, and the iOS swipe of a sheet ask with it.
 */
export const useConfirmDiscard = (): ((copy: DiscardCopy) => Promise<boolean>) => {
  const confirm = useConfirm();
  return useCallback(
    (copy: DiscardCopy) =>
      confirm({ ...copy, confirmLabel: "Discard", cancelLabel: "Keep Editing", destructive: true }),
    [confirm],
  );
};
