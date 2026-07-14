import type { SettingsSnapshot, SettingsSnapshotUpdate } from "@openducktor/contracts";
import { prepareReusablePromptsForSave } from "@/state/read-models/settings-read-model";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { prepareGlobalGitSettingsForSave } from "./global-git-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";

export const prepareSettingsSnapshotForSave = (
  snapshot: SettingsSnapshot,
): SettingsSnapshotUpdate => {
  const workspaces = Object.fromEntries(
    Object.entries(snapshot.workspaces).map(([workspaceId, repoConfig]) => [
      workspaceId,
      prepareRepoConfigForSave(repoConfig),
    ]),
  );

  return {
    git: prepareGlobalGitSettingsForSave(snapshot.git),
    general: snapshot.general,
    appearance: snapshot.appearance,
    chat: snapshot.chat,
    reusablePrompts: prepareReusablePromptsForSave(snapshot.reusablePrompts),
    kanban: snapshot.kanban,
    autopilot: prepareAutopilotSettingsForSave(snapshot.autopilot),
    agentRuntimes: snapshot.agentRuntimes,
    workspaces,
    globalPromptOverrides: preparePromptOverridesForSave(snapshot.globalPromptOverrides),
  };
};
