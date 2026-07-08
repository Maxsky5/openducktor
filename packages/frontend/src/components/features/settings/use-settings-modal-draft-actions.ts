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
  const updateSnapshotSection = useCallback(
    <Section extends keyof SettingsSnapshot>(
      section: Section,
      updater: (current: SettingsSnapshot[Section]) => SettingsSnapshot[Section],
    ): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          [section]: updater(current[section]),
        };
      });
    },
    [setSnapshotDraft],
  );

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
      updateSnapshotSection("globalPromptOverrides", updater);
    },
    [updateSnapshotSection],
  );

  const updateGlobalGitConfig = useCallback(
    (updater: (current: GlobalGitConfig) => GlobalGitConfig): void => {
      updateSnapshotSection("git", updater);
    },
    [updateSnapshotSection],
  );

  const updateGlobalChatSettings = useCallback(
    (updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"]): void => {
      updateSnapshotSection("chat", updater);
    },
    [updateSnapshotSection],
  );

  const updateGlobalGeneralSettings = useCallback(
    (updater: (current: SettingsSnapshot["general"]) => SettingsSnapshot["general"]): void => {
      updateSnapshotSection("general", updater);
    },
    [updateSnapshotSection],
  );

  const updateGlobalAppearanceSettings = useCallback(
    (
      updater: (current: SettingsSnapshot["appearance"]) => SettingsSnapshot["appearance"],
    ): void => {
      updateSnapshotSection("appearance", updater);
    },
    [updateSnapshotSection],
  );

  const updateAgentRuntimes = useCallback(
    (updater: (current: AgentRuntimes) => AgentRuntimes): void => {
      updateSnapshotSection("agentRuntimes", updater);
    },
    [updateSnapshotSection],
  );

  const updateReusablePrompts = useCallback(
    (updater: (current: ReusablePrompt[]) => ReusablePrompt[]): void => {
      updateSnapshotSection("reusablePrompts", updater);
    },
    [updateSnapshotSection],
  );

  const updateGlobalKanbanSettings = useCallback(
    (updater: (current: SettingsSnapshot["kanban"]) => SettingsSnapshot["kanban"]): void => {
      updateSnapshotSection("kanban", updater);
    },
    [updateSnapshotSection],
  );

  const updateGlobalAutopilotSettings = useCallback(
    (updater: (current: SettingsSnapshot["autopilot"]) => SettingsSnapshot["autopilot"]): void => {
      updateSnapshotSection("autopilot", updater);
    },
    [updateSnapshotSection],
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
