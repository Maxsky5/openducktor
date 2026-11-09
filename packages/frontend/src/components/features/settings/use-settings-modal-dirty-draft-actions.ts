import type {
  AgentRuntimes,
  SettingsRepoConfig,
  ReusablePrompt,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { useCallback } from "react";
import type { PromptSettingsLayersUpdater } from "./settings-prompt-layers";
import type { SettingsModalDraftActions } from "./use-settings-modal-draft-actions";

type UseSettingsModalDirtyDraftActionsArgs = {
  clearSaveError: () => void;
  draftActions: SettingsModalDraftActions;
};

type SettingsModalDirtyDraftActions = SettingsModalDraftActions;

export const useSettingsModalDirtyDraftActions = ({
  clearSaveError,
  draftActions,
}: UseSettingsModalDirtyDraftActionsArgs): SettingsModalDirtyDraftActions => {
  const runDirtyAction = useCallback(
    (action: () => void): void => {
      clearSaveError();
      action();
    },
    [clearSaveError],
  );

  const updateSelectedRepoConfig = useCallback(
    (updater: (current: SettingsRepoConfig) => SettingsRepoConfig): void => {
      runDirtyAction(() => {
        draftActions.updateSelectedRepoConfig(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalGitConfig = useCallback(
    (updater: (current: SettingsSnapshot["git"]) => SettingsSnapshot["git"]): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalGitConfig(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalChatSettings = useCallback(
    (updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"]): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalChatSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalSystemSettings = useCallback(
    (updater: (current: SettingsSnapshot["system"]) => SettingsSnapshot["system"]): void => {
      runDirtyAction(() => draftActions.updateGlobalSystemSettings(updater));
    },
    [draftActions, runDirtyAction],
  );

  const updateNotificationSettings = useCallback(
    (
      updater: (current: SettingsSnapshot["notifications"]) => SettingsSnapshot["notifications"],
    ): void => {
      runDirtyAction(() => {
        draftActions.updateNotificationSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalGeneralSettings = useCallback(
    (updater: (current: SettingsSnapshot["general"]) => SettingsSnapshot["general"]): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalGeneralSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalAppearanceSettings = useCallback(
    (
      updater: (current: SettingsSnapshot["appearance"]) => SettingsSnapshot["appearance"],
    ): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalAppearanceSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateAgentRuntimes = useCallback(
    (updater: (current: AgentRuntimes) => AgentRuntimes): void => {
      runDirtyAction(() => {
        draftActions.updateAgentRuntimes(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateReusablePrompts = useCallback(
    (updater: (current: ReusablePrompt[]) => ReusablePrompt[]): void => {
      runDirtyAction(() => {
        draftActions.updateReusablePrompts(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateCustomAgentRoles = useCallback(
    (
      updater: (
        current: SettingsSnapshot["customAgentRoles"],
      ) => SettingsSnapshot["customAgentRoles"],
    ): void => {
      runDirtyAction(() => draftActions.updateCustomAgentRoles(updater));
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalKanbanSettings = useCallback(
    (updater: (current: SettingsSnapshot["kanban"]) => SettingsSnapshot["kanban"]): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalKanbanSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalAutopilotSettings = useCallback(
    (updater: (current: SettingsSnapshot["autopilot"]) => SettingsSnapshot["autopilot"]): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalAutopilotSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalPromptLayers = useCallback(
    (updater: PromptSettingsLayersUpdater): void => {
      runDirtyAction(() => {
        draftActions.updateGlobalPromptLayers(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateRepoPromptLayers = useCallback(
    (updater: PromptSettingsLayersUpdater): void => {
      runDirtyAction(() => {
        draftActions.updateRepoPromptLayers(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateSelectedRepoAgentDefault = useCallback(
    (
      role: string,
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
      value: string,
    ): void => {
      runDirtyAction(() => {
        draftActions.updateSelectedRepoAgentDefault(role, field, value);
      });
    },
    [draftActions, runDirtyAction],
  );

  const clearSelectedRepoAgentDefault = useCallback(
    (role: string): void => {
      runDirtyAction(() => {
        draftActions.clearSelectedRepoAgentDefault(role);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateSelectedRepoDefaultModel = useCallback(
    (
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
      value: string,
    ): void => {
      runDirtyAction(() => {
        draftActions.updateSelectedRepoDefaultModel(field, value);
      });
    },
    [draftActions, runDirtyAction],
  );

  const clearSelectedRepoDefaultModel = useCallback((): void => {
    runDirtyAction(() => {
      draftActions.clearSelectedRepoDefaultModel();
    });
  }, [draftActions, runDirtyAction]);

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
