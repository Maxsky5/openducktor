import { useMemo } from "react";
import type { SettingsModalDraftActions } from "./use-settings-modal-draft-actions";

type UseSettingsModalDirtyDraftActionsArgs = {
  clearSaveError: () => void;
  draftActions: SettingsModalDraftActions;
};

type DraftActionResult = ReturnType<SettingsModalDraftActions[keyof SettingsModalDraftActions]>;

export const useSettingsModalDirtyDraftActions = ({
  clearSaveError,
  draftActions,
}: UseSettingsModalDirtyDraftActionsArgs): SettingsModalDraftActions =>
  useMemo(() => {
    const actions = Object.entries<(...args: never[]) => DraftActionResult>(draftActions);
    // SAFETY: Each wrapper keeps the original key and forwards every argument and the result.
    return Object.fromEntries(
      actions.map(([key, action]) => [
        key,
        (...args: never[]) => {
          clearSaveError();
          return action(...args);
        },
      ]),
    ) as SettingsModalDraftActions;
  }, [clearSaveError, draftActions]);
