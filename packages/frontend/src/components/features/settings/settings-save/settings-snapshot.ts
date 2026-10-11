import type { SettingsSnapshot, SettingsSnapshotSaveInput } from "@openducktor/contracts";
import { prepareReusablePromptsForSave } from "@/state/read-models/settings-read-model";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { prepareGlobalGitSettingsForSave } from "./global-git-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";

/**
 * Custom roles and Autopilot rules go into the save only when the user edited them, so a save
 * cannot replace values that another client saved.
 */
export const prepareSettingsSnapshotForSave = (
  snapshot: SettingsSnapshot,
  {
    saveCustomAgentRoles = false,
    saveAutopilot = false,
  }: { saveCustomAgentRoles?: boolean; saveAutopilot?: boolean } = {},
): SettingsSnapshotSaveInput => {
  const workspaces = Object.fromEntries(
    Object.entries(snapshot.workspaces).map(([workspaceId, repoConfig]) => [
      workspaceId,
      prepareRepoConfigForSave(repoConfig),
    ]),
  );

  const input: SettingsSnapshotSaveInput = {
    git: prepareGlobalGitSettingsForSave(snapshot.git),
    system: snapshot.system,
    general: snapshot.general,
    appearance: snapshot.appearance,
    chat: snapshot.chat,
    reusablePrompts: prepareReusablePromptsForSave(snapshot.reusablePrompts),
    kanban: snapshot.kanban,
    notifications: snapshot.notifications,
    agentRuntimes: snapshot.agentRuntimes,
    agentModelFavorites: snapshot.agentModelFavorites,
    workspaces,
    globalPromptOverrides: preparePromptOverridesForSave(snapshot.globalPromptOverrides),
  };
  if (saveCustomAgentRoles) input.customAgentRoles = snapshot.customAgentRoles;
  if (saveAutopilot) input.autopilot = prepareAutopilotSettingsForSave(snapshot.autopilot);
  return input;
};
