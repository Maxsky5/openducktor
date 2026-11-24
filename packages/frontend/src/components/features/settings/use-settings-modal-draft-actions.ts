import type {
  AgentModelDefault,
  SettingsRepoConfig,
  SettingsSnapshot,
} from "@openducktor/contracts";
import {
  globalPromptLayersOf,
  repoPromptLayersOf,
  withGlobalPromptLayers,
  withRepoPromptLayers,
} from "@openducktor/workflows";
import { useMemo } from "react";
import type { RepoAgentDefaultInput } from "@/types/state-slices";
import { applyRepoAgentDefaultField } from "@/components/features/repository/model-defaults/model-defaults-model";
import { ensureDraftAgentDefault, updateRepoDefaultModel } from "./settings-modal-model";
import type { PromptSettingsLayersUpdater } from "./settings-prompt-layers";
import type { SettingsSnapshotDraftUpdater } from "./use-settings-modal-snapshot-state";

type UseSettingsModalDraftActionsArgs = {
  selectedWorkspaceId: string | null;
  setSnapshotDraft: (updater: SettingsSnapshotDraftUpdater) => void;
};

const createDraftActions = ({
  selectedWorkspaceId,
  setSnapshotDraft,
}: UseSettingsModalDraftActionsArgs) => {
  const createSectionUpdater =
    <Section extends keyof SettingsSnapshot>(section: Section) =>
    (updater: (current: SettingsSnapshot[Section]) => SettingsSnapshot[Section]): void => {
      setSnapshotDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          [section]: updater(current[section]),
        };
      });
    };

  const updateSelectedRepoConfig = (
    updater: (current: SettingsRepoConfig) => SettingsRepoConfig,
  ): void => {
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
  };

  return {
    updateSelectedRepoConfig,
    updateGlobalPromptLayers: (updater: PromptSettingsLayersUpdater): void => {
      setSnapshotDraft((current) => {
        if (!current) return current;
        return withGlobalPromptLayers(current, updater(globalPromptLayersOf(current)));
      });
    },

    updateGlobalGitConfig: createSectionUpdater("git"),
    updateGlobalChatSettings: createSectionUpdater("chat"),
    updateGlobalSystemSettings: createSectionUpdater("system"),
    updateNotificationSettings: createSectionUpdater("notifications"),
    updateGlobalGeneralSettings: createSectionUpdater("general"),
    updateGlobalAppearanceSettings: createSectionUpdater("appearance"),
    updateAgentRuntimes: createSectionUpdater("agentRuntimes"),
    updateReusablePrompts: createSectionUpdater("reusablePrompts"),
    updateCustomAgentRoles: createSectionUpdater("customAgentRoles"),
    updateGlobalKanbanSettings: createSectionUpdater("kanban"),
    updateGlobalAutopilotSettings: createSectionUpdater("autopilot"),

    updateRepoPromptLayers: (updater: PromptSettingsLayersUpdater): void => {
      updateSelectedRepoConfig((repoConfig) =>
        withRepoPromptLayers(repoConfig, updater(repoPromptLayersOf(repoConfig))),
      );
    },

    updateSelectedRepoAgentDefault: (
      role: string,
      field: keyof RepoAgentDefaultInput,
      value: string,
    ): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const currentRoleDefault = repoConfig.agentDefaults[role];
        const resolvedRuntimeKind =
          currentRoleDefault?.runtimeKind ?? repoConfig.defaultModel?.runtimeKind;
        const baseRoleDefault = ensureDraftAgentDefault(currentRoleDefault);
        if (resolvedRuntimeKind) {
          baseRoleDefault.runtimeKind = resolvedRuntimeKind;
        }
        const nextRoleDefault = applyRepoAgentDefaultField(baseRoleDefault, field, value);

        return {
          ...repoConfig,
          agentDefaults: {
            ...repoConfig.agentDefaults,
            // SAFETY: the draft can hold a default without runtimeKind. prepareModelDefaultsForSave
            // rejects that default before the save.
            [role]: nextRoleDefault as AgentModelDefault,
          },
        };
      });
    },

    clearSelectedRepoAgentDefault: (role: string): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const { [role]: _ignored, ...remainingDefaults } = repoConfig.agentDefaults;
        return {
          ...repoConfig,
          agentDefaults: remainingDefaults,
        };
      });
    },

    updateSelectedRepoDefaultModel: (field: keyof RepoAgentDefaultInput, value: string): void => {
      updateSelectedRepoConfig((repoConfig) => {
        const nextDefaultModel = updateRepoDefaultModel(repoConfig.defaultModel, field, value);
        return nextDefaultModel ? { ...repoConfig, defaultModel: nextDefaultModel } : repoConfig;
      });
    },

    clearSelectedRepoDefaultModel: (): void => {
      updateSelectedRepoConfig((repoConfig) => ({
        ...repoConfig,
        defaultModel: undefined,
      }));
    },
  };
};

export type SettingsModalDraftActions = ReturnType<typeof createDraftActions>;

export const useSettingsModalDraftActions = ({
  selectedWorkspaceId,
  setSnapshotDraft,
}: UseSettingsModalDraftActionsArgs): SettingsModalDraftActions =>
  useMemo(
    () => createDraftActions({ selectedWorkspaceId, setSnapshotDraft }),
    [selectedWorkspaceId, setSnapshotDraft],
  );
