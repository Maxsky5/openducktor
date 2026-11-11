import type {
  AgentModelDefault,
  AgentRuntimes,
  GlobalGitConfig,
  SettingsRepoConfig,
  ReusablePrompt,
  SettingsSnapshot,
} from "@openducktor/contracts";
import {
  globalPromptLayersOf,
  repoPromptLayersOf,
  withGlobalPromptLayers,
  withRepoPromptLayers,
} from "@openducktor/workflows";
import { useCallback } from "react";
import { ensureDraftAgentDefault, updateRepoDefaultModel } from "./settings-modal-model";
import type { PromptSettingsLayersUpdater } from "./settings-prompt-layers";
import type { SettingsSnapshotDraftUpdater } from "./use-settings-modal-snapshot-state";

type UseSettingsModalDraftActionsArgs = {
  selectedWorkspaceId: string | null;
  setSnapshotDraft: (updater: SettingsSnapshotDraftUpdater) => void;
};

export type SettingsModalDraftActions = {
  updateSelectedRepoConfig: (updater: (current: SettingsRepoConfig) => SettingsRepoConfig) => void;
  updateCustomAgentRoles: (
    updater: (
      current: SettingsSnapshot["customAgentRoles"],
    ) => SettingsSnapshot["customAgentRoles"],
  ) => void;
  updateGlobalGitConfig: (updater: (current: GlobalGitConfig) => GlobalGitConfig) => void;
  updateGlobalChatSettings: (
    updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"],
  ) => void;
  updateGlobalSystemSettings: (
    updater: (current: SettingsSnapshot["system"]) => SettingsSnapshot["system"],
  ) => void;
  updateNotificationSettings: (
    updater: (current: SettingsSnapshot["notifications"]) => SettingsSnapshot["notifications"],
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
  updateGlobalPromptLayers: (updater: PromptSettingsLayersUpdater) => void;
  updateRepoPromptLayers: (updater: PromptSettingsLayersUpdater) => void;
  updateSelectedRepoAgentDefault: (
    role: string,
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  clearSelectedRepoAgentDefault: (role: string) => void;
  updateSelectedRepoDefaultModel: (
    field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
    value: string,
  ) => void;
  clearSelectedRepoDefaultModel: () => void;
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
    (updater: (current: SettingsRepoConfig) => SettingsRepoConfig): void => {
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

  const updateGlobalPromptLayers = useCallback(
    (updater: PromptSettingsLayersUpdater): void => {
      setSnapshotDraft((current) => {
        if (!current) return current;
        return withGlobalPromptLayers(current, updater(globalPromptLayersOf(current)));
      });
    },
    [setSnapshotDraft],
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

  const updateGlobalSystemSettings = useCallback(
    (updater: (current: SettingsSnapshot["system"]) => SettingsSnapshot["system"]): void => {
      updateSnapshotSection("system", updater);
    },
    [updateSnapshotSection],
  );

  const updateNotificationSettings = useCallback(
    (
      updater: (current: SettingsSnapshot["notifications"]) => SettingsSnapshot["notifications"],
    ): void => {
      updateSnapshotSection("notifications", updater);
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

  const updateCustomAgentRoles = useCallback(
    (
      updater: (
        current: SettingsSnapshot["customAgentRoles"],
      ) => SettingsSnapshot["customAgentRoles"],
    ): void => {
      updateSnapshotSection("customAgentRoles", updater);
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

  const updateRepoPromptLayers = useCallback(
    (updater: PromptSettingsLayersUpdater): void => {
      updateSelectedRepoConfig((repoConfig) =>
        withRepoPromptLayers(repoConfig, updater(repoPromptLayersOf(repoConfig))),
      );
    },
    [updateSelectedRepoConfig],
  );

  const updateSelectedRepoAgentDefault = useCallback(
    (
      role: string,
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
      value: string,
    ): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const currentRoleDefault = repoConfig.agentDefaults[role];
        const nextRoleDefault = {
          ...ensureDraftAgentDefault(currentRoleDefault),
          runtimeKind: currentRoleDefault?.runtimeKind ?? repoConfig.defaultModel?.runtimeKind,
        };

        return {
          ...repoConfig,
          agentDefaults: {
            ...repoConfig.agentDefaults,
            // SAFETY: the draft can hold a default without runtimeKind. prepareModelDefaultsForSave
            // rejects that default before the save.
            [role]: { ...nextRoleDefault, [field]: value } as AgentModelDefault,
          },
        };
      });
    },
    [updateSelectedRepoConfig],
  );

  const clearSelectedRepoAgentDefault = useCallback(
    (role: string): void => {
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

  const updateSelectedRepoDefaultModel = useCallback(
    (
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
      value: string,
    ): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const nextDefaultModel = updateRepoDefaultModel(repoConfig.defaultModel, field, value);
        return nextDefaultModel ? { ...repoConfig, defaultModel: nextDefaultModel } : repoConfig;
      });
    },
    [updateSelectedRepoConfig],
  );

  const clearSelectedRepoDefaultModel = useCallback((): void => {
    updateSelectedRepoConfig((repoConfig) => ({
      ...repoConfig,
      defaultModel: undefined,
    }));
  }, [updateSelectedRepoConfig]);

  return {
    updateCustomAgentRoles,
    updateSelectedRepoConfig,
    updateGlobalGitConfig,
    updateGlobalChatSettings,
    updateGlobalSystemSettings,
    updateNotificationSettings,
    updateGlobalGeneralSettings,
    updateGlobalAppearanceSettings,
    updateAgentRuntimes,
    updateReusablePrompts,
    updateGlobalKanbanSettings,
    updateGlobalAutopilotSettings,
    updateGlobalPromptLayers,
    updateRepoPromptLayers,
    updateSelectedRepoAgentDefault,
    clearSelectedRepoAgentDefault,
    updateSelectedRepoDefaultModel,
    clearSelectedRepoDefaultModel,
  };
};
