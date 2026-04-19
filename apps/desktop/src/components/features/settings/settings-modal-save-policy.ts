import type { SettingsSnapshot } from "@openducktor/contracts";
import { normalizeGlobalGitConfigForSave } from "./settings-modal-normalization";
import type { DirtySections } from "./use-settings-modal-dirty-state";

export const hasAnyDirtySections = (dirtySections: DirtySections): boolean =>
  dirtySections.chat ||
  dirtySections.globalGit ||
  dirtySections.kanban ||
  dirtySections.autopilot ||
  dirtySections.globalPromptOverrides ||
  dirtySections.repoSettings;

export const isGlobalGitOnlySave = (dirtySections: DirtySections): boolean =>
  dirtySections.globalGit &&
  !dirtySections.chat &&
  !dirtySections.kanban &&
  !dirtySections.autopilot &&
  !dirtySections.globalPromptOverrides &&
  !dirtySections.repoSettings;

export const hasSameNormalizedGlobalGitConfig = (
  loadedSnapshot: SettingsSnapshot | null,
  normalizedGit: SettingsSnapshot["git"],
): boolean =>
  loadedSnapshot !== null &&
  normalizeGlobalGitConfigForSave(loadedSnapshot.git).defaultMergeMethod ===
    normalizedGit.defaultMergeMethod;

export const buildPromptValidationSaveError = (totalErrorCount: number): string => {
  const suffix = totalErrorCount > 1 ? "s" : "";
  return `Fix ${totalErrorCount} prompt placeholder error${suffix} before saving.`;
};

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
