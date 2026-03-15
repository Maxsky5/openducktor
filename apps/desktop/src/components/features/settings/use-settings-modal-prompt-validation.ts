import type { AgentPromptTemplateId, SettingsSnapshot } from "@openducktor/contracts";
import { useMemo } from "react";
import { buildPromptOverrideValidationErrors } from "@/components/features/settings";
import {
  countPromptErrorsByRoleTab,
  type PromptRoleTabId,
  type SettingsSectionId,
} from "./settings-modal-constants";
import {
  EMPTY_PROMPT_VALIDATION_STATE,
  type PromptValidationState,
} from "./settings-modal-controller.types";

type UseSettingsModalPromptValidationArgs = {
  snapshotDraft: SettingsSnapshot | null;
  selectedRepoPath: string | null;
};

type SettingsModalPromptValidation = {
  promptValidationState: PromptValidationState;
  hasPromptValidationErrors: boolean;
  selectedRepoPromptValidationErrors: Partial<Record<AgentPromptTemplateId, string>>;
  selectedRepoPromptValidationErrorCount: number;
  globalPromptRoleTabErrorCounts: Record<PromptRoleTabId, number>;
  selectedRepoPromptRoleTabErrorCounts: Record<PromptRoleTabId, number>;
  settingsSectionErrorCountById: Record<SettingsSectionId, number>;
};

export const useSettingsModalPromptValidation = ({
  snapshotDraft,
  selectedRepoPath,
}: UseSettingsModalPromptValidationArgs): SettingsModalPromptValidation => {
  const promptValidationState = useMemo<PromptValidationState>(() => {
    if (!snapshotDraft) {
      return EMPTY_PROMPT_VALIDATION_STATE;
    }

    const globalErrors = buildPromptOverrideValidationErrors(snapshotDraft.globalPromptOverrides);
    const globalErrorCount = Object.keys(globalErrors).length;
    let repoTotalErrorCount = 0;
    let totalErrorCount = globalErrorCount;

    const repoErrorsByPath: Record<string, Partial<Record<AgentPromptTemplateId, string>>> = {};
    const repoErrorCountByPath: Record<string, number> = {};
    for (const [repoPath, repoConfig] of Object.entries(snapshotDraft.repos)) {
      const repoErrors = buildPromptOverrideValidationErrors(repoConfig.promptOverrides);
      const repoErrorCount = Object.keys(repoErrors).length;
      if (repoErrorCount === 0) {
        continue;
      }
      repoErrorsByPath[repoPath] = repoErrors;
      repoErrorCountByPath[repoPath] = repoErrorCount;
      repoTotalErrorCount += repoErrorCount;
      totalErrorCount += repoErrorCount;
    }

    return {
      globalErrors,
      globalErrorCount,
      repoErrorsByPath,
      repoErrorCountByPath,
      repoTotalErrorCount,
      totalErrorCount,
    };
  }, [snapshotDraft]);

  const selectedRepoPromptValidationErrors = useMemo(
    () =>
      (selectedRepoPath ? promptValidationState.repoErrorsByPath[selectedRepoPath] : undefined) ??
      {},
    [promptValidationState.repoErrorsByPath, selectedRepoPath],
  );
  const selectedRepoPromptValidationErrorCount = selectedRepoPath
    ? (promptValidationState.repoErrorCountByPath[selectedRepoPath] ?? 0)
    : 0;

  const hasPromptValidationErrors = promptValidationState.totalErrorCount > 0;

  const globalPromptRoleTabErrorCounts = useMemo(
    () => countPromptErrorsByRoleTab(promptValidationState.globalErrors),
    [promptValidationState.globalErrors],
  );

  const selectedRepoPromptRoleTabErrorCounts = useMemo(
    () => countPromptErrorsByRoleTab(selectedRepoPromptValidationErrors),
    [selectedRepoPromptValidationErrors],
  );

  const settingsSectionErrorCountById: Record<SettingsSectionId, number> = {
    general: 0,
    git: 0,
    repositories: promptValidationState.repoTotalErrorCount,
    prompts: promptValidationState.globalErrorCount,
    chat: 0,
  };

  return {
    promptValidationState,
    hasPromptValidationErrors,
    selectedRepoPromptValidationErrors,
    selectedRepoPromptValidationErrorCount,
    globalPromptRoleTabErrorCounts,
    selectedRepoPromptRoleTabErrorCounts,
    settingsSectionErrorCountById,
  };
};
