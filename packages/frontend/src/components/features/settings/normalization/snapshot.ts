import type { SettingsSnapshot } from "@openducktor/contracts";
import { normalizeReusablePromptsForSave } from "@/components/features/settings/settings-model";
import { normalizeAutopilotSettingsForSave } from "./autopilot";
import { normalizeGlobalGitConfigForSave } from "./global-git";
import { normalizePromptOverridesForSave } from "./prompt-overrides";
import { normalizeRepoConfigForSave } from "./repo-config";

export const normalizeSnapshotForSave = (snapshot: SettingsSnapshot): SettingsSnapshot => {
  const workspaces = Object.fromEntries(
    Object.entries(snapshot.workspaces).map(([workspaceId, repoConfig]) => [
      workspaceId,
      normalizeRepoConfigForSave(repoConfig),
    ]),
  );

  return {
    theme: snapshot.theme,
    git: normalizeGlobalGitConfigForSave(snapshot.git),
    general: snapshot.general,
    chat: snapshot.chat,
    reusablePrompts: normalizeReusablePromptsForSave(snapshot.reusablePrompts),
    kanban: snapshot.kanban,
    autopilot: normalizeAutopilotSettingsForSave(snapshot.autopilot),
    workspaces,
    globalPromptOverrides: normalizePromptOverridesForSave(snapshot.globalPromptOverrides),
  };
};
