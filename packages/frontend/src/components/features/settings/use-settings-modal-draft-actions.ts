import type {
  AgentRuntimes,
  GlobalGitConfig,
  RepoConfig,
  RepoPromptOverrides,
  ReusablePrompt,
  SettingsSnapshot,
} from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { ensureDraftAgentDefault } from "@/components/features/settings";

type UseSettingsModalDraftActionsArgs = {
  selectedWorkspaceId: string | null;
  setSnapshotDraft: Dispatch<SetStateAction<SettingsSnapshot | null>>;
};

export type SettingsModalDraftActions = {
  updateSelectedRepoConfig: (updater: (current: RepoConfig) => RepoConfig) => void;
  updateGlobalGitConfig: (updater: (current: GlobalGitConfig) => GlobalGitConfig) => void;
  updateGlobalChatSettings: (
    updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"],
  ) => void;
  updateGlobalGeneralSettings: (
    updater: (current: SettingsSnapshot["general"]) => SettingsSnapshot["general"],
  ) => void;
  updateGlobalAppearanceSettings: (
    updater: (current: SettingsSnapshot["appearance"]) => SettingsSnapshot["appearance"],
  ) => void;
  updateAgentRuntimes: (updater: (current: AgentRuntimes) => AgentRuntimes) => void;
  updateReusablePrompts: (updater: (current: ReusablePrompt[]) => ReusablePrompt[]) => void;
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
  selectedWorkspaceId,
  setSnapshotDraft,
}: UseSettingsModalDraftActionsArgs): SettingsModalDraftActions => {
  const updateSelectedRepoConfig = useCallback(
    (updater: (current: RepoConfig) => RepoConfig): void => {
      setSnapshotDraft((current) => {
        if (!current || !selectedWorkspaceId) {
          return current;
        }

        const existingRepo = current.workspaces[selectedWorkspaceId];
        if (!existingRepo) {
          return current;
        }

        return {
          ...current,
          workspaces: {
            ...current.workspaces,
            [selectedWorkspaceId]: updater(existingRepo),
          },
        };
      });
    },
    [selectedWorkspaceId, setSnapshotDraft],
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

  const updateGlobalGeneralSettings = useCallback(
    (updater: (current: SettingsSnapshot["general"]) => SettingsSnapshot["general"]): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          general: updater(current.general),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateGlobalAppearanceSettings = useCallback(
    (
      updater: (current: SettingsSnapshot["appearance"]) => SettingsSnapshot["appearance"],
    ): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          appearance: updater(current.appearance),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateAgentRuntimes = useCallback(
    (updater: (current: AgentRuntimes) => AgentRuntimes): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          agentRuntimes: updater(current.agentRuntimes),
        };
      });
    },
    [setSnapshotDraft],
  );

  const updateReusablePrompts = useCallback(
    (updater: (current: ReusablePrompt[]) => ReusablePrompt[]): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          reusablePrompts: updater(current.reusablePrompts),
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
      updateSelectedRepoConfig((repoConfig) => {
        const currentRoleDefault = repoConfig.agentDefaults[role];
        const nextRoleDefault = {
          ...ensureDraftAgentDefault(currentRoleDefault),
          runtimeKind: currentRoleDefault?.runtimeKind ?? repoConfig.defaultRuntimeKind,
        };

        return {
          ...repoConfig,
          agentDefaults: {
            ...repoConfig.agentDefaults,
            [role]: {
              ...nextRoleDefault,
              [field]: value,
            },
          },
        };
      });
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
    updateGlobalGeneralSettings,
    updateGlobalAppearanceSettings,
    updateAgentRuntimes,
    updateReusablePrompts,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptOverrides,
    updateRepoPromptOverrides,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
  };
};
