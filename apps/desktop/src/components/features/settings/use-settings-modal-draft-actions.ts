import type {
  GlobalGitConfig,
  RepoConfig,
  RepoPromptOverrides,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { ensureAgentDefault } from "@/components/features/settings";

type UseSettingsModalDraftActionsArgs = {
  selectedRepoPath: string | null;
  setSnapshotDraft: Dispatch<SetStateAction<SettingsSnapshot | null>>;
};

type SettingsModalDraftActions = {
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  updateGlobalGitConfig: (updater: (current: GlobalGitConfig) => GlobalGitConfig) => void;
  updateGlobalChatSettings: (
    updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"],
  ) => void;
  updateGlobalKanbanSettings: (
    updater: (current: SettingsSnapshot["kanban"]) => SettingsSnapshot["kanban"],
  ) => void;
  updateGlobalAutopilotSettings: (
    updater: (current: SettingsSnapshot["autopilot"]) => SettingsSnapshot["autopilot"],
  ) => void;
  updateGlobalPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateRepoPromptOverrides: (
    updater: (current: RepoPromptOverrides) => RepoPromptOverrides,
  ) => void;
  updateSelectedRepoAgentDefault: (
    role: "spec" | "planner" | "build" | "qa",
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
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

  const updateGlobalGitConfig = useCallback(
    (updater: (current: GlobalGitConfig) => GlobalGitConfig): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          git: updater(current.git),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateGlobalChatSettings = useCallback(
    (updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"]): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          chat: updater(current.chat),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateGlobalKanbanSettings = useCallback(
    (updater: (current: SettingsSnapshot["kanban"]) => SettingsSnapshot["kanban"]): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          kanban: updater(current.kanban),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateGlobalAutopilotSettings = useCallback(
    (updater: (current: SettingsSnapshot["autopilot"]) => SettingsSnapshot["autopilot"]): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          autopilot: updater(current.autopilot),
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
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
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
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
  };
};
