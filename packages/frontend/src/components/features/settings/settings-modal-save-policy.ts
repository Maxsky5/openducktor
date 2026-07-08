import type { SettingsSnapshot } from "@openducktor/contracts";
import { prepareGlobalGitSettingsForSave } from "./settings-save/global-git-settings";
import { type DirtySections, EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";

const DIRTY_SECTION_KEYS = Object.keys(EMPTY_DIRTY_SECTIONS) as (keyof DirtySections)[];

export const hasAnyDirtySections = (dirtySections: DirtySections): boolean =>
  DIRTY_SECTION_KEYS.some((section) => Boolean(dirtySections[section]));

export const isGlobalGitOnlySave = (dirtySections: DirtySections): boolean =>
  dirtySections.globalGit &&
  DIRTY_SECTION_KEYS.every((section) => section === "globalGit" || !dirtySections[section]);

export const hasSameSaveReadyGlobalGitConfig = (
  loadedSnapshot: SettingsSnapshot | null,
  saveReadyGit: SettingsSnapshot["git"],
): boolean =>
  loadedSnapshot !== null &&
  prepareGlobalGitSettingsForSave(loadedSnapshot.git).defaultMergeMethod ===
    saveReadyGit.defaultMergeMethod;

export const buildPromptValidationSaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} prompt placeholder error${suffix} before saving.`;
};

export const buildReusablePromptValidationSaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} reusable prompt field error${suffix} before saving.`;
};

export const buildRuntimeAvailabilitySaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} disabled runtime selection${suffix} before saving.`;
};

export const buildCodexDangerousSettingsSaveError = (): string =>
  "Confirm the Codex safety acknowledgement before saving.";

export const buildRepoScriptValidationSaveError = ({
  invalidRepoPathsWithDevServerErrors,
  repoScriptValidationErrorCount,
  selectedWorkspaceId,
}: {
  invalidRepoPathsWithDevServerErrors: string[];
  repoScriptValidationErrorCount: number;
  selectedWorkspaceId: string | null;
}): string => {
  const suffix = repoScriptValidationErrorCount > 1 ? "s" : "";
  const invalidRepoSummary = invalidRepoPathsWithDevServerErrors
    .map((workspaceId) =>
      workspaceId === selectedWorkspaceId ? "the selected repository" : `\`${workspaceId}\``,
    )
    .join(", ");

  return `Fix ${repoScriptValidationErrorCount} dev server field error${suffix} in ${invalidRepoSummary} before saving.`;
};
