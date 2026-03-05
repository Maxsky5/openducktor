import type { RepoConfig, RepoPromptOverrides, SettingsSnapshot } from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { ensureAgentDefault } from "@/components/features/settings";

type UseSettingsModalDraftActionsArgs = {
  selectedRepoPath: string | null;
  setSnapshotDraft: Dispatch<SetStateAction<SettingsSnapshot | null>>;
};

export type SettingsModalDraftActions = {
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  updateGlobalPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateRepoPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "providerId" | "modelId" | "variant" | "opencodeAgent",
    value: string,
  ) => void;
  clearSelectedRepoAgentDefault: (role: "spec" | "planner" | "build" | "qa") => void;
};

export const useSettingsModalDraftActions = ({
  selectedRepoPath,
  setSnapshotDraft,
}: UseSettingsModalDraftActionsArgs): SettingsModalDraftActions => {
  const updateSelectedRepoConfig = useCallback(
    (updater: (current: RepoConfig) => RepoConfig): void => {
      setSnapshotDraft((current) => {
        if (!current || !selectedRepoPath) {
          return current;
        }

        const existingRepo = current.repos[selectedRepoPath];
        if (!existingRepo) {
          return current;
        }

        return {
          ...current,
          repos: {
            ...current.repos,
            [selectedRepoPath]: updater(existingRepo),
          },
        };
      });
    },
    [selectedRepoPath, setSnapshotDraft],
  );

  const updateGlobalPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          globalPromptOverrides: updater(current.globalPromptOverrides),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateRepoPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        promptOverrides: updater(repoConfig.promptOverrides),
      }));
    },
    [updateSelectedRepoConfig],
  );

  const updateSelectedRepoAgentDefault = useCallback(
    (
      role: "spec" | "planner" | "build" | "qa",
      field: "providerId" | "modelId" | "variant" | "opencodeAgent",
      value: string,
    ): void => {
      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        agentDefaults: {
          ...repoConfig.agentDefaults,
          [role]: {
            ...ensureAgentDefault(repoConfig.agentDefaults[role]),
            [field]: value,
          },
        },
      }));
    },
    [updateSelectedRepoConfig],
  );

  const clearSelectedRepoAgentDefault = useCallback(
    (role: "spec" | "planner" | "build" | "qa"): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const { [role]: _ignored, ...remainingDefaults } = repoConfig.agentDefaults;
        return {
          ...repoConfig,
          agentDefaults: remainingDefaults,
        };
      });
    },
    [updateSelectedRepoConfig],
  );

  return {
    updateSelectedRepoConfig,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
  };
};
