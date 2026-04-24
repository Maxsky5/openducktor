import type { RepoConfig, RepoPromptOverrides, SettingsSnapshot } from "@openducktor/contracts";
import { useCallback } from "react";
import type { DirtySections } from "./use-settings-modal-dirty-state";
import type { SettingsModalDraftActions } from "./use-settings-modal-draft-actions";

type UseSettingsModalDirtyDraftActionsArgs = {
  clearSaveError: () => void;
  markDirty: (section: keyof DirtySections) => void;
  draftActions: SettingsModalDraftActions;
};

type SettingsModalDirtyDraftActions = SettingsModalDraftActions;

export const useSettingsModalDirtyDraftActions = ({
  clearSaveError,
  markDirty,
  draftActions,
}: UseSettingsModalDirtyDraftActionsArgs): SettingsModalDirtyDraftActions => {
  const runDirtyAction = useCallback(
    (section: keyof DirtySections, action: () => void): void => {
      clearSaveError();
      markDirty(section);
      action();
    },
    [clearSaveError, markDirty],
  );

  const updateSelectedRepoConfig = useCallback(
    (updater: (current: RepoConfig) => RepoConfig): void => {
      runDirtyAction("repoSettings", () => {
        draftActions.updateSelectedRepoConfig(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalGitConfig = useCallback(
    (updater: (current: SettingsSnapshot["git"]) => SettingsSnapshot["git"]): void => {
      runDirtyAction("globalGit", () => {
        draftActions.updateGlobalGitConfig(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalChatSettings = useCallback(
    (updater: (current: SettingsSnapshot["chat"]) => SettingsSnapshot["chat"]): void => {
      runDirtyAction("chat", () => {
        draftActions.updateGlobalChatSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalKanbanSettings = useCallback(
    (updater: (current: SettingsSnapshot["kanban"]) => SettingsSnapshot["kanban"]): void => {
      runDirtyAction("kanban", () => {
        draftActions.updateGlobalKanbanSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalAutopilotSettings = useCallback(
    (updater: (current: SettingsSnapshot["autopilot"]) => SettingsSnapshot["autopilot"]): void => {
      runDirtyAction("autopilot", () => {
        draftActions.updateGlobalAutopilotSettings(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateGlobalPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      runDirtyAction("globalPromptOverrides", () => {
        draftActions.updateGlobalPromptOverrides(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateRepoPromptOverrides = useCallback(
    (updater: (current: RepoPromptOverrides) => RepoPromptOverrides): void => {
      runDirtyAction("repoSettings", () => {
        draftActions.updateRepoPromptOverrides(updater);
      });
    },
    [draftActions, runDirtyAction],
  );

  const updateSelectedRepoAgentDefault = useCallback(
    (
      role: "spec" | "planner" | "build" | "qa",
      field: "runtimeKind" | "providerId" | "modelId" | "variant" | "profileId",
      value: string,
    ): void => {
      runDirtyAction("repoSettings", () => {
        draftActions.updateSelectedRepoAgentDefault(role, field, value);
      });
    },
    [draftActions, runDirtyAction],
  );

  const clearSelectedRepoAgentDefault = useCallback(
    (role: "spec" | "planner" | "build" | "qa"): void => {
      runDirtyAction("repoSettings", () => {
        draftActions.clearSelectedRepoAgentDefault(role);
      });
    },
    [draftActions, runDirtyAction],
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
