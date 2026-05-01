import type { SettingsSnapshot } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  buildCustomPromptValidationErrors,
  type CustomPromptValidationMap,
  countCustomPromptValidationErrors,
} from "./settings-model";

export type CustomPromptValidationState = {
  errorsById: CustomPromptValidationMap;
  totalErrorCount: number;
};

const EMPTY_CUSTOM_PROMPT_VALIDATION_STATE: CustomPromptValidationState = {
  errorsById: {},
  totalErrorCount: 0,
};

export const useSettingsModalCustomPromptValidation = ({
  snapshotDraft,
}: {
  snapshotDraft: SettingsSnapshot | null;
}): CustomPromptValidationState =>
  useMemo(() => {
    if (!snapshotDraft) {
      return EMPTY_CUSTOM_PROMPT_VALIDATION_STATE;
    }

    const errorsById = buildCustomPromptValidationErrors(snapshotDraft.chat.customPrompts);
    return {
      errorsById,
      totalErrorCount: countCustomPromptValidationErrors(errorsById),
    };
  }, [snapshotDraft]);
