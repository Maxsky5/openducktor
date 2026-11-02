import {
  diffSettingsSnapshot,
  type SettingsSnapshot,
  type SettingsSnapshotSaveInput,
} from "@openducktor/contracts";
import { prepareReusablePromptsForSave } from "@/state/read-models/settings-read-model";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { prepareGlobalGitSettingsForSave } from "./global-git-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";

/** Normalize editor values, then send only the leaves that changed from its baseline. */
export const prepareSettingsSnapshotForSave = (
  snapshot: SettingsSnapshot,
  baseline: SettingsSnapshot,
): SettingsSnapshotSaveInput =>
  diffSettingsSnapshot(baseline, {
    ...snapshot,
    git: prepareGlobalGitSettingsForSave(snapshot.git),
    reusablePrompts: prepareReusablePromptsForSave(snapshot.reusablePrompts),
    autopilot: prepareAutopilotSettingsForSave(snapshot.autopilot),
    globalPromptOverrides: preparePromptOverridesForSave(snapshot.globalPromptOverrides),
    workspaces: Object.fromEntries(
      Object.entries(snapshot.workspaces).map(([id, config]) => [
        id,
        prepareRepoConfigForSave(config),
      ]),
    ),
  });
