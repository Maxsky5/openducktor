import { useCallback } from "react";
import type { DraftSaveBeforeSwitchError } from "@/host-session/host-session-owner";
import { useConfirm } from "@/ui/confirm-dialog";

/**
 * Asks whether to switch hosts when the drafts of the current host were not saved. True means
 * the user accepts to lose them, so the caller switches again with `discardUnsavedDrafts`.
 */
export const useConfirmDraftLoss = (): ((
  cause: DraftSaveBeforeSwitchError,
) => Promise<boolean>) => {
  const confirm = useConfirm();
  return useCallback(
    (cause: DraftSaveBeforeSwitchError) =>
      confirm({
        title: "Drafts Not Saved",
        message: cause.message,
        confirmLabel: "Switch and Lose Changes",
        destructive: true,
      }),
    [confirm],
  );
};
