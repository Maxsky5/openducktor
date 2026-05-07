import type { SettingsSnapshot } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  buildReusablePromptValidationErrors,
  countReusablePromptValidationErrors,
  type ReusablePromptValidationMap,
} from "@/state/read-models/settings-read-model";

export type ReusablePromptValidationState = {
  errorsById: ReusablePromptValidationMap;
  totalErrorCount: number;
};

const EMPTY_REUSABLE_PROMPT_VALIDATION_STATE: ReusablePromptValidationState = {
  errorsById: {},
  totalErrorCount: 0,
};

export const useSettingsModalReusablePromptValidation = ({
  snapshotDraft,
}: {
  snapshotDraft: SettingsSnapshot | null;
}): ReusablePromptValidationState =>
  useMemo(() => {
    if (!snapshotDraft) {
      return EMPTY_REUSABLE_PROMPT_VALIDATION_STATE;
    }

    const errorsById = buildReusablePromptValidationErrors(snapshotDraft.reusablePrompts);
    return {
      errorsById,
      totalErrorCount: countReusablePromptValidationErrors(errorsById),
    };
  }, [snapshotDraft]);
