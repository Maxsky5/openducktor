import type { SettingsSnapshot } from "@openducktor/contracts";
import { normalizeReusablePromptsForSave as prepareReusablePromptsForSave } from "@/components/features/settings/settings-model";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { prepareGlobalGitSettingsForSave } from "./global-git-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";

export const prepareSettingsSnapshotForSave = (snapshot: SettingsSnapshot): SettingsSnapshot => {
  const workspaces = Object.fromEntries(
    Object.entries(snapshot.workspaces).map(([workspaceId, repoConfig]) => [
      workspaceId,
      prepareRepoConfigForSave(repoConfig),
    ]),
  );

  return {
    theme: snapshot.theme,
    git: prepareGlobalGitSettingsForSave(snapshot.git),
    general: snapshot.general,
    chat: snapshot.chat,
    reusablePrompts: prepareReusablePromptsForSave(snapshot.reusablePrompts),
    kanban: snapshot.kanban,
    autopilot: prepareAutopilotSettingsForSave(snapshot.autopilot),
    workspaces,
    globalPromptOverrides: preparePromptOverridesForSave(snapshot.globalPromptOverrides),
  };
};
